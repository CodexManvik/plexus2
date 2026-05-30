"""
Extraction agent for structured parameter extraction.
Uses Groq Llama 3.3 70B for complex legal reasoning.
Phase 3 implementation.
"""

import json
import re
from typing import Dict, List, Optional
from ..utils.groq_client import groq_client
from ..config import settings
import logging

logger = logging.getLogger(__name__)

# Maximum characters sent to the LLM per batch.
# ~6 000 chars ≈ 1 500 words, well within the 32 k context window while
# leaving room for the system prompt and JSON response.
_CHUNK_CHAR_LIMIT = 6_000

# Window of blocks to include before/after a section-heading match.
_CONTEXT_WINDOW = 3


class ExtractionAgent:
    """AI agent for extracting structured parameters from contracts."""

    # Parameter groups from PRD Section 5
    PARAMETER_GROUPS: Dict[str, List[str]] = {
        "Batch 1: Metadata & Dates": [
            "Contract Title / Agreement Name",
            "Contract Type",
            "Contract Number / Reference ID",
            "Version / Amendment Number",
            "Effective Date",
            "Execution / Signing Date",
            "Start Date",
            "End Date / Expiry Date",
            "Renewal Terms",
        ],
        "Batch 2: Parties": [
            "Legal Names of Parties",
            "Registered Addresses",
            "CIN / Registration Numbers",
            "Authorized Signatories",
            "Contact Persons",
            "Roles",
            "Affiliates / Subsidiaries",
        ],
        "Batch 3: Scope & Deliverables": [
            "Description of Services / Deliverables",
            "Project Scope",
            "Deliverables List",
            "Quantity / Volume Commitments",
            "Performance Expectations",
            "Dependencies / Assumptions",
        ],
        "Batch 4: Financial Terms": [
            "Contract Value / Total Consideration",
            "Pricing Structure",
            "Rate Cards / Unit Pricing",
            "Currency",
            "Payment Terms",
            "Milestone Payments",
            "Invoicing Process",
            "Taxes & Duties",
            "Discounts / Rebates",
            "Escalation Clauses",
        ],
        "Batch 5: Legal & Compliance": [
            "Governing Law",
            "Jurisdiction / Dispute Venue",
            "Arbitration Clause",
            "Compliance Requirements",
            "Anti-Bribery / Anti-Corruption",
            "Data Protection & Privacy",
            "Confidentiality / NDA Terms",
            "Intellectual Property Rights",
        ],
        "Batch 6: Risk & Liability": [
            "Limitation of Liability",
            "Indemnification Clauses",
            "Warranty Terms",
            "Insurance Requirements",
            "Force Majeure Clause",
            "Risk Allocation",
            "Consequential Damages Exclusion",
        ],
        "Batch 7: Performance & Penalties": [
            "SLA Metrics",
            "KPIs / Service Benchmarks",
            "Penalties / Liquidated Damages",
            "Service Credits",
            "Bonus / Incentives",
            "Escalation Matrix",
        ],
        "Batch 8: Termination & Exit": [
            "Notice Period",
            "Termination Conditions",
            "Termination for Convenience",
            "Termination for Cause",
            "Breach Conditions",
            "Cure Period",
            "Exit Strategy / Transition Plan",
            "Post-Termination Obligations",
        ],
        "Batch 9: Data & Confidentiality": [
            "Confidential Information Definition",
            "Data Storage / Processing Locations",
            "Security Standards",
            "Data Breach Notification Timelines",
            "Subcontractor Data Access",
            "Data Retention Policy",
        ],
    }

    # Section keyword hints: maps batch name → list of lowercase heading fragments.
    # A block is considered relevant when its section_heading or raw_text first
    # line contains any of these keywords (case-insensitive substring match).
    _BATCH_SECTION_HINTS: Dict[str, List[str]] = {
        "Batch 1: Metadata & Dates": [
            "recital", "whereas", "preamble", "background", "effective date",
            "agreement date", "execution date", "term", "duration", "renewal",
        ],
        "Batch 2: Parties": [
            "parties", "party", "between", "witnesseth", "client", "vendor",
            "service provider", "contractor", "customer", "supplier",
        ],
        "Batch 3: Scope & Deliverables": [
            "scope", "deliverable", "services", "work", "project", "objective",
            "schedule", "milestone", "statement of work", "sow",
        ],
        "Batch 4: Financial Terms": [
            "payment", "price", "consideration", "fee", "invoice", "tax",
            "currency", "cost", "billing", "rate", "financial", "compensation",
            "milestone", "escalation",
        ],
        "Batch 5: Legal & Compliance": [
            "governing law", "jurisdiction", "arbitration", "dispute",
            "compliance", "anti-bribery", "anti-corruption", "data protection",
            "privacy", "gdpr", "confidential", "intellectual property", "ip rights",
        ],
        "Batch 6: Risk & Liability": [
            "liability", "limitation", "indemnif", "warranty", "insurance",
            "force majeure", "consequential", "damages", "risk",
        ],
        "Batch 7: Performance & Penalties": [
            "sla", "service level", "kpi", "penalty", "liquidated damages",
            "credit", "incentive", "bonus", "performance", "escalation matrix",
        ],
        "Batch 8: Termination & Exit": [
            "terminat", "notice", "exit", "transition", "breach", "cure",
            "convenience", "cause", "post-termination",
        ],
        "Batch 9: Data & Confidentiality": [
            "confidential", "data storage", "data processing", "security standard",
            "breach notification", "subcontractor", "data retention", "personal data",
        ],
    }

    # ---------------------------------------------------------------------------
    # Public API
    # ---------------------------------------------------------------------------

    @staticmethod
    def build_context_for_batch(batch_name: str, blocks: List[Dict]) -> str:
        """
        Select the semantically relevant blocks for a given batch and build the
        document_text string that will be passed to the LLM.

        Strategy:
        1. Score every block against the batch's section keywords.
        2. Collect all matching blocks plus a ±CONTEXT_WINDOW sliding window.
        3. Preserve section_heading as a markdown ## header so the model can
           identify which clause it is reading.
        4. Truncate at _CHUNK_CHAR_LIMIT characters (prevents exceeding context).
        5. Fall back to the first _CHUNK_CHAR_LIMIT chars of the whole document
           if no relevant blocks were found (e.g. short contracts, preamble only).
        """
        hints = ExtractionAgent._BATCH_SECTION_HINTS.get(batch_name, [])
        n = len(blocks)

        # --- Score blocks ---------------------------------------------------
        matched_indices: set = set()
        for idx, block in enumerate(blocks):
            heading = str(block.get("section_heading") or "").lower()
            first_line = str(block.get("raw_text") or "").split("\n")[0][:120].lower()
            candidate = heading + " " + first_line

            if any(hint in candidate for hint in hints):
                # Include the block and its neighbours
                for offset in range(-_CONTEXT_WINDOW, _CONTEXT_WINDOW + 1):
                    neighbour = idx + offset
                    if 0 <= neighbour < n:
                        matched_indices.add(neighbour)

        # If nothing matched, fall back to entire document (truncated later)
        selected_indices = sorted(matched_indices) if matched_indices else list(range(n))

        # --- Build text with section markers --------------------------------
        parts: List[str] = []
        last_heading: Optional[str] = None

        for idx in selected_indices:
            block = blocks[idx]
            heading = block.get("section_heading")
            raw_text = str(block.get("raw_text") or "").strip()

            if not raw_text:
                continue

            # Emit heading marker when it changes
            if heading and heading != last_heading:
                parts.append(f"\n## {heading}\n")
                last_heading = heading
            elif block.get("block_type") == "heading":
                # Block is itself a heading (parsed from PDF/DOCX styling)
                parts.append(f"\n## {raw_text}\n")
                last_heading = raw_text
                continue  # The heading text is the marker, don't double-emit

            parts.append(raw_text)

        document_text = "\n".join(parts)

        # --- Truncate to limit --------------------------------------------
        if len(document_text) > _CHUNK_CHAR_LIMIT:
            document_text = document_text[:_CHUNK_CHAR_LIMIT]
            # Don't cut mid-word
            last_space = document_text.rfind(" ")
            if last_space > _CHUNK_CHAR_LIMIT * 0.9:
                document_text = document_text[:last_space]

        logger.debug(
            f"[{batch_name}] context built: {len(selected_indices)} blocks selected, "
            f"{len(document_text)} chars"
        )
        return document_text

    @staticmethod
    def _build_prompt(batch_name: str, parameters: List[str], document_text: str) -> str:
        """Build the user-turn prompt for a given batch and document context."""
        param_list = "\n".join([f"{i + 1}. {p}" for i, p in enumerate(parameters)])
        return f"""You are a contract analysis expert specialising in structured data extraction from legal agreements.

PARAMETERS TO EXTRACT ({batch_name}):
{param_list}

CONTRACT TEXT (section-filtered, with ## headers marking clause boundaries):
{document_text}

For each parameter:
1. extracted_value — the actual value (string, date, number, list) or null if absent
2. supporting_text — a verbatim quote from the text above; include the section heading if it helps locate the clause
3. confidence — 0.0–1.0 reflecting how certain you are (penalise if value is inferred, not explicit)
4. section_title — the ## heading under which the evidence appears, or null

Return ONLY a JSON object:
{{
  "parameters": [
    {{
      "parameter_name": "...",
      "extracted_value": "value or null",
      "supporting_text": "verbatim quote from contract including section heading",
      "confidence": 0.85,
      "section_title": "Section heading or null",
      "notes": "any caveats or null"
    }}
  ]
}}

RULES:
- If a parameter is not present, set extracted_value to null and confidence to 0.0
- supporting_text must be a verbatim excerpt — never paraphrase
- For dates use YYYY-MM-DD where possible; preserve the original format if ambiguous
- For lists, separate items with semicolons
- Be conservative: a missing value is better than a hallucinated one"""

    @staticmethod
    def extract_batch(batch_name: str, parameters: List[str], document_text: str) -> List[Dict]:
        """
        Extract a batch of related parameters.

        This is a synchronous method — it is intended to be called from an
        async context via groq_client.async_call() (run_in_executor).

        Args:
            batch_name:    Name of the batch (e.g., "Batch 1: Metadata & Dates")
            parameters:    List of parameter names to extract
            document_text: Pre-selected, section-focused document text

        Returns:
            List of extracted parameters with values, confidence, and supporting text
        """
        param_list = "\n".join([f"{i + 1}. {p}" for i, p in enumerate(parameters)])

        prompt = f"""You are a contract analysis expert specialising in structured data extraction from legal agreements.

PARAMETERS TO EXTRACT ({batch_name}):
{param_list}

CONTRACT TEXT (section-filtered, with ## headers marking clause boundaries):
{document_text}

For each parameter:
1. extracted_value — the actual value (string, date, number, list) or null if absent
2. supporting_text — a verbatim quote from the text above; include the section heading if it helps locate the clause
3. confidence — 0.0–1.0 reflecting how certain you are (penalise if value is inferred, not explicit)
4. section_title — the ## heading under which the evidence appears, or null

Return ONLY a JSON object:
{{
  "parameters": [
    {{
      "parameter_name": "...",
      "extracted_value": "value or null",
      "supporting_text": "verbatim quote from contract including section heading",
      "confidence": 0.85,
      "section_title": "Section heading or null",
      "notes": "any caveats or null"
    }}
  ]
}}

RULES:
- If a parameter is not present, set extracted_value to null and confidence to 0.0
- supporting_text must be a verbatim excerpt — never paraphrase
- For dates use YYYY-MM-DD where possible; preserve the original format if ambiguous
- For lists, separate items with semicolons
- Be conservative: a missing value is better than a hallucinated one"""

        try:
            response = groq_client.call(
                model=settings.groq_model_heavy,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a contract parameter extraction expert. "
                            "Always return valid JSON. Never invent values."
                        ),
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.2,        # Lower temp → less hallucination
                max_tokens=4000,
                response_format={"type": "json_object"},
            )

            result = json.loads(response)
            extracted_params = result.get("parameters", [])
            logger.info(f"Extracted {len(extracted_params)} parameters from {batch_name}")
            return extracted_params

        except Exception as e:
            logger.error(f"Extraction failed for {batch_name}: {e}")
            return [
                {
                    "parameter_name": param,
                    "extracted_value": None,
                    "supporting_text": None,
                    "confidence": 0.0,
                    "section_title": None,
                    "notes": f"Extraction failed: {e}",
                }
                for param in parameters
            ]

    @staticmethod
    def get_all_batches() -> Dict[str, List[str]]:
        """Get all parameter batches."""
        return ExtractionAgent.PARAMETER_GROUPS
