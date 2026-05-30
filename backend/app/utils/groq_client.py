"""
Centralized Groq API client with retry logic and token tracking.
Rule 7: All Groq calls go through this client.
"""

import time
from typing import Optional, Dict, Any
from groq import Groq
from ..config import settings
import logging

logger = logging.getLogger(__name__)


class GroqClient:
    """Centralized Groq API client with retry logic."""
    
    def __init__(self):
        self.client = Groq(api_key=settings.groq_api_key)
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
        for attempt in range(self.max_retries):
            try:
                kwargs = {
                    "model": model,
                    "messages": messages,
                    "temperature": temperature,
                    "timeout": self.timeout
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
                        logger.warning(f"Groq API rate limit/server error, retrying in {wait_time}s... (attempt {attempt + 1}/{self.max_retries})")
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


# Global client instance
groq_client = GroqClient()
