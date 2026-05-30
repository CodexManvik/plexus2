"""
Extraction pipeline routes.
Phase 3: Full implementation.
"""

from fastapi import APIRouter, HTTPException, status, Depends
from ..auth.dependencies import get_current_user, require_role
from ..auth.models import UserRole
from ..services.extraction_service import ExtractionService
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/extraction", tags=["Extraction"])


@router.post("/{contract_id}/start")
async def start_extraction(
    contract_id: str,
    current_user: dict = Depends(require_role(UserRole.OPERATION_USER, UserRole.OPERATION_HEAD))
):
    """
    Start extraction pipeline for a contract.
    
    Workflow: TAG_SUGGESTION_READY → EXTRACTION_RUNNING → GROUNDING_RUNNING → 
              VALIDATION_RUNNING → DRAFT_READY
    """
    try:
        result = await ExtractionService.run_extraction(
            contract_id=contract_id,
            user_id=current_user['user_id']
        )
        
        return result
    
    except Exception as e:
        logger.error(f"Extraction failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Extraction failed: {str(e)}"
        )


@router.get("/{contract_id}/status")
async def get_extraction_status(
    contract_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Get extraction pipeline status."""
    try:
        from ..services.workflow_service import WorkflowService
        
        state = await WorkflowService.get_current_state(contract_id)
        
        return {
            'contract_id': contract_id,
            'workflow_state': state,
            'is_complete': state in ['DRAFT_READY', 'USER_EDITING', 'PAUSED', 'REVIEW_PENDING']
        }
    
    except Exception as e:
        logger.error(f"Failed to get status: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get status: {str(e)}"
        )
