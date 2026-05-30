"""
Grounding agent for evidence resolution.
Uses Llama 3.1 8B for fast span alignment.
Phase 3 implementation.
"""

import json
from typing import Optional, Tuple
from ..utils.groq_client import groq_client
from ..config import settings
import logging

logger = logging.getLogger(__name__)


class GroundingAgent:
    """AI agent for resolving evidence spans when fuzzy matching fails."""
    
    @staticmethod
    def align_evidence(
        extracted_value: str,
        supporting_text: str,
        candidate_blocks: list
    ) -> Optional[Tuple[str, str, float]]:
        """
        Use LLM to align supporting text to actual document blocks.
        This is the last resort when exact/fuzzy matching fails.
        
        Args:
            extracted_value: The extracted parameter value
            supporting_text: The supporting text from extraction
            candidate_blocks: List of document blocks to search
        
        Returns:
            Tuple of (block_id, matched_text, confidence) or None
        """
        # Build candidate text
        candidates_text = "\n\n".join([
            f"BLOCK {i+1} (ID: {block['block_id']}, Page {block['page_number']}):\n{block['raw_text']}"
            for i, block in enumerate(candidate_blocks[:10])  # Limit to 10 blocks
        ])
        
        prompt = f"""You are a document evidence alignment expert. Find which block contains the supporting text.

EXTRACTED VALUE: {extracted_value}

SUPPORTING TEXT (from AI extraction):
{supporting_text}

CANDIDATE BLOCKS FROM DOCUMENT:
{candidates_text}

Task: Identify which block contains text that matches or paraphrases the supporting text.

Return ONLY a JSON object:
{{
  "block_number": 1-10 or null,
  "matched_text": "exact text from that block" or null,
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}}

If no good match is found, return block_number: null"""
        
        try:
            response = groq_client.call(
                model=settings.groq_model_fast,  # Use fast model for this task
                messages=[
                    {"role": "system", "content": "You are a text alignment expert. Always return valid JSON."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.5,
                response_format={"type": "json_object"}
            )
            
            result = json.loads(response)
            block_num = result.get('block_number')
            
            if block_num and 1 <= block_num <= len(candidate_blocks):
                block = candidate_blocks[block_num - 1]
                return (
                    block['block_id'],
                    result.get('matched_text', block['raw_text']),
                    result.get('confidence', 0.5)
                )
            
            return None
        
        except Exception as e:
            logger.error(f"LLM alignment failed: {e}")
            return None
