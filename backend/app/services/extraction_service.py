"""
Extraction service orchestrating parameter extraction pipeline.
Phase 3 implementation.
"""

from typing import List, Dict, Optional
import uuid
import asyncio
import re
from datetime import date
from ..database import db_pool
from ..agents.extraction_agent import ExtractionAgent
from ..services.parsing_service import ParsingService
from ..services.grounding_service import GroundingService
from ..services.workflow_service import WorkflowService
from ..services.audit_service import AuditService
from ..utils.groq_client import groq_client
from ..utils.pipeline_bus import emit_async
from ..config import settings
import logging

logger = logging.getLogger(__name__)

# Cap concurrent LLM calls
# Groq: max 3 concurrent (rate limit on per-minute tokens)
# Local: max 1 concurrent (slower, single-threaded model)
_GROQ_SEMAPHORE = asyncio.Semaphore(1 if settings.llm_backend == "local" else 3)
_BATCH_DELAY = 1.0 if settings.llm_backend == "local" else 0.2  # Delay between batches (seconds)

# Known ISO-3166-1 country names and US-state style jurisdiction strings
# used by the governing-law deterministic check.
_KNOWN_JURISDICTIONS = frozenset({
    "india", "united states", "us", "usa", "united kingdom", "uk", "england",
    "germany", "france", "singapore", "australia", "canada", "uae",
    "united arab emirates", "new york", "california", "delaware", "texas",
    "maharashtra", "karnataka", "delhi", "england and wales",
})

# Accepted currency signals for Contract Value validation
_CURRENCY_PATTERN = re.compile(
    r"(\$|€|£|¥|₹|inr|usd|eur|gbp|cad|aud|sgd|jpy|\brs\.?\b)", re.IGNORECASE
)


def repair_truncated_json(json_str: str) -> str:
    """
    Attempts to repair a truncated JSON string by balancing quotes, braces, and brackets.
    """
    json_str = json_str.strip()
    if not json_str:
        return "{}"
        
    # Standardize string start
    if not json_str.startswith("{"):
        start_idx = json_str.find("{")
        if start_idx != -1:
            json_str = json_str[start_idx:]
        else:
            return "{}"

    # Track state
    in_string = False
    escape = False
    bracket_stack = []
    repaired_chars = []

    for char in json_str:
        if escape:
            repaired_chars.append(char)
            escape = False
            continue
        if char == '\\':
            repaired_chars.append(char)
            escape = True
            continue
        if char == '"':
            in_string = not in_string
            repaired_chars.append(char)
            continue
        
        repaired_chars.append(char)
        
        if not in_string:
            if char in ('{', '['):
                bracket_stack.append(char)
            elif char in ('}', ']'):
                if bracket_stack:
                    top = bracket_stack[-1]
                    if (char == '}' and top == '{') or (char == ']' and top == '['):
                        bracket_stack.pop()

    # If we ended inside a string, close the quote
    if in_string:
        repaired_chars.append('"')

    # Close any remaining brackets in reverse order
    while bracket_stack:
        top = bracket_stack.pop()
        if top == '{':
            repaired_chars.append('}')
        elif top == '[':
            repaired_chars.append(']')

    return "".join(repaired_chars)


def escape_invalid_json_backslashes(json_str: str) -> str:
    """
    Escapes invalid backslash sequences in a JSON string (e.g., '\c' -> '\\c').
    Valid JSON escapes are: \\", \\\\, \\/, \\b, \\f, \\n, \\r, \\t, \\uXXXX
    """
    # Regex to match a backslash that is NOT followed by standard escape chars
    pattern = re.compile(r'\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})')
    return pattern.sub(r'\\\\', json_str)


def parse_repaired_json(json_str: str) -> dict:
    """
    Parses a JSON string, attempting repair if it is truncated or malformed.
    """
    import json as _json
    # Pre-clean invalid backslash escape sequences
    cleaned_json_str = escape_invalid_json_backslashes(json_str)
    try:
        return _json.loads(cleaned_json_str)
    except Exception as first_err:
        logger.warning(f"Initial JSON parse failed. Attempting repair: {first_err}")
        try:
            repaired_str = repair_truncated_json(cleaned_json_str)
            return _json.loads(repaired_str)
        except Exception as second_err:
            logger.error(f"Repaired JSON parse failed: {second_err}")
            raise first_err


class ExtractionService:
    """Orchestrates the extraction pipeline."""

    @staticmethod
    async def run_extraction(contract_id: str, user_id: str) -> Dict:
        """
        Run full extraction pipeline for a contract.

        Workflow: TAG_SUGGESTION_READY → EXTRACTION_RUNNING → GROUNDING_RUNNING →
                  VALIDATION_RUNNING → DRAFT_READY

        Batches execute concurrently (up to _GROQ_SEMAPHORE limit) using
        groq_client.async_call() to avoid blocking the event loop.
        """
        try:
            await WorkflowService.transition(
                contract_id=contract_id,
                to_state="EXTRACTION_RUNNING",
                user_id=user_id,
                reason="Starting parameter extraction",
            )
            await emit_async(contract_id, {
                "stage":    "EXTRACTION_RUNNING",
                "message":  "Extraction started — fetching document blocks",
                "progress": 0.05,
            })

            # Fetch blocks once — shared across all batches
            blocks = await ParsingService.get_blocks_for_contract(contract_id)

            if not blocks:
                logger.warning(f"No document blocks found for contract {contract_id}")

            all_batches = ExtractionAgent.get_all_batches()

            # ----------------------------------------------------------------
            # Run all 9 batches concurrently, each capped by _GROQ_SEMAPHORE
            # For local models, this will execute sequentially (semaphore=1)
            # For Groq, this will execute with up to 3 concurrent requests
            # ----------------------------------------------------------------
            batch_names = list(all_batches.keys())
            total_batches = len(batch_names)

            async def run_one_batch(batch_index: int, batch_name: str, parameters: List[str]) -> tuple:
                # Add delay between batches for local models to avoid overwhelming the server
                if settings.llm_backend == "local" and batch_index > 0:
                    await asyncio.sleep(_BATCH_DELAY)

                # Build the section-focused context for this batch
                document_text = ExtractionAgent.build_context_for_batch(batch_name, blocks)
                model_to_use = settings.local_llm_model if settings.llm_backend == "local" else settings.groq_model_heavy

                async def execute_call(context_str: str) -> str:
                    async with _GROQ_SEMAPHORE:
                        logger.info(f"Extracting {batch_name} ({len(context_str)} chars)...")
                        return await groq_client.async_call(
                            model=model_to_use,
                            messages=[
                                {
                                    "role": "system",
                                    "content": (
                                        "You are a contract parameter extraction expert. "
                                        "Always return valid JSON. Never invent values."
                                    ),
                                },
                                {
                                    "role": "user",
                                    "content": ExtractionAgent._build_prompt(batch_name, parameters, context_str),
                                },
                            ],
                            temperature=0.1,
                            max_tokens=4000 if settings.llm_backend == "groq" else 2000,
                            response_format={"type": "json_object"},
                        )

                def parse_response(response_json: str) -> List[Dict]:
                    try:
                        result = parse_repaired_json(response_json)
                        extracted_raw = result.get("parameters", [])
                        extracted_clean = []
                        for p_obj in extracted_raw:
                            if isinstance(p_obj, dict) and p_obj.get("parameter_name"):
                                extracted_clean.append({
                                    "parameter_name": p_obj["parameter_name"],
                                    "extracted_value": p_obj.get("extracted_value"),
                                    "supporting_text": p_obj.get("supporting_text"),
                                    "confidence": float(p_obj.get("confidence", 0.0)) if p_obj.get("confidence") is not None else 0.0,
                                    "section_title": p_obj.get("section_title"),
                                    "notes": p_obj.get("notes"),
                                })
                        return extracted_clean
                    except Exception as parse_err:
                        logger.error(f"JSON parse and repair failed for {batch_name}: {parse_err}")
                        return []

                # 1. Run initial section-filtered context extraction
                resp = await execute_call(document_text)
                extracted = parse_response(resp)

                # Ensure every parameter has some representation in `extracted`
                def backfill_missing(extracted_list: List[Dict]):
                    extracted_names = {p["parameter_name"].lower() for p in extracted_list}
                    for param in parameters:
                        if param.lower() not in extracted_names:
                            extracted_list.append({
                                "parameter_name": param,
                                "extracted_value": None,
                                "supporting_text": None,
                                "confidence": 0.0,
                                "section_title": None,
                                "notes": "Parameter omitted due to LLM response truncation",
                            })

                backfill_missing(extracted)

                # 2. Check if Full-Document Fallback is triggered (missing_ratio > 0.30) (Change 2)
                null_or_low_conf_count = sum(
                    1 for p in extracted
                    if p.get("extracted_value") is None or p.get("confidence", 0.0) < 0.50
                )
                missing_ratio = null_or_low_conf_count / len(parameters)
                fallback_triggered = False

                if missing_ratio > 0.30:
                    fallback_triggered = True
                    logger.info(
                        f"⚠️ [Fallback Triggered] Batch '{batch_name}' has missing_ratio={missing_ratio:.2f} (> 0.30). "
                        f"Re-running extraction with full-document context..."
                    )
                    full_doc_context = ExtractionAgent.build_full_document_context(blocks)
                    resp_fallback = await execute_call(full_doc_context)
                    extracted_fallback = parse_response(resp_fallback)
                    backfill_missing(extracted_fallback)

                    # Compare results: count non-null, high-confidence parameters in both
                    def score_extracted_set(extracted_list: List[Dict]) -> float:
                        return sum(p.get("confidence", 0.0) for p in extracted_list if p.get("extracted_value") is not None)

                    score_initial = score_extracted_set(extracted)
                    score_fallback = score_extracted_set(extracted_fallback)

                    if score_fallback > score_initial:
                        logger.info(
                            f"✓ [Fallback Kept] Full-document context improved batch '{batch_name}' "
                            f"(score: {score_fallback:.2f} vs initial {score_initial:.2f})"
                        )
                        extracted = extracted_fallback
                        document_text = full_doc_context
                    else:
                        logger.info(
                            f"ℹ [Fallback Dismissed] Initial context was better for batch '{batch_name}' "
                            f"(score: {score_initial:.2f} vs fallback {score_fallback:.2f})"
                        )

                # 3. Logging Diagnostics and Metrics (Change 8)
                null_count = sum(1 for p in extracted if p.get("extracted_value") is None)
                extracted_count = len(parameters) - null_count
                logger.info(
                    f"📊 [Batch Diagnostics] "
                    f"batch: '{batch_name}', "
                    f"context_chars: {len(document_text)}, "
                    f"parameters_requested: {len(parameters)}, "
                    f"parameters_extracted: {extracted_count}, "
                    f"parameters_null: {null_count}, "
                    f"recovery_pass_triggered: {fallback_triggered}"
                )

                for p in extracted:
                    if p.get("extracted_value") is None:
                        logger.info(
                            f"🔍 [Null Field Log] "
                            f"parameter: '{p['parameter_name']}', "
                            f"reason: '{p.get('notes') or 'Genuine omission/truncation'}', "
                            f"context_used: '{'full_document' if fallback_triggered else 'section'}'"
                        )

                progress = 0.05 + (batch_index / total_batches) * 0.40  # 5% → 45%
                await emit_async(contract_id, {
                    "stage":    "EXTRACTION_RUNNING",
                    "message":  f"Completed {batch_name} — {len(extracted)} parameters",
                    "batch":    batch_name,
                    "progress": round(progress, 2),
                })

                logger.info(f"Completed {batch_name}: {len(extracted)} parameters")
                return batch_name, extracted

            tasks = [
                run_one_batch(idx, batch_name, parameters)
                for idx, (batch_name, parameters) in enumerate(all_batches.items())
            ]
            batch_results = await asyncio.gather(*tasks, return_exceptions=True)

            # ----------------------------------------------------------------
            # Persist all initial results
            # ----------------------------------------------------------------
            total_params = 0
            model_used = settings.local_llm_model if settings.llm_backend == "local" else settings.groq_model_heavy
            
            for result in batch_results:
                if isinstance(result, Exception):
                    logger.error(f"Batch task raised exception: {result}")
                    continue
                if not isinstance(result, (list, tuple)) or len(result) != 2:
                    logger.error(f"Batch task returned unexpected result type: {type(result)}")
                    continue
                batch_name, extracted = result
                for param in extracted:
                    await ExtractionService._save_parameter(
                        contract_id=contract_id,
                        parameter_name=param["parameter_name"],
                        parameter_group=batch_name,
                        extracted_value=param.get("extracted_value"),
                        supporting_text=param.get("supporting_text"),
                        confidence=param.get("confidence", 0.0),
                        model_used=model_used,
                    )
                    total_params += 1

            logger.info(f"Initial extraction complete: {total_params} parameters saved")

            # ----------------------------------------------------------------
            # Recovery Pass (Change 1)
            # ----------------------------------------------------------------
            await emit_async(contract_id, {
                "stage":    "EXTRACTION_RUNNING",
                "message":  "Running missing-field recovery pass...",
                "progress": 0.50,
            })
            await ExtractionService.recover_missing_fields(
                contract_id=contract_id,
                blocks=blocks,
                model_used=model_used
            )

            # ----------------------------------------------------------------
            # Grounding
            # ----------------------------------------------------------------
            await emit_async(contract_id, {
                "stage":    "GROUNDING_RUNNING",
                "message":  f"Extraction complete ({total_params} parameters). Starting grounding...",
                "progress": 0.55,
            })
            await WorkflowService.transition(
                contract_id=contract_id,
                to_state="GROUNDING_RUNNING",
                user_id=user_id,
                reason=f"Extraction complete: {total_params} parameters",
            )

            grounded_count = await ExtractionService._ground_all_parameters(contract_id)
            logger.info(f"Grounded {grounded_count}/{total_params} parameters")

            # ----------------------------------------------------------------
            # Validation
            # ----------------------------------------------------------------
            await emit_async(contract_id, {
                "stage":    "VALIDATION_RUNNING",
                "message":  f"Grounding complete ({grounded_count}/{total_params}). Running rule validation...",
                "progress": 0.80,
            })
            await WorkflowService.transition(
                contract_id=contract_id,
                to_state="VALIDATION_RUNNING",
                user_id=user_id,
                reason=f"Grounding complete: {grounded_count}/{total_params}",
            )

            validated_count = await ExtractionService._validate_parameters(contract_id)

            # ----------------------------------------------------------------
            # Finalise
            # ----------------------------------------------------------------
            await emit_async(contract_id, {
                "stage":    "DRAFT_READY",
                "message":  f"Pipeline complete. {validated_count} parameters validated. Draft ready for review.",
                "progress": 1.0,
            })
            await WorkflowService.transition(
                contract_id=contract_id,
                to_state="DRAFT_READY",
                user_id=user_id,
                reason=f"Validation complete: {validated_count} valid",
            )

            await AuditService.log(
                contract_id=contract_id,
                user_id=user_id,
                action="EXTRACTION_COMPLETE",
                entity_type="contract",
                entity_id=contract_id,
                metadata={
                    "total_params": total_params,
                    "grounded": grounded_count,
                    "validated": validated_count,
                },
            )

            return {
                "contract_id": contract_id,
                "total_parameters": total_params,
                "grounded": grounded_count,
                "validated": validated_count,
                "workflow_state": "DRAFT_READY",
            }

        except Exception as e:
            logger.error(f"Extraction failed: {e}")
            await emit_async(contract_id, {
                "stage":   "ERROR",
                "message": f"Pipeline failed: {e}",
                "progress": None,
            })
            raise

    @staticmethod
    async def recover_missing_fields(contract_id: str, blocks: List[Dict], model_used: str):
        """
        Missing-field recovery pass (Change 1).
        Identifies missing/low-confidence fields and re-extracts them using global_clause_search.
        """
        # Fetch all draft parameters for this contract that are NULL or confidence < 0.50
        fetch_query = """
            SELECT param_id, parameter_name, parameter_group, extracted_value, confidence
            FROM draft_parameters
            WHERE contract_id = HEXTORAW(:contract_id)
              AND (extracted_value IS NULL OR confidence < 0.50)
        """

        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(fetch_query, {"contract_id": contract_id})
                rows = await cursor.fetchall()

        if not rows:
            logger.info("ℹ Recovery pass skipped: 0 missing or low-confidence parameters detected.")
            return

        logger.info(f"🔄 Starting Missing-Field Recovery Pass for {len(rows)} parameters...")

        # Process each missing parameter individually for maximum precision
        for row in rows:
            param_id        = row[0]
            parameter_name  = row[1]
            parameter_group = row[2]
            original_value  = row[3]
            original_conf   = float(row[4]) if row[4] else 0.0

            if hasattr(original_value, "read"):
                original_value = await original_value.read()

            logger.info(f"🎯 Recovering parameter: '{parameter_name}' (original: '{original_value}' with conf {original_conf:.2f})...")

            # Build hyper-targeted context using global_clause_search (Change 4 & B)
            document_text = ExtractionAgent.global_clause_search(parameter_name, blocks)
            if not document_text:
                # If search yields nothing, fallback to full-document context (Change 2)
                document_text = ExtractionAgent.build_full_document_context(blocks)

            # Re-run LLM call specifically for this single parameter
            # We treat it as a single-item batch
            async with _GROQ_SEMAPHORE:
                response_json = await groq_client.async_call(
                    model=model_used,
                    messages=[
                        {
                            "role": "system",
                            "content": (
                                "You are a contract parameter extraction expert. "
                                "Always return valid JSON. Never invent values."
                            ),
                        },
                        {
                            "role": "user",
                            "content": ExtractionAgent._build_prompt(parameter_group, [parameter_name], document_text),
                        },
                    ],
                    temperature=0.1,
                    max_tokens=1000,  # Single parameter needs fewer tokens
                    response_format={"type": "json_object"},
                )

            try:
                result = parse_repaired_json(response_json)
                extracted_raw = result.get("parameters", [])
                
                # Look for the parameter name match
                recovered_param = None
                for p_obj in extracted_raw:
                    if isinstance(p_obj, dict) and p_obj.get("parameter_name", "").lower() == parameter_name.lower():
                        recovered_param = p_obj
                        break

                if recovered_param:
                    recovered_val  = recovered_param.get("extracted_value")
                    recovered_conf = float(recovered_param.get("confidence", 0.0)) if recovered_param.get("confidence") is not None else 0.0
                    recovered_text = recovered_param.get("supporting_text")
                    recovered_title = recovered_param.get("section_title")
                    recovered_notes = recovered_param.get("notes")

                    # Confidence Floor Gating (Change D)
                    # Only accept recovery if recovered.confidence >= 0.40 AND supporting_text exists
                    if recovered_conf >= 0.40 and recovered_text:
                        # Ensure values are properly serialized to strings to prevent DPY-3002
                        def serialize_db_val(v):
                            if v is None:
                                return None
                            if isinstance(v, (dict, list)):
                                import json as _json
                                return _json.dumps(v, ensure_ascii=False)
                            return str(v)

                        db_recovered_val = serialize_db_val(recovered_val)
                        db_recovered_text = serialize_db_val(recovered_text)

                        # History Preservation (Change C)
                        # Keep history in python logs as notes are not in the DB schema
                        history_note = (
                            f"Original: '{original_value}' (conf: {original_conf:.2f}). "
                            f"Recovered: '{db_recovered_val}' (conf: {recovered_conf:.2f}). "
                            f"Notes: {recovered_notes or 'none'}"
                        )

                        logger.info(
                            f"✓ [Field Recovered] '{parameter_name}': "
                            f"'{original_value}' (conf: {original_conf:.2f}) → '{db_recovered_val}' (conf: {recovered_conf:.2f})"
                        )
                        logger.info(f"📊 [Recovery History] parameter: '{parameter_name}', details: {history_note}")

                        # Update parameter in database using strictly matching schema fields
                        update_query = """
                            UPDATE draft_parameters
                            SET extracted_value = :val,
                                supporting_text = :text,
                                confidence = :conf,
                                validation_status = 'NEEDS_REVIEW'
                            WHERE param_id = HEXTORAW(:param_id)
                        """

                        async with db_pool.get_connection() as conn:
                            async with conn.cursor() as cursor:
                                await cursor.execute(update_query, {
                                    "val":      db_recovered_val,
                                    "text":     db_recovered_text,
                                    "conf":     recovered_conf,
                                    "param_id": param_id,
                                })
                                await conn.commit()
                    else:
                        logger.info(
                            f"ℹ [Recovery Floor Rejected] recovered parameter '{parameter_name}' "
                            f"failed floor gate (conf: {recovered_conf:.2f} < 0.40 or supporting_text missing)."
                        )
                else:
                    logger.info(f"ℹ [Recovery Omission] LLM failed to return parameter '{parameter_name}' during recovery pass.")

            except Exception as e:
                logger.error(f"❌ Recovery pass failed for parameter '{parameter_name}': {e}")

    # -------------------------------------------------------------------------
    # Internal helpers
    # -------------------------------------------------------------------------

    @staticmethod
    async def _save_parameter(
        contract_id: str,
        parameter_name: str,
        parameter_group: str,
        extracted_value: Optional[str],
        supporting_text: Optional[str],
        confidence: float,
        model_used: str,
    ) -> str:
        """Persist an extracted parameter, deriving initial validation_status."""
        param_id = uuid.uuid4().hex.upper()

        # Ensure all incoming VARCHAR2/CLOB database inputs are properly serialized to strings (DPY-3002 guard)
        def serialize_db_val(v):
            if v is None:
                return None
            if isinstance(v, (dict, list)):
                import json as _json
                return _json.dumps(v, ensure_ascii=False)
            return str(v)

        db_extracted_value = serialize_db_val(extracted_value)
        db_supporting_text = serialize_db_val(supporting_text)

        if db_extracted_value is None:
            validation_status = "MISSING"
        else:
            # Initial status — deterministic rule engine runs later in _validate_parameters
            validation_status = "NEEDS_REVIEW"

        query = """
            INSERT INTO draft_parameters (
                param_id, contract_id, parameter_name, parameter_group,
                extracted_value, supporting_text, confidence,
                validation_status, model_used, extraction_ts
            ) VALUES (
                HEXTORAW(:param_id), HEXTORAW(:contract_id), :parameter_name, :parameter_group,
                :extracted_value, :supporting_text, :confidence,
                :validation_status, :model_used, CURRENT_TIMESTAMP
            )
        """

        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(query, {
                    "param_id":          param_id,
                    "contract_id":       contract_id,
                    "parameter_name":    parameter_name,
                    "parameter_group":   parameter_group,
                    "extracted_value":   db_extracted_value,
                    "supporting_text":   db_supporting_text,
                    "confidence":        confidence,
                    "validation_status": validation_status,
                    "model_used":        model_used,
                })
                await conn.commit()

        return param_id

    @staticmethod
    async def _ground_all_parameters(contract_id: str) -> int:
        """Ground all extracted parameters that have supporting text."""
        query = """
            SELECT param_id, extracted_value, supporting_text
            FROM draft_parameters
            WHERE contract_id = HEXTORAW(:contract_id) AND supporting_text IS NOT NULL
        """

        grounded_count = 0

        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(query, {"contract_id": contract_id})
                rows = await cursor.fetchall()

                for row in rows:
                    param_id        = row[0]
                    extracted_value = row[1]
                    supporting_text = row[2]

                    if hasattr(extracted_value, "read"):
                        extracted_value = await extracted_value.read()
                    if hasattr(supporting_text, "read"):
                        supporting_text = await supporting_text.read()

                    grounding_id = await GroundingService.ground_parameter(
                        contract_id=contract_id,
                        param_id=param_id,
                        supporting_text=supporting_text,
                        extracted_value=extracted_value or "",
                    )

                    if grounding_id:
                        grounded_count += 1
                    else:
                        # Relax grounding constraints: do NOT mark as UNGROUNDED or exclude from validation.
                        # Keep as NEEDS_REVIEW so it gets validated and is reviewed in the UI.
                        pass

        return grounded_count

    @staticmethod
    async def _validate_parameters(contract_id: str) -> int:
        """
        Deterministic rule engine for parameter validation.

        Rules (from PRD):
          R1  Effective Date exists → Expiry/End Date must be later
          R2  Contract Value must contain a currency symbol or ISO code
          R3  Auto-Renewal = true/yes → Renewal Notice Period must be present
          R4  Governing Law must match a known jurisdiction keyword
          R5  Confidence gate: confidence ≥ 0.80 AND not UNGROUNDED/MISSING

        A parameter passes validation only if all applicable rules pass.
        Failures set validation_status = 'INVALID' with a note in the parameter name
        column (future: separate flag column).  Params with no applicable rules that
        meet the confidence gate are set to VALID.
        """
        # Fetch all NEEDS_REVIEW parameters for this contract
        fetch_query = """
            SELECT param_id, parameter_name, parameter_group,
                   extracted_value, confidence, validation_status
            FROM draft_parameters
            WHERE contract_id = HEXTORAW(:contract_id)
              AND validation_status NOT IN ('MISSING', 'UNGROUNDED')
        """

        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(fetch_query, {"contract_id": contract_id})
                rows = await cursor.fetchall()

                # Build lookup by parameter_name for cross-field checks
                params_by_name: Dict[str, dict] = {}
                all_params = []

                for row in rows:
                    param_id         = row[0]
                    parameter_name   = row[1]
                    parameter_group  = row[2]
                    extracted_value  = row[3]
                    confidence       = float(row[4]) if row[4] else 0.0
                    validation_status = row[5]

                    if hasattr(extracted_value, "read"):
                        extracted_value = await extracted_value.read()

                    entry = {
                        "param_id":          param_id,
                        "parameter_name":    parameter_name,
                        "parameter_group":   parameter_group,
                        "extracted_value":   str(extracted_value or "").strip(),
                        "confidence":        confidence,
                        "validation_status": validation_status,
                    }
                    params_by_name[parameter_name.lower()] = entry
                    all_params.append(entry)

        # ---- Apply rules per parameter -------------------------------------
        validated_count = 0
        updates: List[Dict] = []

        def _get_val(name_fragment: str) -> Optional[str]:
            """Case-insensitive partial-name lookup in params_by_name."""
            for k, v in params_by_name.items():
                if name_fragment in k and v["extracted_value"]:
                    return v["extracted_value"]
            return None

        def _parse_date(val: str) -> Optional[date]:
            """Try to parse ISO date YYYY-MM-DD; returns None on failure."""
            try:
                return date.fromisoformat(val[:10])
            except Exception:
                return None

        effective_date_val = _get_val("effective date")
        expiry_date_val    = _get_val("expiry date") or _get_val("end date")

        for p in all_params:
            name  = p["parameter_name"].lower()
            value = p["extracted_value"]
            conf  = p["confidence"]
            issues: List[str] = []

            # R5 — Confidence gate (baseline for all params)
            # 0.60 threshold: catches genuine guesses while allowing implicit
            # date extractions from Indian MSA preambles (typically 0.65–0.82).
            if conf < 0.60:
                issues.append(f"confidence {conf:.2f} < 0.60")


            # R1 — Date ordering: only applicable to expiry/end date param
            if ("expiry date" in name or "end date" in name) and value and effective_date_val:
                eff = _parse_date(effective_date_val)
                exp = _parse_date(value)
                if eff and exp and exp <= eff:
                    issues.append(
                        f"End/Expiry date ({value}) must be after Effective date ({effective_date_val})"
                    )

            # R2 — Contract Value must have a currency signal
            if "contract value" in name or "total consideration" in name:
                if value and not _CURRENCY_PATTERN.search(value):
                    issues.append("Contract Value has no recognisable currency symbol or code")

            # R3 — Auto-Renewal requires Renewal Notice Period
            if "renewal terms" in name or "auto-renewal" in name:
                value_lower = value.lower() if value else ""
                if any(kw in value_lower for kw in ("auto", "automatic", "evergreen")):
                    notice = _get_val("renewal notice") or _get_val("notice period")
                    if not notice:
                        issues.append(
                            "Auto-renewal detected but Renewal Notice Period is absent"
                        )

            # R4 — Governing Law must be a known jurisdiction
            if "governing law" in name:
                if value:
                    value_lower = value.lower()
                    if not any(j in value_lower for j in _KNOWN_JURISDICTIONS):
                        issues.append(
                            f"Governing law '{value}' does not match any known jurisdiction"
                        )
                else:
                    issues.append("Governing Law is absent")

            # ---- Determine final status ------------------------------------
            if issues:
                new_status = "INVALID"
                logger.debug(f"INVALID param '{p['parameter_name']}': {'; '.join(issues)}")
            else:
                new_status = "VALID"
                validated_count += 1

            updates.append({"param_id": p["param_id"], "status": new_status})

        # ---- Bulk update ---------------------------------------------------
        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                for upd in updates:
                    await cursor.execute(
                        "UPDATE draft_parameters SET validation_status = :status "
                        "WHERE param_id = HEXTORAW(:param_id)",
                        {"status": upd["status"], "param_id": upd["param_id"]},
                    )
                await conn.commit()

        logger.info(f"Validation complete: {validated_count}/{len(all_params)} VALID")
        return validated_count

    @staticmethod
    async def get_draft_parameters(contract_id: str) -> List[Dict]:
        """Get all draft parameters for a contract."""
        query = """
            SELECT p.param_id, p.parameter_name, p.parameter_group,
                   p.extracted_value, p.supporting_text, p.confidence,
                   p.validation_status, p.edited_value, p.reviewer_status,
                   g.page_number, g.bbox_x1, g.bbox_y1, g.bbox_x2, g.bbox_y2,
                   g.source_text, g.match_method
            FROM draft_parameters p
            LEFT JOIN draft_grounding_records g ON p.param_id = g.param_id
            WHERE p.contract_id = HEXTORAW(:contract_id)
            ORDER BY p.parameter_group, p.parameter_name
        """

        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(query, {"contract_id": contract_id})
                rows = await cursor.fetchall()

                results = []
                for row in rows:
                    extracted_value = row[3]
                    if hasattr(extracted_value, "read"):
                        extracted_value = await extracted_value.read()

                    supporting_text = row[4]
                    if hasattr(supporting_text, "read"):
                        supporting_text = await supporting_text.read()

                    edited_value = row[7]
                    if hasattr(edited_value, "read"):
                        edited_value = await edited_value.read()

                    source_text = row[14]
                    if hasattr(source_text, "read"):
                        source_text = await source_text.read()

                    results.append({
                        "param_id":        row[0],
                        "parameter_name":  row[1],
                        "parameter_group": row[2],
                        "extracted_value": extracted_value,
                        "supporting_text": supporting_text,
                        "confidence":      float(row[5]) if row[5] else 0.0,
                        "validation_status": row[6],
                        "edited_value":    edited_value,
                        "reviewer_status": row[8],
                        "grounding": {
                            "page_number": row[9],
                            "bbox_x1":  float(row[10]) if row[10] else None,
                            "bbox_y1":  float(row[11]) if row[11] else None,
                            "bbox_x2":  float(row[12]) if row[12] else None,
                            "bbox_y2":  float(row[13]) if row[13] else None,
                            "source_text":   source_text,
                            "match_method":  row[15],
                        } if row[9] else None,
                    })

                return results
