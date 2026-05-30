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

# Cap concurrent Groq calls.  Groq's rate limit is per-minute token budget,
# not per-request concurrency, but > 3 simultaneous 70B calls risks 429s.
_GROQ_SEMAPHORE = asyncio.Semaphore(3)

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
            # ----------------------------------------------------------------
            batch_names = list(all_batches.keys())
            total_batches = len(batch_names)

            async def run_one_batch(batch_name: str, parameters: List[str]) -> List[Dict]:
                # Build the section-focused context for this batch
                document_text = ExtractionAgent.build_context_for_batch(batch_name, blocks)

                async with _GROQ_SEMAPHORE:
                    logger.info(f"Extracting {batch_name} ({len(document_text)} chars)...")
                    # async_call offloads the blocking Groq SDK call to a thread executor
                    response_json = await groq_client.async_call(
                        model=settings.groq_model_heavy,
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
                                "content": ExtractionAgent._build_prompt(batch_name, parameters, document_text),
                            },
                        ],
                        temperature=0.2,
                        max_tokens=4000,
                        response_format={"type": "json_object"},
                    )

                import json as _json
                try:
                    result = _json.loads(response_json)
                    extracted = result.get("parameters", [])
                except Exception as parse_err:
                    logger.error(f"JSON parse failed for {batch_name}: {parse_err}")
                    extracted = []

                if not extracted:
                    # Fallback: return MISSING entries so the contract isn't stuck
                    extracted = [
                        {
                            "parameter_name": p,
                            "extracted_value": None,
                            "supporting_text": None,
                            "confidence": 0.0,
                            "section_title": None,
                            "notes": "Extraction returned empty response",
                        }
                        for p in parameters
                    ]

                batch_index = batch_names.index(batch_name) + 1
                progress = 0.05 + (batch_index / total_batches) * 0.45  # 5% → 50%
                await emit_async(contract_id, {
                    "stage":    "EXTRACTION_RUNNING",
                    "message":  f"Completed {batch_name} — {len(extracted)} parameters",
                    "batch":    batch_name,
                    "progress": round(progress, 2),
                })

                logger.info(f"Completed {batch_name}: {len(extracted)} parameters")
                return batch_name, extracted

            tasks = [
                run_one_batch(batch_name, parameters)
                for batch_name, parameters in all_batches.items()
            ]
            batch_results = await asyncio.gather(*tasks, return_exceptions=True)

            # ----------------------------------------------------------------
            # Persist all results
            # ----------------------------------------------------------------
            total_params = 0
            for result in batch_results:
                if isinstance(result, Exception):
                    logger.error(f"Batch task raised exception: {result}")
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
                        model_used=settings.groq_model_heavy,
                    )
                    total_params += 1

            logger.info(f"Extraction complete: {total_params} parameters saved")

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

        if extracted_value is None:
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
                    "extracted_value":   extracted_value,
                    "supporting_text":   supporting_text,
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
                        await cursor.execute(
                            "UPDATE draft_parameters SET validation_status = 'UNGROUNDED' "
                            "WHERE param_id = HEXTORAW(:param_id)",
                            {"param_id": param_id},
                        )
                        await conn.commit()

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
            if conf < 0.80:
                issues.append(f"confidence {conf:.2f} < 0.80")

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
