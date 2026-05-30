"""
Configuration management for Plexus backend.
Loads environment variables and validates required settings.
Fails fast if critical configuration is missing.
"""

from pydantic_settings import BaseSettings
from pydantic import Field, validator
from typing import Optional
import sys


class Settings(BaseSettings):
    """Application settings with strict validation."""
    
    # Oracle Database
    oracle_user: str = Field(..., env='ORACLE_USER')
    oracle_password: str = Field(..., env='ORACLE_PASSWORD')
    oracle_dsn: str = Field(..., env='ORACLE_DSN')
    oracle_wallet_path: Optional[str] = Field(None, env='ORACLE_WALLET_PATH')
    
    # OCI Object Storage (Optional for Phase 1, required in Phase 2+)
    oci_namespace: Optional[str] = Field(None, env='OCI_NAMESPACE')
    oci_bucket_name: Optional[str] = Field(None, env='OCI_BUCKET_NAME')
    oci_region: Optional[str] = Field(None, env='OCI_REGION')
    oci_config_file: str = Field(default='~/.oci/config', env='OCI_CONFIG_FILE')
    oci_profile: str = Field(default='DEFAULT', env='OCI_PROFILE')
    
    # Groq API
    groq_api_key: str = Field(..., env='GROQ_API_KEY')
    groq_model_heavy: str = Field(default='llama-3.3-70b-versatile', env='GROQ_MODEL_HEAVY')
    groq_model_fast: str = Field(default='llama-3.1-8b-instant', env='GROQ_MODEL_FAST')
    
    # Cohere API
    cohere_api_key: str = Field(..., env='COHERE_API_KEY')
    cohere_embed_model: str = Field(default='embed-english-v3.0', env='COHERE_EMBED_MODEL')
    
    # Auth
    jwt_secret_key: str = Field(..., env='JWT_SECRET_KEY')
    jwt_algorithm: str = Field(default='HS256', env='JWT_ALGORITHM')
    access_token_expire_minutes: int = Field(default=15, env='ACCESS_TOKEN_EXPIRE_MINUTES')
    refresh_token_expire_days: int = Field(default=7, env='REFRESH_TOKEN_EXPIRE_DAYS')
    
    # Application
    backend_url: str = Field(default='http://localhost:8000', env='BACKEND_URL')
    frontend_url: str = Field(default='http://localhost:3000', env='FRONTEND_URL')
    environment: str = Field(default='development', env='ENVIRONMENT')
    
    @validator('jwt_secret_key')
    def validate_jwt_secret(cls, v):
        if len(v) < 32:
            raise ValueError('JWT_SECRET_KEY must be at least 32 characters. Generate with: openssl rand -hex 32')
        return v
    
    @validator('oracle_dsn')
    def validate_oracle_dsn(cls, v):
        if ':' not in v or '/' not in v:
            raise ValueError('ORACLE_DSN must be in format: hostname:port/servicename')
        return v
    
    class Config:
        env_file = '.env'
        case_sensitive = False
        extra = 'ignore'  # Ignore extra fields in .env


def load_settings() -> Settings:
    """
    Load and validate settings.
    Exits with clear error message if required variables are missing.
    """
    try:
        return Settings()
    except Exception as e:
        print(f"\n❌ CONFIGURATION ERROR: {str(e)}\n", file=sys.stderr)
        print("Required environment variables are missing or invalid.", file=sys.stderr)
        print("Copy .env.example to .env and fill in all required values.\n", file=sys.stderr)
        sys.exit(1)


# Global settings instance
settings = load_settings()
