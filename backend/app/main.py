"""
Plexus FastAPI Application
Main entry point for the backend API server.
"""

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
import logging
import sys

from .config import settings
from .database import db_pool
from .auth.service import AuthService
from .auth.models import UserCreate, UserRole
from .utils.groq_client import groq_client

# Import routers
from .auth.router import router as auth_router
from .routers.contracts import router as contracts_router
from .routers.upload import router as upload_router
from .routers.extraction import router as extraction_router
from .routers.review import router as review_router
from .routers.approval import router as approval_router
from .routers.assistant import router as assistant_router
from .routers.audit import router as audit_router
from .routers.admin import router as admin_router
from .routers.websocket import router as ws_router
from .routers.queue import router as queue_router

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)

logger = logging.getLogger(__name__)


# Fixed UUID for the seeded dev admin — must match all existing references
_DEV_ADMIN_UUID = '89BF383A5F3548AC98108947D04C2B43'


async def seed_dev_users() -> None:
    """
    Upsert the dev users using MERGE INTO.
    Only called when SEED_ADMIN=true in .env.
    The UUIDs are stable so FK constraints in audit_log resolve correctly.
    """
    from .database import db_pool

    users_to_seed = [
        {
            'user_id':       '89BF383A5F3548AC98108947D04C2B43',
            'email':         'admin@plexus.com',
            'password':      'Admin@123456',
            'full_name':     'System Administrator',
            'role':          'admin',
        },
        {
            'user_id':       '79BF383A5F3548AC98108947D04C2B44',
            'email':         'user@plexus.com',
            'password':      'User@123456',
            'full_name':     'Operation User',
            'role':          'operation_user',
        },
        {
            'user_id':       '69BF383A5F3548AC98108947D04C2B45',
            'email':         'head@plexus.com',
            'password':      'Head@123456',
            'full_name':     'Operation Head',
            'role':          'operation_head',
        }
    ]

    # RAW(16) literals in Oracle must be supplied as HEXTORAW(:hex_value)
    merge_sql = """
        MERGE INTO users tgt
        USING (
            SELECT HEXTORAW(:user_id) AS user_id FROM DUAL
        ) src ON (tgt.user_id = src.user_id)
        WHEN NOT MATCHED THEN
            INSERT (user_id, email, password_hash, full_name, role, is_active)
            VALUES (HEXTORAW(:user_id), :email, :password_hash, :full_name, :role, 1)
        WHEN MATCHED THEN
            UPDATE SET
                password_hash = :password_hash,
                full_name     = :full_name,
                role          = :role,
                is_active     = 1
    """

    async with db_pool.get_connection() as conn:
        async with conn.cursor() as cursor:
            for u in users_to_seed:
                password_hash = AuthService.hash_password(u['password'])
                await cursor.execute(merge_sql, {
                    'user_id':       u['user_id'],
                    'email':         u['email'],
                    'password_hash': password_hash,
                    'full_name':     u['full_name'],
                    'role':          u['role'],
                })
            await conn.commit()

    logger.info("✓ Dev users seeded (admin@plexus.com, user@plexus.com, head@plexus.com)")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager for startup and shutdown."""
    # Startup
    logger.info("Starting Plexus backend...")
    logger.info(f"Environment: {settings.environment}")
    logger.info(f"Backend URL: {settings.backend_url}")
    
    # Log LLM backend status
    if settings.llm_backend == "local":
        logger.info(f"✓ LLM Backend: Local llama.cpp ({settings.local_llm_url})")
    else:
        logger.info("✓ LLM Backend: Groq API")

    try:
        # Initialize LLM client (groq_client routes to local or Groq based on config)
        _ = groq_client  # Trigger initialization and log startup message
    except Exception as e:
        logger.error(f"Failed to initialize LLM client: {e}")
        raise

    try:
        await db_pool.initialize()
        logger.info("✓ Database connection pool initialized")
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")
        raise

    if settings.seed_admin:
        try:
            await seed_dev_users()
        except Exception as e:
            logger.error(f"Admin/dev user seed failed: {e}")
            raise

    logger.info("✓ Plexus backend started successfully")
    
    yield
    
    # Shutdown
    logger.info("🛑 Shutting down Plexus backend...")
    await db_pool.close()
    logger.info("✓ Database connection pool closed")
    logger.info("✓ Plexus backend shutdown complete")


# Create FastAPI application
app = FastAPI(
    title="Plexus Contract Intelligence Platform",
    description="AI-assisted contract intelligence with Oracle 26ai backend",
    version="1.0.0",
    lifespan=lifespan
)


# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Global exception handler
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Catch-all exception handler for unhandled errors."""
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "detail": "Internal server error",
            "error": str(exc) if settings.environment == "development" else "An error occurred"
        }
    )


# Health check endpoint
@app.get("/health", tags=["System"])
async def health_check():
    """Health check endpoint for monitoring."""
    return {
        "status": "healthy",
        "environment": settings.environment,
        "version": "1.0.0"
    }


@app.get("/", tags=["System"])
async def root():
    """Root endpoint with API information."""
    return {
        "name": "Plexus Contract Intelligence Platform",
        "version": "1.0.0",
        "status": "operational",
        "docs": "/docs",
        "health": "/health"
    }


# Mount routers
app.include_router(auth_router)
app.include_router(contracts_router)
app.include_router(upload_router)
app.include_router(extraction_router)
app.include_router(review_router)
app.include_router(approval_router)
app.include_router(assistant_router)
app.include_router(audit_router)
app.include_router(admin_router)
app.include_router(ws_router)
app.include_router(queue_router)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.environment == "development"
    )
