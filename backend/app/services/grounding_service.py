"""
Grounding service for evidence resolution.
Rule 2: Grounding is mandatory, not optional.
Phase 3 implementation.
"""

from typing import Optional, Tuple
from ..database import db_pool
from ..utils.text_utils import normalize_text, fuzzy_match_score
from ..agents.grounding_agent import GroundingAgent
import logging

logger = logging.getLogger(__name__)


class GroundingService:
    """Resolves evidence for extracted parameters using 4-stage chain."""
    
    @staticmethod
    async def ground_parameter(
        contract_id: str,
        param_id: str,
        supporting_text: str,
        extracted_value: str
    ) -> Optional[str]:
        """
        Ground a parameter to its source block using 4-stage resolution chain.
        
        Chain: EXACT → NORMALIZED → FUZZY → LLM_ALIGNED
        
        Args:
            contract_id: Contract UUID
            param_id: Parameter UUID
            supporting_text: Supporting text from extraction
            extracted_value: Extracted value
        
        Returns:
            grounding_id if successful, None if failed
        """
        if not supporting_text:
            logger.warning(f"No supporting text for parameter {param_id}")
            return None
        
        # Get all blocks for contract
        blocks = await GroundingService._get_blocks(contract_id)
        
        if not blocks:
            logger.warning(f"No blocks found for contract {contract_id}")
            return None
        
        # Stage 1: Exact match
        result = GroundingService._exact_match(supporting_text, blocks)
        if result:
            block, matched_text, method = result
            return await GroundingService._save_grounding(
                param_id, block, matched_text, 1.0, method
            )
        
        # Stage 2: Normalized match
        result = GroundingService._normalized_match(supporting_text, blocks)
        if result:
            block, matched_text, method = result
            return await GroundingService._save_grounding(
                param_id, block, matched_text, 0.95, method
            )
        
        # Stage 3: Fuzzy match
        result = GroundingService._fuzzy_match(supporting_text, blocks)
        if result:
            block, matched_text, method, score = result
            return await GroundingService._save_grounding(
                param_id, block, matched_text, score, method
            )
        
        # Stage 4: LLM alignment
        result = GroundingAgent.align_evidence(extracted_value, supporting_text, blocks)
        if result:
            block_id, matched_text, confidence = result
            block = next((b for b in blocks if b['block_id'] == block_id), None)
            if block:
                return await GroundingService._save_grounding(
                    param_id, block, matched_text, confidence, 'LLM_ALIGNED'
                )
        
        # All stages failed - mark as UNGROUNDED
        logger.warning(f"Failed to ground parameter {param_id}")
        return None
    
    @staticmethod
    def _exact_match(supporting_text: str, blocks: list) -> Optional[Tuple]:
        """Stage 1: Exact text match."""
        if not supporting_text:
            return None
        
        for block in blocks:
            raw_text = str(block.get('raw_text', ''))
            if supporting_text in raw_text:
                return (block, supporting_text, 'EXACT')
        return None
    
    @staticmethod
    def _normalized_match(supporting_text: str, blocks: list) -> Optional[Tuple]:
        """Stage 2: Normalized match (case-insensitive, whitespace-normalized)."""
        if not supporting_text:
            return None
        
        norm_supporting = normalize_text(supporting_text)
        
        for block in blocks:
            raw_text = str(block.get('raw_text', ''))
            norm_block = normalize_text(raw_text)
            if norm_supporting in norm_block:
                # Find the actual text in the original block
                return (block, supporting_text, 'NORMALIZED')
        return None
    
    @staticmethod
    def _fuzzy_match(supporting_text: str, blocks: list, threshold: float = 0.85) -> Optional[Tuple]:
        """Stage 3: Fuzzy match with similarity threshold."""
        if not supporting_text:
            return None
        
        best_match = None
        best_score = 0.0
        
        for block in blocks:
            raw_text = str(block.get('raw_text', ''))
            score = fuzzy_match_score(supporting_text, raw_text)
            if score > best_score and score >= threshold:
                best_score = score
                best_match = (block, raw_text[:len(supporting_text) + 50], 'FUZZY', score)
        
        return best_match
    
    @staticmethod
    async def _get_blocks(contract_id: str) -> list:
        """Get all blocks for a contract."""
        query = """
            SELECT block_id, page_number, raw_text, normalized_text,
                   bbox_x1, bbox_y1, bbox_x2, bbox_y2
            FROM document_blocks
            WHERE contract_id = :contract_id
            ORDER BY page_number, block_order
        """
        
        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(query, {'contract_id': contract_id})
                rows = await cursor.fetchall()
                
                blocks = []
                for row in rows:
                    # Read CLOB fields if they are AsyncLOB objects
                    raw_text = row[2]
                    if hasattr(raw_text, 'read'):
                        raw_text = await raw_text.read()
                    
                    normalized_text = row[3]
                    if hasattr(normalized_text, 'read'):
                        normalized_text = await normalized_text.read()
                    
                    blocks.append({
                        'block_id': row[0],
                        'page_number': row[1],
                        'raw_text': raw_text,
                        'normalized_text': normalized_text,
                        'bbox_x1': row[4],
                        'bbox_y1': row[5],
                        'bbox_x2': row[6],
                        'bbox_y2': row[7]
                    })
                
                return blocks
    
    @staticmethod
    async def _save_grounding(
        param_id: str,
        block: dict,
        source_text: str,
        confidence: float,
        match_method: str
    ) -> str:
        """Save grounding record to database."""
        query = """
            INSERT INTO draft_grounding_records (
                param_id, block_id, page_number,
                bbox_x1, bbox_y1, bbox_x2, bbox_y2,
                source_text, grounding_confidence, match_method
            ) VALUES (
                :param_id, :block_id, :page_number,
                :bbox_x1, :bbox_y1, :bbox_x2, :bbox_y2,
                :source_text, :grounding_confidence, :match_method
            )
        """
        
        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                # Get the grounding_id that will be generated
                await cursor.execute(query, {
                    'param_id': param_id,
                    'block_id': block['block_id'],
                    'page_number': block['page_number'],
                    'bbox_x1': block['bbox_x1'],
                    'bbox_y1': block['bbox_y1'],
                    'bbox_x2': block['bbox_x2'],
                    'bbox_y2': block['bbox_y2'],
                    'source_text': source_text[:4000],  # Limit length
                    'grounding_confidence': confidence,
                    'match_method': match_method
                })
                await conn.commit()
                
                # Get the generated grounding_id
                await cursor.execute(
                    "SELECT grounding_id FROM draft_grounding_records WHERE param_id = :param_id",
                    {'param_id': param_id}
                )
                row = await cursor.fetchone()
                return row[0] if row else None
