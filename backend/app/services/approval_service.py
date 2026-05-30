"""
Approval service for contract approval workflow.
Phase 4 implementation.
"""

from typing import Optional
from ..database import db_pool
from ..services.workflow_service import WorkflowService
from ..services.audit_service import AuditService
from ..services.embedding_service import EmbeddingService
import logging

logger = logging.getLogger(__name__)


class ApprovalService:
    """Manages contract approval workflow."""
    
    @staticmethod
    async def approve_contract(contract_id: str, user_id: str, comments: Optional[str] = None):
        """
        Approve contract and publish to corpus.
        
        Workflow: REVIEW_PENDING → APPROVED → PUBLISHED
        
        Rule 3: Draft and published data never mix.
        """
        try:
            # Transition to APPROVED
            await WorkflowService.transition(
                contract_id=contract_id,
                to_state='APPROVED',
                user_id=user_id,
                reason=comments or 'Approved by Operation Head'
            )
            
            # Promote draft parameters to published
            promoted_count = await ApprovalService._promote_to_published(contract_id)
            
            # Update contract
            await ApprovalService._update_contract_approval(contract_id, user_id)
            
            # Transition to PUBLISHED
            await WorkflowService.transition(
                contract_id=contract_id,
                to_state='PUBLISHED',
                user_id=user_id,
                reason=f'Published: {promoted_count} parameters'
            )
            
            # Audit log
            await AuditService.log(
                contract_id=contract_id,
                user_id=user_id,
                action='CONTRACT_APPROVED',
                entity_type='contract',
                entity_id=contract_id,
                metadata={
                    'promoted_count': promoted_count,
                    'comments': comments
                }
            )

            # Generate Cohere embeddings for vector search.
            # Non-fatal: embedding failure must not roll back an approved contract.
            try:
                embedding_count = await EmbeddingService.generate_published_embeddings(contract_id)
                logger.info(f"Embeddings generated post-approval: {embedding_count} vectors")
            except Exception as embed_exc:
                logger.error(
                    f"Embedding generation failed for contract {contract_id} "
                    f"(contract remains PUBLISHED): {embed_exc}"
                )
                embedding_count = 0

            logger.info(f"Contract {contract_id} approved and published: {promoted_count} parameters")

            return {
                'contract_id': contract_id,
                'promoted_count': promoted_count,
                'embeddings_generated': embedding_count,
                'workflow_state': 'PUBLISHED'
            }
        
        except Exception as e:
            logger.error(f"Approval failed: {e}")
            raise
    
    @staticmethod
    async def reject_contract(contract_id: str, user_id: str, reason: str):
        """
        Reject contract and return for re-review.
        
        Workflow: REVIEW_PENDING → REJECTED → DRAFT_READY
        """
        try:
            # Transition to REJECTED
            await WorkflowService.transition(
                contract_id=contract_id,
                to_state='REJECTED',
                user_id=user_id,
                reason=reason
            )
            
            # Transition back to DRAFT_READY
            await WorkflowService.transition(
                contract_id=contract_id,
                to_state='DRAFT_READY',
                user_id=user_id,
                reason='Returned for re-review'
            )
            
            # Audit log
            await AuditService.log(
                contract_id=contract_id,
                user_id=user_id,
                action='CONTRACT_REJECTED',
                entity_type='contract',
                entity_id=contract_id,
                metadata={'reason': reason}
            )
            
            logger.info(f"Contract {contract_id} rejected: {reason}")
            
            return {
                'contract_id': contract_id,
                'workflow_state': 'DRAFT_READY',
                'reason': reason
            }
        
        except Exception as e:
            logger.error(f"Rejection failed: {e}")
            raise
    
    @staticmethod
    async def _promote_to_published(contract_id: str) -> int:
        """
        Promote draft parameters to published corpus.
        Rule 3: Draft and published data never mix.
        """
        query = """
            INSERT INTO published_parameters (
                contract_id, param_id, parameter_name, parameter_group,
                final_value, supporting_text, confidence,
                page_number, bbox_x1, bbox_y1, bbox_x2, bbox_y2
            )
            SELECT 
                p.contract_id,
                p.param_id,
                p.parameter_name,
                p.parameter_group,
                COALESCE(p.edited_value, p.extracted_value) as final_value,
                p.supporting_text,
                p.confidence,
                g.page_number,
                g.bbox_x1,
                g.bbox_y1,
                g.bbox_x2,
                g.bbox_y2
            FROM draft_parameters p
            LEFT JOIN draft_grounding_records g ON p.param_id = g.param_id
            WHERE p.contract_id = :contract_id
              AND (p.reviewer_status = 'ACCEPTED' OR p.reviewer_status = 'EDITED' OR p.reviewer_status IS NULL)
              AND p.validation_status != 'MISSING'
        """
        
        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(query, {'contract_id': contract_id})
                promoted_count = cursor.rowcount
                await conn.commit()
        
        return promoted_count
    
    @staticmethod
    async def _update_contract_approval(contract_id: str, user_id: str):
        """Update contract with approval info."""
        query = """
            UPDATE contracts
            SET approved_by = :user_id,
                approved_at = CURRENT_TIMESTAMP,
                published_at = CURRENT_TIMESTAMP
            WHERE contract_id = :contract_id
        """
        
        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(query, {
                    'contract_id': contract_id,
                    'user_id': user_id
                })
                await conn.commit()
    
    @staticmethod
    async def get_pending_approvals() -> list:
        """Get all contracts pending approval."""
        query = """
            SELECT contract_id, original_filename, customer_name, contract_type,
                   uploaded_by, uploaded_at
            FROM contracts
            WHERE workflow_state = 'REVIEW_PENDING'
            ORDER BY uploaded_at DESC
        """
        
        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(query)
                rows = await cursor.fetchall()
                
                return [
                    {
                        'contract_id': row[0],
                        'original_filename': row[1],
                        'customer_name': row[2],
                        'contract_type': row[3],
                        'uploaded_by': row[4],
                        'uploaded_at': row[5]
                    }
                    for row in rows
                ]
