"""
Centralized LLM client with support for both Groq API and local llama.cpp.
Rule 7: All LLM calls go through this client.
"""

import time
import asyncio
import functools
import json
from typing import Optional, Dict, Any
from ..config import settings
import logging

logger = logging.getLogger(__name__)


class LocalLLMClient:
    """Local llama.cpp HTTP API client (OpenAI-compatible)."""

    def __init__(self):
        import httpx
        self.httpx = httpx
        self.base_url = settings.local_llm_url
        self.model = settings.local_llm_model
        self.max_retries = 3
        self.timeout = 600  # Local models can be slower
        self.total_tokens_used = 0

    def call(
        self,
        model: str,
        messages: list,
        temperature: float = 0.5,
        max_tokens: Optional[int] = None,
        response_format: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Call local llama.cpp API via OpenAI-compatible endpoint.
        Uses self.model from config, ignoring the model parameter.
        """
        for attempt in range(self.max_retries):
            try:
                url = f"{self.base_url}/v1/chat/completions"
                payload = {
                    "model": self.model,
                    "messages": messages,
                    "temperature": temperature,
                }

                if max_tokens:
                    payload["max_tokens"] = max_tokens

                # Local models don't always support response_format, but try if JSON requested
                if response_format and response_format.get("type") == "json_object":
                    payload["response_format"] = response_format

                with self.httpx.Client(timeout=self.timeout) as client:
                    response = client.post(url, json=payload)
                    response.raise_for_status()

                result = response.json()
                content = result["choices"][0]["message"]["content"]

                # Track token usage (estimate for local models)
                if "usage" in result:
                    tokens = result["usage"].get("total_tokens", 0)
                    self.total_tokens_used += tokens
                    logger.info(f"Local LLM call: {self.model}, tokens: {tokens}, total: {self.total_tokens_used}")
                else:
                    # Local models may not return token counts; estimate from content
                    estimated_tokens = len(content.split()) * 1.3
                    self.total_tokens_used += int(estimated_tokens)
                    logger.info(f"Local LLM call: {self.model}, estimated tokens: {int(estimated_tokens)}")

                return content

            except Exception as e:
                error_str = str(e)

                # Retry on connection errors or timeouts
                if attempt < self.max_retries - 1:
                    if "Connection" in error_str or "timeout" in error_str.lower():
                        wait_time = (2 ** attempt) * 2  # 2s, 4s, 8s
                        logger.warning(
                            f"Local LLM connection error, retrying in {wait_time}s... "
                            f"(attempt {attempt + 1}/{self.max_retries}): {e}"
                        )
                        time.sleep(wait_time)
                        continue

                # Other errors or final retry
                if attempt == self.max_retries - 1:
                    logger.error(f"Local LLM call failed after {self.max_retries} attempts: {e}")
                    raise

                logger.warning(f"Local LLM error, retrying... (attempt {attempt + 1}/{self.max_retries}): {e}")
                time.sleep(1)

        raise Exception("Local LLM call failed after all retries")

    async def async_call(
        self,
        model: str,
        messages: list,
        temperature: float = 0.5,
        max_tokens: Optional[int] = None,
        response_format: Optional[Dict[str, Any]] = None
    ) -> str:
        """Async wrapper using run_in_executor."""
        loop = asyncio.get_event_loop()
        fn = functools.partial(
            self.call,
            model,
            messages,
            temperature,
            max_tokens,
            response_format,
        )
        return await loop.run_in_executor(None, fn)


class GroqClient:
    """Groq API client with exponential backoff retry logic."""

    def __init__(self):
        from groq import Groq
        if settings.llm_backend == "groq":
            if not settings.groq_api_key:
                raise ValueError("GROQ_API_KEY required when LLM_BACKEND='groq'")
            self.client = Groq(api_key=settings.groq_api_key)
        else:
            self.client = None
        self.max_retries = 3
        self.timeout = 30
        self.total_tokens_used = 0

    def call(
        self,
        model: str,
        messages: list,
        temperature: float = 0.5,
        max_tokens: Optional[int] = None,
        response_format: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Call Groq API with exponential backoff retry logic.
        This is a synchronous method intended for use inside run_in_executor.
        Do NOT call this directly from async handlers — use async_call() instead.

        Args:
            model: Model name (use settings.groq_model_heavy or groq_model_fast)
            messages: List of message dicts with role and content
            temperature: Sampling temperature (0-2)
            max_tokens: Maximum tokens to generate
            response_format: Optional response format (e.g., {"type": "json_object"})

        Returns:
            Response content as string

        Raises:
            Exception: If all retries fail
        """
        if not self.client:
            raise RuntimeError("Groq client not initialized. Check GROQ_API_KEY and LLM_BACKEND setting.")

        for attempt in range(self.max_retries):
            try:
                kwargs: Dict[str, Any] = {
                    "model": model,
                    "messages": messages,
                    "temperature": temperature,
                    "timeout": self.timeout,
                }

                if max_tokens:
                    kwargs["max_tokens"] = max_tokens

                if response_format:
                    kwargs["response_format"] = response_format

                response = self.client.chat.completions.create(**kwargs)

                # Track token usage
                if hasattr(response, 'usage'):
                    tokens = response.usage.total_tokens
                    self.total_tokens_used += tokens
                    logger.info(f"Groq API call: {model}, tokens: {tokens}, total: {self.total_tokens_used}")

                return response.choices[0].message.content

            except Exception as e:
                error_str = str(e)

                # Check for rate limit or server errors
                if '429' in error_str or '503' in error_str:
                    if attempt < self.max_retries - 1:
                        wait_time = (2 ** attempt) * 1  # Exponential backoff: 1s, 2s, 4s
                        logger.warning(
                            f"Groq API rate limit/server error, retrying in {wait_time}s... "
                            f"(attempt {attempt + 1}/{self.max_retries})"
                        )
                        time.sleep(wait_time)
                        continue

                # Other errors or final retry
                if attempt == self.max_retries - 1:
                    logger.error(f"Groq API call failed after {self.max_retries} attempts: {e}")
                    raise

                # Retry on other errors
                logger.warning(f"Groq API error, retrying... (attempt {attempt + 1}/{self.max_retries}): {e}")
                time.sleep(1)

        raise Exception("Groq API call failed after all retries")

    async def async_call(
        self,
        model: str,
        messages: list,
        temperature: float = 0.5,
        max_tokens: Optional[int] = None,
        response_format: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Async wrapper around call() using run_in_executor.

        The Groq SDK is synchronous. Calling self.call() directly from an async
        FastAPI handler blocks the entire event loop, freezing all concurrent
        requests. This method offloads the blocking I/O to a thread pool executor,
        allowing the event loop to remain responsive.

        Usage:
            result = await groq_client.async_call(model=..., messages=...)
        """
        loop = asyncio.get_event_loop()
        fn = functools.partial(
            self.call,
            model,
            messages,
            temperature,
            max_tokens,
            response_format,
        )
        return await loop.run_in_executor(None, fn)


class UnifiedLLMClient:
    """Unified client that routes to either Groq or local llama.cpp based on config."""

    def __init__(self):
        if settings.llm_backend == "local":
            self.client = LocalLLMClient()
            logger.info(f"✓ Local LLM client initialized: {settings.local_llm_url}")
        elif settings.llm_backend == "groq":
            self.client = GroqClient()
            logger.info("✓ Groq API client initialized")
        else:
            raise ValueError(f"Invalid LLM_BACKEND: {settings.llm_backend}. Use 'groq' or 'local'.")

    def call(
        self,
        model: str,
        messages: list,
        temperature: float = 0.5,
        max_tokens: Optional[int] = None,
        response_format: Optional[Dict[str, Any]] = None
    ) -> str:
        """Route to appropriate backend."""
        return self.client.call(model, messages, temperature, max_tokens, response_format)

    async def async_call(
        self,
        model: str,
        messages: list,
        temperature: float = 0.5,
        max_tokens: Optional[int] = None,
        response_format: Optional[Dict[str, Any]] = None
    ) -> str:
        """Route to appropriate backend (async)."""
        return await self.client.async_call(model, messages, temperature, max_tokens, response_format)

    @property
    def total_tokens_used(self) -> int:
        """Get total tokens used from underlying client."""
        return self.client.total_tokens_used


# Global client instance
groq_client = UnifiedLLMClient()
