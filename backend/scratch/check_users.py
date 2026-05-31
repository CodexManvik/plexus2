import asyncio
from app.database import db_pool
from app.config import settings

async def check():
    await db_pool.initialize()
    async with db_pool.get_connection() as conn:
        async with conn.cursor() as cursor:
            await cursor.execute("SELECT RAWTOHEX(user_id), email, password_hash, role, is_active FROM users")
            rows = await cursor.fetchall()
            for r in rows:
                h = r[2]
                print(f"ID: {r[0]}, Email: {r[1]}, Hash: '{h}' (len={len(h) if h else 0}), Role: {r[3]}, Active: {r[4]}")
    await db_pool.close()

if __name__ == "__main__":
    asyncio.run(check())
