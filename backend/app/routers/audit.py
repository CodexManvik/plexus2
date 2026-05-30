"""
Audit log routes.
Phase 1: Basic implementation for audit log querying.
"""

from fastapi import APIRouter, HTTPException, status, Depends, Query
from typing import Optional
from datetime import datetime
from ..auth.dependencies import get_current_user, require_role
from ..auth.models import UserRole
from ..services.audit_service import AuditService

router = APIRouter(prefix="/audit", tags=["Audit"])


@router.get("/logs")
async def query_audit_logs(
    contract_id: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
    entity_type: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(require_role(UserRole.ADMIN, UserRole.OPERATION_HEAD))
):
    """
    Query audit logs with filters.
    Admin and Operation Head only.
    """
    logs = await AuditService.query_logs(
        contract_id=contract_id,
        user_id=user_id,
        action=action,
        entity_type=entity_type,
        limit=limit,
        offset=offset
    )
    
    return {
        'logs': logs,
        'count': len(logs),
        'limit': limit,
        'offset': offset
    }


@router.get("/contracts/{contract_id}")
async def get_contract_audit_trail(
    contract_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Get complete audit trail for a specific contract."""
    logs = await AuditService.get_contract_audit_trail(contract_id)
    
    return {
        'contract_id': contract_id,
        'logs': logs,
        'count': len(logs)
    }


@router.get("/users/{user_id}")
async def get_user_activity(
    user_id: str,
    days: int = Query(30, ge=1, le=365),
    current_user: dict = Depends(require_role(UserRole.ADMIN))
):
    """Get recent activity for a specific user. Admin only."""
    logs = await AuditService.get_user_activity(user_id, days)
    
    return {
        'user_id': user_id,
        'days': days,
        'logs': logs,
        'count': len(logs)
    }
