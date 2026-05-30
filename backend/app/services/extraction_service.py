"""
Extraction service orchestrating parameter extraction pipeline.
Phase 3 implementation.
"""

from typing import List, Dict
import uuid
import asyncio
from ..database import db_pool
from ..agents.extraction_agent import ExtractionAgent
from ..services.parsing_service import ParsingService
from ..services.grounding_service import GroundingService
from ..services.workflow_service import WorkflowService
from ..services.audit_service import AuditService
from ..config import settings
import logging

logger = logging.getLogger(__name__)


class ExtractionService:
    """Orchestrates the extraction pipeline."""
    
    @staticmethod
    async def run_extraction(contract_id: str, user_id: str) -> Dict:
        """
        Run full extraction pipeline for a contract.
        
        Workflow: TAG_SUGGESTION_READY → EXTRACTION_RUNNING → GROUNDING_RUNNING → 
                  VALIDATION_RUNNING → DRAFT_READY
        
        Args:
            contract_id: Contract UUID
            user_id: User triggering extraction
        
        Returns:
            Summary dict with counts
        """
        try:
            # Transition to EXTRACTION_RUNNING
            await WorkflowService.transition(
                contract_id=contract_id,
                to_state='EXTRACTION_RUNNING',
                user_id=user_id,
                reason='Starting parameter extraction'
            )
            
            # Get document text
            blocks = await ParsingService.get_blocks_for_contract(contract_id)
            document_text = "\n\n".join([str(b['raw_text']) for b in blocks])
            
            # Extract all batches
            all_batches = ExtractionAgent.get_all_batches()
            total_params = 0
            
            for batch_name, parameters in all_batches.items():
                logger.info(f"Extracting {batch_name}...")
                
                extracted = ExtractionAgent.extract_batch(
                    batch_name=batch_name,
                    parameters=parameters,
                    document_text=document_text
                )
                
                # Save parameters
                for param in extracted:
                    await ExtractionService._save_parameter(
                        contract_id=contract_id,
                        parameter_name=param['parameter_name'],
                        parameter_group=batch_name,
                        extracted_value=param.get('extracted_value'),
                        supporting_text=param.get('supporting_text'),
                        confidence=param.get('confidence', 0.0),
                        model_used=settings.groq_model_heavy
                    )
                    total_params += 1
                
                # Add delay between batches to avoid rate limits
                await asyncio.sleep(3)
            
            logger.info(f"Extracted {total_params} parameters")
            
            # Transition to GROUNDING_RUNNING
            await WorkflowService.transition(
                contract_id=contract_id,
                to_state='GROUNDING_RUNNING',
                user_id=user_id,
                reason=f'Extraction complete: {total_params} parameters'
            )
            
            # Ground all parameters
            grounded_count = await ExtractionService._ground_all_parameters(contract_id)
            
            logger.info(f"Grounded {grounded_count}/{total_params} parameters")
            
            # Transition to VALIDATION_RUNNING
            await WorkflowService.transition(
                contract_id=contract_id,
                to_state='VALIDATION_RUNNING',
                user_id=user_id,
                reason=f'Grounding complete: {grounded_count}/{total_params}'
            )
            
            # Run validation (Phase 3 - simple validation)
            validated_count = await ExtractionService._validate_parameters(contract_id)
            
            # Transition to DRAFT_READY
            await WorkflowService.transition(
                contract_id=contract_id,
                to_state='DRAFT_READY',
                user_id=user_id,
                reason=f'Validation complete: {validated_count} valid'
            )
            
            # Audit log
            await AuditService.log(
                contract_id=contract_id,
                user_id=user_id,
                action='EXTRACTION_COMPLETE',
                entity_type='contract',
                entity_id=contract_id,
                metadata={
                    'total_params': total_params,
                    'grounded': grounded_count,
                    'validated': validated_count
                }
            )
            
            return {
                'contract_id': contract_id,
                'total_parameters': total_params,
                'grounded': grounded_count,
                'validated': validated_count,
                'workflow_state': 'DRAFT_READY'
            }
        
        except Exception as e:
            logger.error(f"Extraction failed: {e}")
            raise
    
    @staticmethod
    async def _save_parameter(
        contract_id: str,
        parameter_name: str,
        parameter_group: str,
        extracted_value: str,
        supporting_text: str,
        confidence: float,
        model_used: str
    ) -> str:
        """Save extracted parameter to database."""
        param_id = uuid.uuid4().hex.upper()
        
        # Determine initial validation status
        validation_status = 'NEEDS_REVIEW'
        if extracted_value is None:
            validation_status = 'MISSING'
        elif confidence >= 0.9:
            validation_status = 'VALID'
        
        query = """
            INSERT INTO draft_parameters (
                param_id, contract_id, parameter_name, parameter_group,
                extracted_value, supporting_text, confidence,
                validation_status, model_used, extraction_ts
            ) VALUES (
                :param_id, :contract_id, :parameter_name, :parameter_group,
                :extracted_value, :supporting_text, :confidence,
                :validation_status, :model_used, CURRENT_TIMESTAMP
            )
        """
        
        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(query, {
                    'param_id': param_id,
                    'contract_id': contract_id,
                    'parameter_name': parameter_name,
                    'parameter_group': parameter_group,
                    'extracted_value': extracted_value,
                    'supporting_text': supporting_text,
                    'confidence': confidence,
                    'validation_status': validation_status,
                    'model_used': model_used
                })
                await conn.commit()
        
        return param_id
    
    @staticmethod
    async def _ground_all_parameters(contract_id: str) -> int:
        """Ground all parameters for a contract."""
        # Get all parameters
        query = """
            SELECT param_id, extracted_value, supporting_text
            FROM draft_parameters
            WHERE contract_id = :contract_id AND supporting_text IS NOT NULL
        """
        
        grounded_count = 0
        
        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(query, {'contract_id': contract_id})
                rows = await cursor.fetchall()
                
                for row in rows:
                    param_id = row[0]
                    extracted_value = row[1]
                    supporting_text = row[2]
                    
                    # Read CLOB fields if they are AsyncLOB objects
                    if hasattr(extracted_value, 'read'):
                        extracted_value = await extracted_value.read()
                    
                    if hasattr(supporting_text, 'read'):
                        supporting_text = await supporting_text.read()
                    
                    grounding_id = await GroundingService.ground_parameter(
                        contract_id=contract_id,
                        param_id=param_id,
                        supporting_text=supporting_text,
                        extracted_value=extracted_value or ''
                    )
                    
                    if grounding_id:
                        grounded_count += 1
                    else:
                        # Mark as UNGROUNDED
                        await cursor.execute(
                            "UPDATE draft_parameters SET validation_status = 'UNGROUNDED' WHERE param_id = :param_id",
                            {'param_id': param_id}
                        )
                        await conn.commit()
        
        return grounded_count
    
    @staticmethod
    async def _validate_parameters(contract_id: str) -> int:
        """Run basic validation on parameters."""
        # Simple validation: mark high-confidence grounded params as VALID
        query = """
            UPDATE draft_parameters
            SET validation_status = 'VALID'
            WHERE contract_id = :contract_id
              AND confidence >= 0.85
              AND validation_status != 'UNGROUNDED'
              AND validation_status != 'MISSING'
        """
        
        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(query, {'contract_id': contract_id})
                validated_count = cursor.rowcount
                await conn.commit()
        
        return validated_count
    
    @staticmethod
    async def get_draft_parameters(contract_id: str) -> List[Dict]:
        """Get all draft parameters for a contract."""
        query = """
            SELECT p.param_id, p.parameter_name, p.parameter_group,
                   p.extracted_value, p.supporting_text, p.confidence,
                   p.validation_status, p.edited_value, p.reviewer_status,
                   g.page_number, g.bbox_x1, g.bbox_y1, g.bbox_x2, g.bbox_y2,
                   g.source_text, g.match_method
            FROM draft_parameters p
            LEFT JOIN draft_grounding_records g ON p.param_id = g.param_id
            WHERE p.contract_id = :contract_id
            ORDER BY p.parameter_group, p.parameter_name
        """
        
        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(query, {'contract_id': contract_id})
                rows = await cursor.fetchall()
                
                results = []
                for row in rows:
                    # Read CLOB fields if they are AsyncLOB objects
                    extracted_value = row[3]
                    if hasattr(extracted_value, 'read'):
                        extracted_value = await extracted_value.read()
                    
                    supporting_text = row[4]
                    if hasattr(supporting_text, 'read'):
                        supporting_text = await supporting_text.read()
                    
                    edited_value = row[7]
                    if hasattr(edited_value, 'read'):
                        edited_value = await edited_value.read()
                    
                    source_text = row[14]
                    if hasattr(source_text, 'read'):
                        source_text = await source_text.read()
                    
                    results.append({
                        'param_id': row[0],
                        'parameter_name': row[1],
                        'parameter_group': row[2],
                        'extracted_value': extracted_value,
                        'supporting_text': supporting_text,
                        'confidence': float(row[5]) if row[5] else 0.0,
                        'validation_status': row[6],
                        'edited_value': edited_value,
                        'reviewer_status': row[8],
                        'grounding': {
                            'page_number': row[9],
                            'bbox_x1': float(row[10]) if row[10] else None,
                            'bbox_y1': float(row[11]) if row[11] else None,
                            'bbox_x2': float(row[12]) if row[12] else None,
                            'bbox_y2': float(row[13]) if row[13] else None,
                            'source_text': source_text,
                            'match_method': row[15]
                        } if row[9] else None
                    })
                
                return results
