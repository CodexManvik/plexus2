"""
Workflow state machine service.
Manages contract workflow state transitions with validation.
All state changes MUST go through this service.
"""

from typing import Optional
from ..database import db_pool
from .audit_service import AuditService
import logging

logger = logging.getLogger(__name__)


# Allowed state transitions map
# Rule 4: Workflow transitions are centralized
ALLOWED_TRANSITIONS = {
    'UPLOADED':               ['PARSING'],
    'PARSING':                ['TAG_SUGGESTION_READY'],
    'TAG_SUGGESTION_READY':   ['EXTRACTION_RUNNING'],
    'EXTRACTION_RUNNING':     ['GROUNDING_RUNNING'],
    'GROUNDING_RUNNING':      ['VALIDATION_RUNNING'],
    'VALIDATION_RUNNING':     ['DRAFT_READY'],
    'DRAFT_READY':            ['USER_EDITING'],
    'USER_EDITING':           ['PAUSED', 'REVIEW_PENDING'],
    'PAUSED':                 ['USER_EDITING'],
    'REVIEW_PENDING':         ['APPROVED', 'REJECTED', 'USER_EDITING'],
    'APPROVED':               ['PUBLISHED'],
    'PUBLISHED':              ['ARCHIVED'],
    'REJECTED':               ['DRAFT_READY'],
    'ARCHIVED':               [],
}


class WorkflowService:
    """Manages contract workflow state transitions."""
    
    @staticmethod
    async def get_current_state(contract_id: str) -> Optional[str]:
        """Get current workflow state for a contract."""
        query = "SELECT workflow_state FROM contracts WHERE contract_id = HEXTORAW(:contract_id)"
        
        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(query, {'contract_id': contract_id})
                row = await cursor.fetchone()
                return row[0] if row else None
    
    @staticmethod
    def is_transition_allowed(from_state: str, to_state: str) -> bool:
        """Check if a state transition is allowed."""
        allowed = ALLOWED_TRANSITIONS.get(from_state, [])
        return to_state in allowed
    
    @staticmethod
    async def transition(
        contract_id: str,
        to_state: str,
        user_id: Optional[str] = None,
        reason: Optional[str] = None
    ) -> bool:
        """
        Transition contract to new state.
        Validates transition is allowed and logs to audit trail.
        
        Args:
            contract_id: Contract UUID
            to_state: Target state
            user_id: User triggering the transition (optional for system transitions)
            reason: Optional reason for transition
        
        Returns:
            True if transition successful, False otherwise
        
        Raises:
            ValueError: If transition is not allowed
        """
        current_state = await WorkflowService.get_current_state(contract_id)
        
        if not current_state:
            raise ValueError(f"Contract {contract_id} not found")
        
        if not WorkflowService.is_transition_allowed(current_state, to_state):
            raise ValueError(
                f"Invalid state transition: {current_state} -> {to_state}. "
                f"Allowed transitions from {current_state}: {ALLOWED_TRANSITIONS.get(current_state, [])}"
            )
        
        # Update contract state
        update_query = """
            UPDATE contracts
            SET workflow_state = :to_state,
                updated_at = CURRENT_TIMESTAMP
            WHERE contract_id = HEXTORAW(:contract_id)
        """
        
        # Record transition
        transition_query = """
            INSERT INTO workflow_transitions (contract_id, from_state, to_state, triggered_by, reason)
            VALUES (HEXTORAW(:contract_id), :from_state, :to_state, HEXTORAW(:triggered_by), :reason)
        """
        
        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                # Update state
                await cursor.execute(update_query, {
                    'contract_id': contract_id,
                    'to_state': to_state
                })
                
                # Record transition
                await cursor.execute(transition_query, {
                    'contract_id': contract_id,
                    'from_state': current_state,
                    'to_state': to_state,
                    'triggered_by': user_id or None,
                    'reason': reason
                })
                
                await conn.commit()
        
        # Audit log
        await AuditService.log(
            contract_id=contract_id,
            user_id=user_id,
            action='WORKFLOW_TRANSITION',
            entity_type='contract',
            entity_id=contract_id,
            old_value=current_state,
            new_value=to_state,
            metadata={'reason': reason} if reason else None
        )
        
        logger.info(f"Contract {contract_id} transitioned: {current_state} -> {to_state}")
        return True
    
    @staticmethod
    async def get_transition_history(contract_id: str) -> list:
        """Get full transition history for a contract."""
        query = """
            SELECT transition_id, from_state, to_state, RAWTOHEX(triggered_by), reason, created_at
            FROM workflow_transitions
            WHERE contract_id = HEXTORAW(:contract_id)
            ORDER BY created_at ASC
        """
        
        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(query, {'contract_id': contract_id})
                rows = await cursor.fetchall()
                
                return [
                    {
                        'transition_id': row[0],
                        'from_state': row[1],
                        'to_state': row[2],
                        'triggered_by': row[3],
                        'reason': row[4],
                        'created_at': row[5]
                    }
                    for row in rows
                ]
    
    @staticmethod
    async def can_user_edit(contract_id: str, user_role: str) -> bool:
        """
        Check if user can edit contract based on current state and role.
        
        Rules:
        - operation_user: can edit in USER_EDITING, PAUSED, REJECTED states
        - operation_head: can edit in REVIEW_PENDING state
        - admin: can edit in any state
        """
        current_state = await WorkflowService.get_current_state(contract_id)
        
        if user_role == 'admin':
            return True
        
        if user_role == 'operation_user':
            return current_state in ['USER_EDITING', 'PAUSED', 'REJECTED', 'DRAFT_READY']
        
        if user_role == 'operation_head':
            return current_state in ['REVIEW_PENDING']
        
        return False
