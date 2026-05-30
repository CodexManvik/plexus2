"""
Authentication API routes.
Handles user registration, login, token refresh, and logout.
"""

from fastapi import APIRouter, HTTPException, status, Depends
from .models import (
    UserCreate, UserResponse, LoginRequest, TokenResponse,
    RefreshTokenRequest, UserRole
)
from .service import AuthService
from .dependencies import get_current_user, require_role
from ..services.audit_service import AuditService
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register_user(
    user_data: UserCreate,
    current_user: dict = Depends(require_role(UserRole.ADMIN))
):
    """
    Register a new user. Admin only.
    Enforces password complexity and unique email.
    """
    # Check if email already exists
    existing_user = await AuthService.get_user_by_email(user_data.email)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    try:
        user = await AuthService.create_user(user_data)
        
        # Audit log
        await AuditService.log(
            user_id=current_user['user_id'],
            action='USER_CREATED',
            entity_type='user',
            entity_id=user['user_id'],
            new_value=user_data.email,
            metadata={'role': user_data.role.value, 'created_by': current_user['email']}
        )
        
        logger.info(f"User created: {user['email']} by {current_user['email']}")
        return user
    
    except Exception as e:
        logger.error(f"User registration failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="User registration failed"
        )


@router.post("/login", response_model=TokenResponse)
async def login(credentials: LoginRequest):
    """
    Authenticate user and return access + refresh tokens.
    Logs failed login attempts.
    """
    user = await AuthService.authenticate_user(credentials.email, credentials.password)
    
    if not user:
        # Audit failed login
        await AuditService.log(
            user_id=None,
            action='LOGIN_FAILED',
            entity_type='auth',
            entity_id=credentials.email,
            metadata={'reason': 'invalid_credentials'}
        )
        
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"}
        )
    
    # Generate tokens
    access_token, access_expires = AuthService.create_access_token(
        user['user_id'], user['email'], user['role']
    )
    refresh_token, refresh_expires = AuthService.create_refresh_token(user['user_id'])
    
    # Store refresh token
    await AuthService.store_refresh_token(user['user_id'], refresh_token, refresh_expires)
    
    # Audit successful login
    await AuditService.log(
        user_id=user['user_id'],
        action='LOGIN_SUCCESS',
        entity_type='auth',
        entity_id=user['email'],
        metadata={'role': user['role']}
    )
    
    logger.info(f"User logged in: {user['email']}")
    
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        expires_in=60 * 15  # 15 minutes in seconds
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(request: RefreshTokenRequest):
    """
    Exchange refresh token for new access + refresh tokens.
    Revokes old refresh token.
    """
    payload = AuthService.decode_token(request.refresh_token)
    
    if not payload or payload.get('type') != 'refresh':
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
            headers={"WWW-Authenticate": "Bearer"}
        )
    
    user_id = payload.get('sub')
    user = await AuthService.get_user_by_id(user_id)
    
    if not user or not user['is_active']:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
            headers={"WWW-Authenticate": "Bearer"}
        )
    
    # Revoke old refresh token
    await AuthService.revoke_refresh_token(request.refresh_token)
    
    # Generate new tokens
    access_token, access_expires = AuthService.create_access_token(
        user['user_id'], user['email'], user['role']
    )
    refresh_token, refresh_expires = AuthService.create_refresh_token(user['user_id'])
    
    # Store new refresh token
    await AuthService.store_refresh_token(user['user_id'], refresh_token, refresh_expires)
    
    logger.info(f"Token refreshed for user: {user['email']}")
    
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        expires_in=60 * 15
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: RefreshTokenRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Logout user by revoking refresh token.
    """
    await AuthService.revoke_refresh_token(request.refresh_token)
    
    # Audit logout
    await AuditService.log(
        user_id=current_user['user_id'],
        action='LOGOUT',
        entity_type='auth',
        entity_id=current_user['email']
    )
    
    logger.info(f"User logged out: {current_user['email']}")


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(current_user: dict = Depends(get_current_user)):
    """
    Get current authenticated user information.
    """
    return current_user
