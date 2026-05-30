"""
Oracle 26ai database connection pool management.
Provides async connection handling with proper resource cleanup.
"""

import oracledb
from contextlib import asynccontextmanager
from typing import AsyncGenerator
from .config import settings
import logging

logger = logging.getLogger(__name__)


def output_type_handler(cursor, name, default_type, size, precision, scale):
    if default_type == oracledb.DB_TYPE_RAW:
        return cursor.var(bytes, arraysize=cursor.arraysize, outconverter=lambda x: x.hex().upper() if x else None)


class DatabasePool:
    """Manages Oracle connection pool lifecycle."""
    
    def __init__(self):
        self.pool = None
    
    async def initialize(self):
        """Initialize the connection pool on application startup."""
        try:
            # Configure Oracle client if wallet is specified
            if settings.oracle_wallet_path:
                oracledb.init_oracle_client(config_dir=settings.oracle_wallet_path)
            
            # Create async connection pool
            self.pool = oracledb.create_pool_async(
                user=settings.oracle_user,
                password=settings.oracle_password,
                dsn=settings.oracle_dsn,
                min=2,
                max=10,
                increment=1,
                getmode=oracledb.POOL_GETMODE_WAIT,
                timeout=30,
                wait_timeout=5000,
                max_lifetime_session=3600
            )
            
            logger.info("✓ Oracle connection pool initialized")
            
            # Test connection
            async with self.pool.acquire() as conn:
                async with conn.cursor() as cursor:
                    await cursor.execute("SELECT 1 FROM DUAL")
                    result = await cursor.fetchone()
                    if result:
                        logger.info("✓ Oracle connection test successful")
        
        except Exception as e:
            logger.error(f"❌ Failed to initialize Oracle connection pool: {e}")
            raise
    
    async def close(self):
        """Close the connection pool on application shutdown."""
        if self.pool:
            await self.pool.close()
            logger.info("✓ Oracle connection pool closed")
    
    @asynccontextmanager
    async def get_connection(self) -> AsyncGenerator:
        """
        Get a connection from the pool.
        Usage:
            async with db_pool.get_connection() as conn:
                async with conn.cursor() as cursor:
                    await cursor.execute("SELECT ...")
        """
        if not self.pool:
            raise RuntimeError("Database pool not initialized. Call initialize() first.")
        
        conn = await self.pool.acquire()
        conn.outputtypehandler = output_type_handler
        try:
            yield conn
        finally:
            await self.pool.release(conn)


# Global database pool instance
db_pool = DatabasePool()


async def get_db_connection():
    """
    FastAPI dependency for getting database connections.
    Usage in routers:
        @router.get("/endpoint")
        async def endpoint(conn = Depends(get_db_connection)):
            async with conn.cursor() as cursor:
                ...
    """
    async with db_pool.get_connection() as conn:
        yield conn


async def execute_query(query: str, params: dict = None, fetch_one: bool = False, fetch_all: bool = False):
    """
    Utility function for executing queries with automatic connection management.
    
    Args:
        query: SQL query string
        params: Query parameters as dict
        fetch_one: Return single row
        fetch_all: Return all rows
    
    Returns:
        Query result or None
    """
    async with db_pool.get_connection() as conn:
        async with conn.cursor() as cursor:
            await cursor.execute(query, params or {})
            
            if fetch_one:
                return await cursor.fetchone()
            elif fetch_all:
                return await cursor.fetchall()
            else:
                await conn.commit()
                return cursor.rowcount


async def execute_many(query: str, params_list: list):
    """
    Execute batch insert/update operations.
    
    Args:
        query: SQL query string
        params_list: List of parameter dicts
    
    Returns:
        Number of rows affected
    """
    async with db_pool.get_connection() as conn:
        async with conn.cursor() as cursor:
            await cursor.executemany(query, params_list)
            await conn.commit()
            return cursor.rowcount
