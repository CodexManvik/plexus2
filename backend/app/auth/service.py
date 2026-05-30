"""
Authentication service layer.
Handles user management, JWT token generation, and password operations.
"""

from datetime import datetime, timedelta
from typing import Optional, Tuple
import uuid
import bcrypt
from jose import JWTError, jwt

from ..config import settings
from ..database import db_pool, execute_query
from .models import UserCreate, UserRole, TokenPayload
import logging

logger = logging.getLogger(__name__)


class AuthService:
    """Handles all authentication and user management operations."""
    
    @staticmethod
    def hash_password(password: str) -> str:
        """Hash password using bcrypt with 12 rounds."""
        salt = bcrypt.gensalt(rounds=12)
        return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')
    
    @staticmethod
    def verify_password(plain_password: str, hashed_password: str) -> bool:
        """Verify password against bcrypt hash."""
        return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))
    
    @staticmethod
    def create_access_token(user_id: str, email: str, role: UserRole) -> Tuple[str, datetime]:
        """
        Create JWT access token.
        Returns: (token, expiration_datetime)
        """
        expires_at = datetime.utcnow() + timedelta(minutes=settings.access_token_expire_minutes)
        
        payload = {
            'sub': user_id,
            'email': email,
            'role': role.value if isinstance(role, UserRole) else role,
            'exp': expires_at,
            'iat': datetime.utcnow(),
            'type': 'access'
        }
        
        token = jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)
        if isinstance(token, bytes):
            token = token.decode('utf-8')
        return token, expires_at
    
    @staticmethod
    def create_refresh_token(user_id: str) -> Tuple[str, datetime]:
        """
        Create JWT refresh token.
        Returns: (token, expiration_datetime)
        """
        expires_at = datetime.utcnow() + timedelta(days=settings.refresh_token_expire_days)
        
        payload = {
            'sub': user_id,
            'exp': expires_at,
            'iat': datetime.utcnow(),
            'type': 'refresh',
            'jti': str(uuid.uuid4())  # unique token ID
        }
        
        token = jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)
        if isinstance(token, bytes):
            token = token.decode('utf-8')
        return token, expires_at
    
    @staticmethod
    def decode_token(token: str) -> Optional[dict]:
        """Decode and validate JWT token."""
        try:
            payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
            return payload
        except JWTError as e:
            logger.warning(f"Token decode failed: {e}")
            return None
    
    @staticmethod
    async def create_user(user_data: UserCreate) -> dict:
        """
        Create new user in database.
        Uses INSERT then SELECT — oracledb async does not support cursor.var()
        the same way as cx_Oracle. RETURNING INTO is avoided deliberately.
        Returns user record dict.
        """
        user_id = uuid.uuid4().hex.upper()
        password_hash = AuthService.hash_password(user_data.password)

        insert_query = """
            INSERT INTO users (user_id, email, password_hash, full_name, role, is_active)
            VALUES (HEXTORAW(:user_id), :email, :password_hash, :full_name, :role, 1)
        """

        select_query = """
            SELECT user_id, email, full_name, role, is_active, created_at, updated_at
            FROM users
            WHERE user_id = HEXTORAW(:user_id)
        """

        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(insert_query, {
                    'user_id':       user_id,
                    'email':         user_data.email,
                    'password_hash': password_hash,
                    'full_name':     user_data.full_name,
                    'role':          user_data.role.value,
                })
                await conn.commit()

                await cursor.execute(select_query, {'user_id': user_id})
                row = await cursor.fetchone()

                if not row:
                    raise RuntimeError(f"User insert succeeded but SELECT returned nothing for user_id={user_id}")

                return {
                    'user_id':    row[0],
                    'email':      row[1],
                    'full_name':  row[2],
                    'role':       row[3],
                    'is_active':  bool(row[4]),
                    'created_at': row[5],
                    'updated_at': row[6],
                }
    
    @staticmethod
    async def get_user_by_email(email: str) -> Optional[dict]:
        """Retrieve user by email address."""
        query = """
            SELECT user_id, email, password_hash, full_name, role, is_active, created_at, updated_at
            FROM users
            WHERE email = :email
        """
        
        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(query, {'email': email})
                row = await cursor.fetchone()
                
                if not row:
                    return None
                
                return {
                    'user_id': row[0],
                    'email': row[1],
                    'password_hash': row[2],
                    'full_name': row[3],
                    'role': row[4],
                    'is_active': bool(row[5]),
                    'created_at': row[6],
                    'updated_at': row[7]
                }
    
    @staticmethod
    async def get_user_by_id(user_id: str) -> Optional[dict]:
        """Retrieve user by user_id."""
        query = """
            SELECT user_id, email, full_name, role, is_active, created_at, updated_at
            FROM users
            WHERE user_id = :user_id
        """
        
        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(query, {'user_id': user_id})
                row = await cursor.fetchone()
                
                if not row:
                    return None
                
                return {
                    'user_id': row[0],
                    'email': row[1],
                    'full_name': row[2],
                    'role': row[3],
                    'is_active': bool(row[4]),
                    'created_at': row[5],
                    'updated_at': row[6]
                }
    
    @staticmethod
    async def store_refresh_token(user_id: str, token: str, expires_at: datetime):
        """Store refresh token hash in database."""
        token_hash = AuthService.hash_password(token)
        
        query = """
            INSERT INTO refresh_tokens (user_id, token_hash, expires_at, revoked)
            VALUES (:user_id, :token_hash, :expires_at, 0)
        """
        
        await execute_query(query, {
            'user_id': user_id,
            'token_hash': token_hash,
            'expires_at': expires_at
        })
    
    @staticmethod
    async def revoke_refresh_token(token: str):
        """Mark refresh token as revoked."""
        query = """
            UPDATE refresh_tokens
            SET revoked = 1
            WHERE token_hash = :token_hash
        """
        
        token_hash = AuthService.hash_password(token)
        await execute_query(query, {'token_hash': token_hash})
    
    @staticmethod
    async def authenticate_user(email: str, password: str) -> Optional[dict]:
        """
        Authenticate user with email and password.
        Returns user dict if successful, None otherwise.
        """
        user = await AuthService.get_user_by_email(email)
        
        if not user:
            return None
        
        if not user['is_active']:
            return None
        
        if not AuthService.verify_password(password, user['password_hash']):
            return None
        
        # Remove password_hash from returned dict
        user.pop('password_hash', None)
        return user
