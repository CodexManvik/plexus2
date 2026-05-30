"""
FastAPI dependencies for authentication and authorization.
Used in route handlers to enforce authentication and role-based access control.
"""

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import Optional

from .service import AuthService
from .models import UserRole
import logging

logger = logging.getLogger(__name__)

from ..config import settings
from datetime import datetime

security = HTTPBearer(auto_error=False)


async def get_current_user(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> dict:
    """
    Dependency to extract and validate current user from JWT token.
    JWT validation is mandatory in all environments — no bypasses.
    """
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"}
        )
        
    token = credentials.credentials
    
    payload = AuthService.decode_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"}
        )
    
    if payload.get('type') != 'access':
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type",
            headers={"WWW-Authenticate": "Bearer"}
        )
    
    user_id = payload.get('sub')
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
            headers={"WWW-Authenticate": "Bearer"}
        )
    
    user = await AuthService.get_user_by_id(user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"}
        )
    
    if not user['is_active']:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive"
        )
    
    return user


def require_role(*allowed_roles: UserRole):
    """
    Dependency factory for role-based access control.
    Returns a dependency that checks if current user has one of the allowed roles.
    
    Usage:
        @router.post("/admin-only")
        async def admin_route(current_user = Depends(require_role(UserRole.ADMIN))):
            return {"message": "Admin access granted"}
        
        @router.get("/operations")
        async def ops_route(current_user = Depends(require_role(UserRole.OPERATION_HEAD, UserRole.OPERATION_USER))):
            return {"message": "Operations access granted"}
    """
    async def role_checker(current_user: dict = Depends(get_current_user)) -> dict:
        user_role = current_user.get('role')
        
        # Admin has access to everything
        if user_role == UserRole.ADMIN.value:
            return current_user
        
        # Check if user role is in allowed roles
        allowed_role_values = [role.value for role in allowed_roles]
        if user_role not in allowed_role_values:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Insufficient permissions. Required roles: {', '.join(allowed_role_values)}"
            )
        
        return current_user
    
    return role_checker


async def get_optional_user(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> Optional[dict]:
    """
    Dependency to extract current user if token is provided, but don't fail if missing.
    Useful for endpoints that have different behavior for authenticated vs anonymous users.
    
    Usage:
        @router.get("/public-or-private")
        async def flexible_route(current_user = Depends(get_optional_user)):
            if current_user:
                return {"message": f"Hello {current_user['full_name']}"}
            return {"message": "Hello anonymous user"}
    """
    if not credentials:
        return None
    
    try:
        return await get_current_user(credentials)
    except HTTPException:
        return None
