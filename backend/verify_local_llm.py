"""
Verification script for the local llama.cpp model integration with Plexus.
Validates environment settings, client initialization, and runs a test inference.
"""

import sys
import os
import asyncio
import logging

# Configure basic logging to see client outputs
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("LocalLLMVerifier")

# Ensure backend directory is in python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

async def main():
    logger.info("=== Starting local llama.cpp Verification ===")
    
    # 1. Load settings
    try:
        from app.config import settings
        logger.info(f"✓ Configuration loaded successfully.")
    except Exception as e:
        logger.error(f"❌ Failed to load settings: {e}")
        sys.exit(1)
        
    # 2. Check environment matches expectations
    logger.info(f"LLM Backend configured: '{settings.llm_backend}'")
    logger.info(f"Local LLM URL configured: '{settings.local_llm_url}'")
    logger.info(f"Local LLM Model configured: '{settings.local_llm_model}'")
    
    if settings.llm_backend != "local":
        logger.error("❌ ERROR: LLM_BACKEND is not set to 'local' in backend/.env!")
        sys.exit(1)
        
    if "8080" not in settings.local_llm_url:
        logger.warning("⚠️ WARNING: LOCAL_LLM_URL does not contain port 8080. If llama.cpp is on port 8080, connection will fail.")

    # 3. Test LLM client import and instantiation
    try:
        from app.utils.groq_client import groq_client
        logger.info("✓ UnifiedLLMClient imported and instantiated successfully.")
    except Exception as e:
        logger.error(f"❌ Failed to import or initialize groq_client: {e}")
        sys.exit(1)

    # 4. Perform an async completion call to the local llama.cpp model
    test_messages = [
        {"role": "system", "content": "You are a helpful contract intelligence assistant."},
        {"role": "user", "content": "Hello! Give me a brief, one-sentence confirmation that you are responding."}
    ]
    
    logger.info("Sending test completion request to local model...")
    try:
        start_time = asyncio.get_event_loop().time()
        
        # Call the unified client asynchronously (which handles the thread pool executor)
        response = await groq_client.async_call(
            model=settings.local_llm_model,
            messages=test_messages,
            temperature=0.1,
            max_tokens=50
        )
        
        elapsed = asyncio.get_event_loop().time() - start_time
        
        logger.info("✓ Response received successfully!")
        print("\n" + "="*50)
        print(f"Response: {response.strip()}")
        print(f"Elapsed Time: {elapsed:.2f} seconds")
        print(f"Tokens Used (estimate): {groq_client.total_tokens_used}")
        print("="*50 + "\n")
        logger.info("✓ Verification succeeded. The local llama.cpp model is fully wired and functional!")
        
    except Exception as e:
        logger.error(f"❌ Connection or completion failed: {e}")
        logger.error("Please ensure the llama.cpp server is running on the configured port and try again.")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())
