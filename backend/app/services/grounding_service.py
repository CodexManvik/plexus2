"""
Grounding service for evidence resolution.
Rule 2: Grounding is mandatory, not optional.
Phase 3 implementation.
"""

from typing import Optional, Tuple
from ..database import db_pool
from ..utils.text_utils import normalize_text, fuzzy_match_score, jaccard_similarity
from ..agents.grounding_agent import GroundingAgent
import logging

logger = logging.getLogger(__name__)


class GroundingService:
    """Resolves evidence for extracted parameters using 4-stage chain."""
    
    @staticmethod
    async def ground_parameter(
        contract_id: str,
        param_id: str,
        supporting_text: str,
        extracted_value: str
    ) -> Optional[str]:
        """
        Ground a parameter to its source block using 4-stage resolution chain.
        Candidate narrowing (P1) prioritize primary section blocks.
        
        Chain: EXACT → NORMALIZED → FUZZY → LLM_ALIGNED
        """
        if not supporting_text:
            logger.warning(f"No supporting text for parameter {param_id}")
            return None
        
        # Get all blocks for contract
        blocks = await GroundingService._get_blocks(contract_id)
        
        if not blocks:
            logger.warning(f"No blocks found for contract {contract_id}")
            return None

        # 1. Fetch parameter_group for candidate narrowing (P1 Section-Aware)
        parameter_group = ""
        group_query = "SELECT parameter_group FROM draft_parameters WHERE param_id = HEXTORAW(:param_id)"
        try:
            async with db_pool.get_connection() as conn:
                async with conn.cursor() as cursor:
                    await cursor.execute(group_query, {"param_id": param_id})
                    row = await cursor.fetchone()
                    if row:
                        parameter_group = row[0]
        except Exception as db_err:
            logger.warning(f"Failed to fetch parameter_group for narrowing: {db_err}")

        # 2. Narrow down primary blocks based on section hints
        primary_blocks = []
        fallback_blocks = []
        
        if parameter_group:
            from ..agents.extraction_agent import ExtractionAgent
            hints = ExtractionAgent._BATCH_SECTION_HINTS.get(parameter_group, [])
            for block in blocks:
                heading = str(block.get('section_heading') or '').lower()
                raw_text = str(block.get('raw_text') or '').lower()
                candidate = heading + " " + raw_text
                if ExtractionAgent._is_precise_match(candidate, hints):
                    primary_blocks.append(block)
                else:
                    fallback_blocks.append(block)
        else:
            primary_blocks = blocks

        # 3. First Pass: Run matching chain against prioritized primary_blocks
        if primary_blocks:
            # Stage 1: Exact match
            result = GroundingService._exact_match(supporting_text, primary_blocks)
            if result:
                block, matched_text, method = result
                return await GroundingService._save_grounding(param_id, block, matched_text, 1.0, method)

            # Stage 2: Normalized match
            result = GroundingService._normalized_match(supporting_text, primary_blocks)
            if result:
                block, matched_text, method = result
                return await GroundingService._save_grounding(param_id, block, matched_text, 0.95, method)

            # Stage 3: Jaccard token-overlap
            result = GroundingService._jaccard_match(supporting_text, primary_blocks)
            if result:
                block, matched_text, method, score = result
                return await GroundingService._save_grounding(param_id, block, matched_text, score, method)

            # Stage 4: SequenceMatcher fuzzy
            result = GroundingService._fuzzy_match(supporting_text, primary_blocks)
            if result:
                block, matched_text, method, score = result
                return await GroundingService._save_grounding(param_id, block, matched_text, score, method)

        # 4. Second Pass: Run matching chain against fallback_blocks
        if fallback_blocks:
            # Stage 1: Exact match
            result = GroundingService._exact_match(supporting_text, fallback_blocks)
            if result:
                block, matched_text, method = result
                return await GroundingService._save_grounding(param_id, block, matched_text, 1.0, method)

            # Stage 2: Normalized match
            result = GroundingService._normalized_match(supporting_text, fallback_blocks)
            if result:
                block, matched_text, method = result
                return await GroundingService._save_grounding(param_id, block, matched_text, 0.95, method)

            # Stage 3: Jaccard token-overlap
            result = GroundingService._jaccard_match(supporting_text, fallback_blocks)
            if result:
                block, matched_text, method, score = result
                return await GroundingService._save_grounding(param_id, block, matched_text, score, method)

            # Stage 4: SequenceMatcher fuzzy
            result = GroundingService._fuzzy_match(supporting_text, fallback_blocks)
            if result:
                block, matched_text, method, score = result
                return await GroundingService._save_grounding(param_id, block, matched_text, score, method)

        # Stage 5: LLM alignment (expensive — last resort) over all blocks
        import asyncio
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            GroundingAgent.align_evidence,
            extracted_value,
            supporting_text,
            blocks
        )
        if result:
            block_id, matched_text, confidence = result
            block = next((b for b in blocks if b["block_id"] == block_id), None)
            if block:
                return await GroundingService._save_grounding(
                    param_id, block, matched_text, confidence, "LLM_ALIGNED"
                )

        logger.warning(f"Failed to ground parameter {param_id}")
        return None
    
    @staticmethod
    def _exact_match(supporting_text: str, blocks: list) -> Optional[Tuple]:
        """Stage 1: Exact text match."""
        if not supporting_text:
            return None
        
        for block in blocks:
            raw_text = str(block.get('raw_text', ''))
            if supporting_text in raw_text:
                return (block, supporting_text, 'EXACT')
        return None
    
    @staticmethod
    def _normalized_match(supporting_text: str, blocks: list) -> Optional[Tuple]:
        """Stage 2: Normalized match (case-insensitive, whitespace-normalized)."""
        if not supporting_text:
            return None
        
        norm_supporting = normalize_text(supporting_text)
        
        for block in blocks:
            raw_text = str(block.get('raw_text', ''))
            norm_block = normalize_text(raw_text)
            if norm_supporting in norm_block:
                # Find the actual text in the original block
                return (block, supporting_text, 'NORMALIZED')
        return None
    
    @staticmethod
    def _jaccard_match(supporting_text: str, blocks: list, threshold: float = 0.50) -> Optional[Tuple]:
        """
        Stage 3: Jaccard token-overlap match.

        More forgiving than SequenceMatcher for:
        - Partial quotes (the LLM gives a subset of the block's words)
        - OCR normalization differences (dashes, ligatures, spacing)

        Threshold 0.50 means at least half of the supporting text's unique
        words must appear in the block.
        """
        if not supporting_text:
            return None

        best_match = None
        best_score = 0.0

        for block in blocks:
            raw_text = str(block.get("raw_text", ""))
            score = jaccard_similarity(supporting_text, raw_text)
            if score > best_score and score >= threshold:
                best_score = score
                best_match = (block, raw_text[:len(supporting_text) + 50], "JACCARD", score)

        return best_match

    @staticmethod
    def _fuzzy_match(supporting_text: str, blocks: list, threshold: float = 0.65) -> Optional[Tuple]:
        """
        Stage 4: SequenceMatcher character-level fuzzy match.

        Threshold lowered from 0.85 to 0.65: LLM supporting text is almost
        always a paraphrase or partial quote and rarely exceeds 0.85 against
        the raw block. 0.65 catches the clear hits while avoiding noise.
        Both texts are normalized before comparison.
        """
        if not supporting_text:
            return None
        
        best_match = None
        best_score = 0.0
        
        for block in blocks:
            raw_text = str(block.get('raw_text', ''))
            score = fuzzy_match_score(supporting_text, raw_text)
            if score > best_score and score >= threshold:
                best_score = score
                best_match = (block, raw_text[:len(supporting_text) + 50], 'FUZZY', score)
        
        return best_match
    
    @staticmethod
    async def _get_blocks(contract_id: str) -> list:
        """Get all blocks for a contract (wrapped in HEXTORAW, includes section_heading)."""
        query = """
            SELECT block_id, page_number, raw_text, normalized_text,
                   bbox_x1, bbox_y1, bbox_x2, bbox_y2, section_heading
            FROM document_blocks
            WHERE contract_id = HEXTORAW(:contract_id)
            ORDER BY page_number, block_order
        """
        
        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(query, {'contract_id': contract_id})
                rows = await cursor.fetchall()
                
                blocks = []
                for row in rows:
                    # Read CLOB fields if they are AsyncLOB objects
                    raw_text = row[2]
                    if hasattr(raw_text, 'read'):
                        raw_text = await raw_text.read()
                    
                    normalized_text = row[3]
                    if hasattr(normalized_text, 'read'):
                        normalized_text = await normalized_text.read()
                    
                    blocks.append({
                        'block_id': row[0],
                        'page_number': row[1],
                        'raw_text': raw_text,
                        'normalized_text': normalized_text,
                        'bbox_x1': row[4],
                        'bbox_y1': row[5],
                        'bbox_x2': row[6],
                        'bbox_y2': row[7],
                        'section_heading': row[8]
                    })
                
                return blocks
    
    @staticmethod
    async def _save_grounding(
        param_id: str,
        block: dict,
        source_text: str,
        confidence: float,
        match_method: str
    ) -> str:
        """
        Save grounding record to database.
        grounding_id is generated in Python before the INSERT so it can be
        returned immediately — avoids the stale-fetchone bug caused by doing
        a post-INSERT SELECT on param_id, which may match earlier records.
        """
        import uuid as _uuid
        grounding_id = _uuid.uuid4().hex.upper()

        # Map JACCARD to FUZZY to respect the database check constraint
        db_match_method = match_method
        if db_match_method == 'JACCARD':
            db_match_method = 'FUZZY'

        query = """
            INSERT INTO draft_grounding_records (
                grounding_id, param_id, block_id, page_number,
                bbox_x1, bbox_y1, bbox_x2, bbox_y2,
                source_text, grounding_confidence, match_method
            ) VALUES (
                HEXTORAW(:grounding_id), HEXTORAW(:param_id),
                HEXTORAW(:block_id), :page_number,
                :bbox_x1, :bbox_y1, :bbox_x2, :bbox_y2,
                :source_text, :grounding_confidence, :match_method
            )
        """

        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(query, {
                    'grounding_id':        grounding_id,
                    'param_id':            param_id,
                    'block_id':            block['block_id'],
                    'page_number':         block['page_number'],
                    'bbox_x1':             block['bbox_x1'],
                    'bbox_y1':             block['bbox_y1'],
                    'bbox_x2':             block['bbox_x2'],
                    'bbox_y2':             block['bbox_y2'],
                    'source_text':         source_text[:4000],
                    'grounding_confidence': confidence,
                    'match_method':        db_match_method,
                })
                await conn.commit()

        return grounding_id
