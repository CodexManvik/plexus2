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

# Import routers
from .auth.router import router as auth_router
from .routers.contracts import router as contracts_router
from .routers.upload import router as upload_router
from .routers.extraction import router as extraction_router
from .routers.review import router as review_router
from .routers.approval import router as approval_router
from .routers.assistant import router as assistant_router
from .routers.audit import router as audit_router

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager for startup and shutdown."""
    # Startup
    logger.info("🚀 Starting Plexus backend...")
    logger.info(f"Environment: {settings.environment}")
    logger.info(f"Backend URL: {settings.backend_url}")
    
    try:
        await db_pool.initialize()
        logger.info("✓ Database connection pool initialized")
    except Exception as e:
        logger.error(f"❌ Failed to initialize database: {e}")
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.environment == "development"
    )
