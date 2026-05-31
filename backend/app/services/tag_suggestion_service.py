"""
Tag suggestion service.
Orchestrates AI tag generation and persistence.
Phase 2 implementation.
"""

from typing import List, Dict
from ..database import db_pool
from ..agents.tagging_agent import TaggingAgent
from ..services.parsing_service import ParsingService
import logging

logger = logging.getLogger(__name__)

# Whitelist of columns that tag suggestions are permitted to update.
# Any field_name stored in draft_tag_suggestions that is NOT in this set
# will be rejected — prevents stored SQL injection via adversarial extraction output.
ALLOWED_TAG_FIELDS: frozenset = frozenset({
    'contract_type',
    'agreement_type',
    'department',
    'customer_name',
})


class TagSuggestionService:
    """Manages tag suggestions for contracts."""
    
    @staticmethod
    async def generate_suggestions(contract_id: str) -> List[Dict]:
        """
        Generate AI tag suggestions for a contract.
        
        Args:
            contract_id: Contract UUID
        
        Returns:
            List of tag suggestions
        """
        # Get document blocks (first page only for speed)
        blocks = await ParsingService.get_blocks_for_contract(contract_id)
        
        if not blocks:
            logger.warning(f"No blocks found for contract {contract_id}")
            return []
        
        # Get first page text
        first_page_blocks = [b for b in blocks if b['page_number'] == 1]
        document_text = "\n".join([str(b['raw_text']) for b in first_page_blocks])
        
        # Get filename
        contract = await TagSuggestionService._get_contract_filename(contract_id)
        filename = contract.get('original_filename', 'unknown.pdf')
        # Generate suggestions using AI
        import asyncio
        loop = asyncio.get_event_loop()
        suggestions = await loop.run_in_executor(
            None,
            TaggingAgent.suggest_tags,
            document_text,
            filename
        )
        
        # Persist suggestions
        for suggestion in suggestions:
            await TagSuggestionService._save_suggestion(
                contract_id=contract_id,
                field_name=suggestion.get('field_name'),
                suggested_value=suggestion.get('suggested_value'),
                confidence=suggestion.get('confidence', 0.0),
                rationale=suggestion.get('rationale'),
                evidence_text=suggestion.get('evidence_text')
            )
        
        logger.info(f"Saved {len(suggestions)} tag suggestions for contract {contract_id}")
        
        return suggestions
    
    @staticmethod
    async def _get_contract_filename(contract_id: str) -> Dict:
        """Get contract filename."""
        query = "SELECT original_filename FROM contracts WHERE contract_id = :contract_id"
        
        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(query, {'contract_id': contract_id})
                row = await cursor.fetchone()
                return {'original_filename': row[0]} if row else {}
    
    @staticmethod
    async def _save_suggestion(
        contract_id: str,
        field_name: str,
        suggested_value: str,
        confidence: float,
        rationale: str = None,
        evidence_text: str = None
    ):
        """Save a tag suggestion to database."""
        # Ensure all incoming VARCHAR2/CLOB database inputs are properly serialized to strings (DPY-3002 guard)
        def serialize_db_val(v):
            if v is None:
                return None
            if isinstance(v, (dict, list)):
                import json as _json
                return _json.dumps(v, ensure_ascii=False)
            return str(v)

        db_suggested_value = serialize_db_val(suggested_value)
        db_rationale = serialize_db_val(rationale)
        db_evidence_text = serialize_db_val(evidence_text)

        query = """
            INSERT INTO draft_tag_suggestions (
                contract_id, field_name, suggested_value, confidence,
                rationale, evidence_text, accepted
            ) VALUES (
                :contract_id, :field_name, :suggested_value, :confidence,
                :rationale, :evidence_text, 0
            )
        """
        
        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(query, {
                    'contract_id': contract_id,
                    'field_name': field_name,
                    'suggested_value': db_suggested_value,
                    'confidence': confidence,
                    'rationale': db_rationale,
                    'evidence_text': db_evidence_text
                })
                await conn.commit()
    
    @staticmethod
    async def get_suggestions(contract_id: str) -> List[Dict]:
        """Get all tag suggestions for a contract."""
        query = """
            SELECT suggestion_id, field_name, suggested_value, confidence,
                   rationale, evidence_text, accepted, created_at
            FROM draft_tag_suggestions
            WHERE contract_id = :contract_id
            ORDER BY confidence DESC
        """
        
        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(query, {'contract_id': contract_id})
                rows = await cursor.fetchall()
                
                return [
                    {
                        'suggestion_id': row[0],
                        'field_name': row[1],
                        'suggested_value': row[2],
                        'confidence': float(row[3]) if row[3] else 0.0,
                        'rationale': row[4],
                        'evidence_text': row[5],
                        'accepted': bool(row[6]),
                        'created_at': row[7]
                    }
                    for row in rows
                ]
    
    @staticmethod
    async def accept_suggestion(suggestion_id: str, contract_id: str):
        """Mark a suggestion as accepted and update contract."""
        # Get suggestion
        query = """
            SELECT field_name, suggested_value
            FROM draft_tag_suggestions
            WHERE suggestion_id = :suggestion_id AND contract_id = :contract_id
        """
        
        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(query, {
                    'suggestion_id': suggestion_id,
                    'contract_id': contract_id
                })
                row = await cursor.fetchone()
                
                if not row:
                    return
                
                field_name, suggested_value = row

                # Whitelist check — field_name comes from the database and must
                # be constrained before being interpolated into the UPDATE query.
                if field_name not in ALLOWED_TAG_FIELDS:
                    logger.warning(
                        f"Rejected accept_suggestion: field_name '{field_name}' not in ALLOWED_TAG_FIELDS "
                        f"(suggestion_id={suggestion_id}, contract_id={contract_id})"
                    )
                    raise ValueError(f"Forbidden field_name: {field_name}")

                # Mark as accepted
                update_suggestion = """
                    UPDATE draft_tag_suggestions
                    SET accepted = 1
                    WHERE suggestion_id = :suggestion_id
                """
                await cursor.execute(update_suggestion, {'suggestion_id': suggestion_id})

                # field_name is whitelisted — interpolation is safe here
                update_contract = f"""
                    UPDATE contracts
                    SET {field_name} = :value
                    WHERE contract_id = :contract_id
                """
                await cursor.execute(update_contract, {
                    'value': suggested_value,
                    'contract_id': contract_id
                })

                await conn.commit()
