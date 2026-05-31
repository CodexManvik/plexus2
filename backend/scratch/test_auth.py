import asyncio
from app.auth.service import AuthService
from app.database import db_pool

async def test_auth():
    await db_pool.initialize()
    
    print("Testing admin@plexus.com with Admin@Plexus1...")
    res1 = await AuthService.authenticate_user("admin@plexus.com", "Admin@Plexus1")
    print(f"Result: {res1}")
    
    print("\nTesting admin@plexus.local with Admin@123456...")
    res2 = await AuthService.authenticate_user("admin@plexus.local", "Admin@123456")
    print(f"Result: {res2}")
    
    await db_pool.close()

if __name__ == "__main__":
    asyncio.run(test_auth())
