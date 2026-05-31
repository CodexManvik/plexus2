"""
Plexus Database Rebuild & Seeding Tool.
Reads and executes backend/sql/schema.sql block-by-block against the Oracle 26ai instance.
"""

import asyncio
import os
import sys
from app.database import db_pool
from app.config import settings
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("init_db_schema")

def parse_sql_file(file_path: str) -> list:
    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()
        
    statements = []
    current = []
    in_plsql = False
    
    for line in content.splitlines():
        # Skip comment lines and empty lines
        stripped = line.strip()
        if stripped.startswith("--") or not stripped:
            continue
            
        if "CREATE OR REPLACE TRIGGER" in stripped.upper():
            in_plsql = True
            
        if in_plsql:
            if stripped == "/":
                in_plsql = False
                statements.append("\n".join(current).strip())
                current = []
            else:
                current.append(line)
        else:
            if stripped.endswith(";"):
                # Remove the trailing semicolon for standard SQL execution
                stmt_line = line.rstrip()[:-1]
                current.append(stmt_line)
                statements.append("\n".join(current).strip())
                current = []
            else:
                current.append(line)
                
    if current:
        stmt = "\n".join(current).strip()
        if stmt:
            statements.append(stmt)
            
    return [s for s in statements if s]

async def main():
    schema_file = os.path.join("sql", "schema.sql")
    if not os.path.exists(schema_file):
        logger.error(f"❌ schema.sql not found at {schema_file}")
        sys.exit(1)
        
    logger.info(f"Reading SQL schema from {schema_file}...")
    statements = parse_sql_file(schema_file)
    logger.info(f"Parsed {len(statements)} DDL/DML statements to execute.")
    
    logger.info("Initializing connection pool...")
    await db_pool.initialize()
    
    success = False
    try:
        logger.info("Starting schema rebuild...")
        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                for idx, stmt in enumerate(statements):
                    snippet = stmt.splitlines()[0][:60]
                    logger.info(f"[{idx+1}/{len(statements)}] Executing: {snippet}...")
                    try:
                        await cursor.execute(stmt)
                    except Exception as e:
                        # Ignore table-not-exist errors when executing drops
                        if "DROP TABLE" in stmt.upper() and ("ORA-00942" in str(e) or "table or view does not exist" in str(e).lower()):
                            logger.warning(f"  ↳ Ignored: Table did not exist.")
                        else:
                            logger.error(f"❌ Statement failed: {e}")
                            logger.error(f"Failed SQL: {stmt}")
                            logger.info("Rolling back transaction...")
                            await conn.rollback()
                            raise e
                            
            logger.info("Committing all schema changes and seed data...")
            await conn.commit()
        success = True
        logger.info("✓ Database successfully dropped, rebuilt, and seeded!")
    except Exception as run_err:
        logger.error(f"❌ Database initialization aborted: {run_err}")
    finally:
        await db_pool.close()
        if not success:
            sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())
