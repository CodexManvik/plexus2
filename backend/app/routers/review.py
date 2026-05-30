"""
Draft review routes.
Phase 3: Full implementation.
"""

from fastapi import APIRouter, HTTPException, status, Depends
from pydantic import BaseModel
from typing import Optional
from ..auth.dependencies import get_current_user, require_role
from ..auth.models import UserRole
from ..services.extraction_service import ExtractionService
from ..services.workflow_service import WorkflowService
from ..services.audit_service import AuditService
from ..services.review_session_service import ReviewSessionService
from ..database import db_pool
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/review", tags=["Review"])


class ParameterUpdate(BaseModel):
    """Model for parameter update request."""
    edited_value: str
    reviewer_status: str  # ACCEPTED, EDITED, REJECTED


class SessionSaveRequest(BaseModel):
    """Review session snapshot payload."""
    last_param_id:   Optional[str] = None
    scroll_position: int = 0


@router.get("/{contract_id}/parameters")
async def get_draft_parameters(
    contract_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Get draft parameters for review."""
    try:
        parameters = await ExtractionService.get_draft_parameters(contract_id)
        
        return {
            'contract_id': contract_id,
            'parameters': parameters,
            'count': len(parameters)
        }
    
    except Exception as e:
        logger.error(f"Failed to get parameters: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get parameters: {str(e)}"
        )


@router.put("/{contract_id}/parameters/{param_id}")
async def update_parameter(
    contract_id: str,
    param_id: str,
    update: ParameterUpdate,
    current_user: dict = Depends(require_role(UserRole.OPERATION_USER, UserRole.OPERATION_HEAD))
):
    """Update a draft parameter value."""
    try:
        # Transition to USER_EDITING if not already
        current_state = await WorkflowService.get_current_state(contract_id)
        if current_state == 'DRAFT_READY':
            await WorkflowService.transition(
                contract_id=contract_id,
                to_state='USER_EDITING',
                user_id=current_user['user_id'],
                reason='Started parameter review'
            )
        
        # Update parameter
        query = """
            UPDATE draft_parameters
            SET edited_value = :edited_value,
                edited_by = :edited_by,
                edited_at = CURRENT_TIMESTAMP,
                reviewer_status = :reviewer_status
            WHERE param_id = :param_id AND contract_id = :contract_id
        """
        
        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(query, {
                    'edited_value': update.edited_value,
                    'edited_by': current_user['user_id'],
                    'reviewer_status': update.reviewer_status,
                    'param_id': param_id,
                    'contract_id': contract_id
                })
                await conn.commit()
        
        # Audit log
        await AuditService.log(
            contract_id=contract_id,
            user_id=current_user['user_id'],
            action='PARAMETER_EDITED',
            entity_type='parameter',
            entity_id=param_id,
            new_value=update.edited_value,
            metadata={'reviewer_status': update.reviewer_status}
        )
        
        return {
            'param_id': param_id,
            'status': 'updated'
        }
    
    except Exception as e:
        logger.error(f"Failed to update parameter: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update parameter: {str(e)}"
        )


@router.post("/{contract_id}/submit")
async def submit_for_approval(
    contract_id: str,
    current_user: dict = Depends(require_role(UserRole.OPERATION_USER))
):
    """Submit contract for approval and deactivate the review session."""
    try:
        await WorkflowService.transition(
            contract_id=contract_id,
            to_state='REVIEW_PENDING',
            user_id=current_user['user_id'],
            reason='Submitted for approval'
        )

        # Deactivate the active review session — no longer needed
        await ReviewSessionService.deactivate_session(
            contract_id=contract_id,
            user_id=current_user['user_id'],
        )

        # Audit log
        await AuditService.log(
            contract_id=contract_id,
            user_id=current_user['user_id'],
            action='SUBMITTED_FOR_APPROVAL',
            entity_type='contract',
            entity_id=contract_id
        )

        return {
            'contract_id': contract_id,
            'workflow_state': 'REVIEW_PENDING'
        }

    except Exception as e:
        logger.error(f"Failed to submit: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to submit: {str(e)}"
        )


@router.post("/{contract_id}/session/save")
async def save_review_session(
    contract_id: str,
    body: SessionSaveRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Persist the reviewer's current position in the parameter list.
    Called on every parameter action and on a 60-second interval from the frontend.
    """
    try:
        session_id = await ReviewSessionService.save_session(
            contract_id=contract_id,
            user_id=current_user['user_id'],
            last_param_id=body.last_param_id,
            scroll_position=body.scroll_position,
        )
        return {'session_id': session_id, 'saved': True}
    except Exception as e:
        logger.error(f"Failed to save review session: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save review session: {str(e)}"
        )


@router.get("/{contract_id}/session/restore")
async def restore_review_session(
    contract_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Retrieve the last saved review position for this user and contract.
    Returns null session fields if no session exists (first visit).
    """
    try:
        session = await ReviewSessionService.restore_session(
            contract_id=contract_id,
            user_id=current_user['user_id'],
        )
        if session is None:
            return {'session': None, 'first_visit': True}
        return {'session': session, 'first_visit': False}
    except Exception as e:
        logger.error(f"Failed to restore review session: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to restore review session: {str(e)}"
        )
