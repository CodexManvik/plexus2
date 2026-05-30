"""
Approval workflow routes.
Phase 4: Full implementation.
"""

from fastapi import APIRouter, HTTPException, status, Depends
from pydantic import BaseModel
from typing import Optional
from ..auth.dependencies import require_role
from ..auth.models import UserRole
from ..services.approval_service import ApprovalService
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/approval", tags=["Approval"])


class ApprovalRequest(BaseModel):
    """Model for approval request."""
    comments: Optional[str] = None


class RejectionRequest(BaseModel):
    """Model for rejection request."""
    reason: str


@router.get("/pending")
async def get_pending_approvals(
    current_user: dict = Depends(require_role(UserRole.OPERATION_HEAD))
):
    """Get all contracts pending approval."""
    try:
        pending = await ApprovalService.get_pending_approvals()
        
        return {
            'pending': pending,
            'count': len(pending)
        }
    
    except Exception as e:
        logger.error(f"Failed to get pending approvals: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get pending approvals: {str(e)}"
        )


@router.post("/{contract_id}/approve")
async def approve_contract(
    contract_id: str,
    request: ApprovalRequest,
    current_user: dict = Depends(require_role(UserRole.OPERATION_HEAD))
):
    """Approve contract and publish to corpus."""
    try:
        result = await ApprovalService.approve_contract(
            contract_id=contract_id,
            user_id=current_user['user_id'],
            comments=request.comments
        )
        
        return result
    
    except Exception as e:
        logger.error(f"Approval failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Approval failed: {str(e)}"
        )


@router.post("/{contract_id}/reject")
async def reject_contract(
    contract_id: str,
    request: RejectionRequest,
    current_user: dict = Depends(require_role(UserRole.OPERATION_HEAD))
):
    """Reject contract and return for re-review."""
    try:
        result = await ApprovalService.reject_contract(
            contract_id=contract_id,
            user_id=current_user['user_id'],
            reason=request.reason
        )
        
        return result
    
    except Exception as e:
        logger.error(f"Rejection failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Rejection failed: {str(e)}"
        )
