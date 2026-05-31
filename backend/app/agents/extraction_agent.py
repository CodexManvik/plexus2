"""
Extraction agent for structured parameter extraction.
Uses Groq Llama 3.3 70B for complex legal reasoning.
Phase 3 implementation.

FIXES (2026-05-31):
  1. build_context_for_batch now searches the FULL raw_text of each block
     (not just the first 120 chars) for hint keywords.  The previous limit
     caused Batch 1 to miss blocks whose date/metadata content appeared
     mid-paragraph rather than at the start of the first line.

  2. Batch 1 always includes the document preamble (first 30 blocks) because
     contract metadata (title, dates, parties) is invariably at the top.
     This is a hard rule, not a hint — Batch 1 should never get zero context.

  3. _CHUNK_CHAR_LIMIT raised from 6 000 → 14 000 chars. Groq llama-3.3-70b
     has a 32 k token context window; 14 000 chars ≈ 3 500 tokens, leaving
     ample room for the system prompt and JSON response.

  4. Batch 1 hints expanded to cover Indian MSA conventions:
     "this agreement", "entered into", "as of", "day of", "signed on",
     "commencement", "initial term", "validity".

  5. Extraction prompt rewritten to be explicit about:
     - Indian date formats ("26th January 2026", "January 26, 2026")
     - Inline dates in preamble ("entered into as of...")
     - MSA/SOW/NDA title extraction from heading blocks
"""

import json
import re
from typing import Dict, List, Optional
from ..utils.groq_client import groq_client
from ..config import settings
import logging

logger = logging.getLogger(__name__)

# Max chars sent to the LLM per batch.
# 14 000 chars ≈ 3 500 tokens — well within the 32 k context window.
_CHUNK_CHAR_LIMIT = 14_000

# How many blocks to include before/after a section-heading match.
# Reduced from 5 to 3 to keep context highly targeted and avoid truncation.
_CONTEXT_WINDOW = 3

# Batch 1 always gets this many blocks from the document start (preamble guarantee).
# Reduced from 40 to 15 to prevent the preamble from flooding the context budget
# and slicing off critical term/signature clauses at the end of the document.
_PREAMBLE_BLOCKS = 15


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

    # Section keyword hints: maps batch name → lowercase keywords.
    # A block is considered relevant when its section_heading OR its FULL
    # raw_text contains any of these keywords (case-insensitive).
    #
    # Expanded significantly to improve initial context retrieval recall (Change 3).
    _BATCH_SECTION_HINTS: Dict[str, List[str]] = {
        "Batch 1: Metadata & Dates": [
            # Standard English contract openers
            "recital", "whereas", "preamble", "background",
            # Date label keywords
            "effective date", "agreement date", "execution date",
            "commencement date", "signing date", "signed on",
            # Indian MSA conventions
            "this agreement", "this master service agreement",
            "entered into", "as of", "day of",
            # Term/duration section
            "term", "duration", "renewal", "validity",
            "initial term", "commencement",
            # Expanded metadata hints (Change 3)
            "extension", "extend", "renewed", "renewal", "effective from",
            "commencing", "commence", "shall continue",
            # Title keywords
            "master service agreement", "service agreement",
            "non-disclosure", "memorandum", "letter of intent",
        ],
        "Batch 2: Parties": [
            "parties", "party", "between", "witnesseth",
            "client", "vendor", "service provider",
            "contractor", "customer", "supplier",
            "hereinafter referred", "company limited",
            "pvt. ltd", "private limited", "inc.", "llp",
        ],
        "Batch 3: Scope & Deliverables": [
            "scope", "deliverable", "services", "work", "project",
            "objective", "schedule", "milestone",
            "statement of work", "sow", "annexure", "schedule a",
            "description of services",
        ],
        "Batch 4: Financial Terms": [
            "payment", "price", "consideration", "fee", "invoice",
            "tax", "currency", "cost", "billing", "rate",
            "financial", "compensation", "milestone",
            "escalation", "gst", "tds", "withholding",
            "purchase order", "po number",
            # Expanded financial hints (Change 3)
            "schedule b", "charges", "service fee", "fees",
            "reimbursement", "payment shall", "invoice shall",
            "out of pocket",
        ],
        "Batch 5: Legal & Compliance": [
            "governing law", "jurisdiction", "arbitration", "dispute",
            "compliance", "anti-bribery", "anti-corruption",
            "data protection", "privacy", "gdpr", "pdpa",
            "confidential", "intellectual property", "ip rights",
            "applicable law",
            # Expanded legal hints (Change 3)
            "laws of india", "exclusive jurisdiction", "competent courts",
            "venue", "dispute resolution", "arbitral tribunal",
            "arbitrator", "conciliation",
        ],
        "Batch 6: Risk & Liability": [
            "liability", "limitation", "indemnif", "warranty",
            "insurance", "force majeure", "consequential",
            "damages", "risk", "aggregate liability",
        ],
        "Batch 7: Performance & Penalties": [
            "sla", "service level", "kpi", "penalty",
            "liquidated damages", "credit", "incentive",
            "bonus", "performance", "escalation matrix",
            "response time", "uptime",
        ],
        "Batch 8: Termination & Exit": [
            "terminat", "notice", "exit", "transition", "breach",
            "cure", "convenience", "cause", "post-termination",
            "wind-down", "handover",
            # Expanded termination hints (Change 3)
            "termination", "terminate", "termination for convenience",
            "termination for cause", "material breach", "cure period",
            "transition assistance", "exit", "post termination",
        ],
        "Batch 9: Data & Confidentiality": [
            "confidential", "data storage", "data processing",
            "security standard", "breach notification",
            "subcontractor", "data retention", "personal data",
            "data localisation", "encryption",
        ],
    }

    # Parameter-level target hints for highly granular clause retrieval (Change 7).
    PARAMETER_HINTS: Dict[str, List[str]] = {
        "Notice Period": ["notice period", "notice", "30 days notice", "written notice", "termination notice"],
        "Cure Period": ["cure period", "rectify", "days from receipt", "material breach", "remedy period", "cure"],
        "Governing Law": ["governed by", "laws of", "applicable law", "governing law", "governed and construed"],
        "Arbitration Clause": ["arbitration", "arbitrator", "arbitral tribunal", "conciliation act", "dispute resolution"],
        "Renewal Terms": ["renew", "renewal", "extend", "extension", "term", "validity", "continue", "additional period"],
        "Contract Value / Total Consideration": ["consideration", "contract value", "total value", "fees", "charges", "payment"],
        "Payment Terms": ["payment terms", "within 30 days", "invoice", "working days", "payment shall", "net 30"],
        "Invoicing Process": ["invoice", "invoicing", "bill", "billing", "monthly"],
        "Exit Strategy / Transition Plan": ["transition assistance", "handover", "exit", "post termination", "cooperation", "exit strategy", "orderly transition"],
        "Contract Title / Agreement Name": ["this agreement", "agreement name", "contract title", "title of agreement"],
        "Contract Type": ["service agreement", "master service", "non-disclosure", "employment", "agreement type"],
        "Contract Number / Reference ID": ["reference id", "contract number", "agreement number", "unique id", "ref no"],
        "Version / Amendment Number": ["version", "amendment", "revision", "version number", "amendment number"],
        "Effective Date": ["effective date", "date of agreement", "commence on", "entered into as of"],
        "Execution / Signing Date": ["signing date", "signed on", "execution date", "date of execution", "signed by"],
        "Start Date": ["start date", "commencement date", "effective date", "shall commence"],
        "End Date / Expiry Date": ["expiry date", "end date", "terminate on", "valid for", "duration of"],
        "Legal Names of Parties": ["by and between", "the parties", "hereinafter referred", "legal name"],
        "Registered Addresses": ["registered address", "office at", "registered office"],
        "CIN / Registration Numbers": ["cin number", "registration number", "cin", "corporate identity"],
        "Authorized Signatories": ["authorized signatory", "authorized representative", "signed by", "signatories"],
        "Contact Persons": ["contact person", "attention", "notices to", "contact details"],
        "Roles": ["client", "vendor", "customer", "service provider", "buyer", "supplier"],
        "Affiliates / Subsidiaries": ["affiliates", "subsidiaries", "affiliate", "subsidiary", "group companies"],
    }

    # ---------------------------------------------------------------------------
    # Public API
    # ---------------------------------------------------------------------------

    @staticmethod
    def build_context_for_batch(batch_name: str, blocks: List[Dict]) -> str:
        """
        Select semantically relevant blocks for a batch and build the
        document_text string passed to the LLM.

        Strategy:
        1. For Batch 1 (Metadata & Dates): ALWAYS include the first
           _PREAMBLE_BLOCKS blocks regardless of hint matching, because
           contract metadata lives in the preamble and the preamble is
           invariably at the top of the document.
        2. Score every block against the batch's section keywords, searching
           the FULL raw_text (not just the first 120 chars).
        3. Collect all matching blocks plus a ±_CONTEXT_WINDOW sliding window.
        4. Preserve section_heading as a markdown ## header.
        5. Truncate at dynamic limit (4500 for local, 14000 for groq).
        6. If still nothing matched, fall back to the entire document (truncated).
        """
        # Both local and Groq backends use the full _CHUNK_CHAR_LIMIT (14,000 chars)
        # to ensure that term and signature blocks are not truncated.
        limit = _CHUNK_CHAR_LIMIT
        hints = ExtractionAgent._BATCH_SECTION_HINTS.get(batch_name, [])
        n = len(blocks)
        matched_indices: set = set()

        # ── Batch 1 preamble guarantee ──────────────────────────────────────
        # Metadata & Dates information is always in the opening section.
        # Add the first _PREAMBLE_BLOCKS unconditionally so the LLM always
        # sees the title, execution clause, and date references.
        if batch_name == "Batch 1: Metadata & Dates":
            for i in range(min(_PREAMBLE_BLOCKS, n)):
                matched_indices.add(i)

        # ── Hint-based matching (full raw_text search) ───────────────────────
        for idx, block in enumerate(blocks):
            heading = str(block.get("section_heading") or "").lower()
            # FIX: search full raw_text, not just first 120 chars
            full_text = str(block.get("raw_text") or "").lower()
            candidate = heading + " " + full_text

            if any(hint in candidate for hint in hints):
                for offset in range(-_CONTEXT_WINDOW, _CONTEXT_WINDOW + 1):
                    neighbour = idx + offset
                    if 0 <= neighbour < n:
                        matched_indices.add(neighbour)

        # Fall back to entire document if nothing matched
        selected_indices = sorted(matched_indices) if matched_indices else list(range(n))

        # ── Build text with section markers ──────────────────────────────────
        parts: List[str] = []
        last_heading: Optional[str] = None

        for idx in selected_indices:
            block = blocks[idx]
            heading = block.get("section_heading")
            raw_text = str(block.get("raw_text") or "").strip()

            if not raw_text:
                continue

            if heading and heading != last_heading:
                parts.append(f"\n## {heading}\n")
                last_heading = heading
            elif block.get("block_type") == "heading":
                parts.append(f"\n## {raw_text}\n")
                last_heading = raw_text
                continue

            parts.append(raw_text)

        document_text = "\n".join(parts)

        # ── Truncate ──────────────────────────────────────────────────────────
        if len(document_text) > limit:
            document_text = document_text[:limit]
            last_space = document_text.rfind(" ")
            if last_space > limit * 0.9:
                document_text = document_text[:last_space]

        logger.debug(
            f"[{batch_name}] context: {len(selected_indices)} blocks, "
            f"{len(document_text)} chars"
        )
        return document_text

    @staticmethod
    def global_clause_search(parameter_name: str, blocks: List[Dict]) -> str:
        """
        Perform a section-agnostic search across the entire document for a specific parameter.
        Uses parameterized clause ranking (Change B) to reduce noise.
        """
        import re
        # Retrieve hints for the parameter name (case-insensitive fallback)
        hints = []
        param_lower = parameter_name.lower()
        for k, v in ExtractionAgent.PARAMETER_HINTS.items():
            if k.lower() == param_lower:
                hints = v
                break
        if not hints:
            # Fallback: split parameter name into tokens as hints
            hints = [t for t in re.split(r'\W+', param_lower) if len(t) > 3]

        n = len(blocks)
        scored_blocks = []

        for idx, block in enumerate(blocks):
            heading = str(block.get("section_heading") or "").lower()
            full_text = str(block.get("raw_text") or "").lower()
            
            keyword_hits = 0
            exact_phrase_hits = 0
            heading_match = 0

            # Count keyword hits
            for hint in hints:
                keyword_hits += len(re.findall(r'\b' + re.escape(hint.lower()) + r'\b', full_text))
                
                # Check exact phrase matches (if hint has spaces)
                if ' ' in hint and hint.lower() in full_text:
                    exact_phrase_hits += full_text.count(hint.lower())

            # Check heading match
            for hint in hints:
                if hint.lower() in heading:
                    heading_match += 1

            # Calculate score: keyword * 2 + exact * 5 + heading * 3
            score = (keyword_hits * 2) + (exact_phrase_hits * 5) + (heading_match * 3)

            if score > 0:
                scored_blocks.append((score, idx, block))

        # Sort blocks by score descending, then keep top 5
        scored_blocks.sort(key=lambda x: x[0], reverse=True)
        top_matches = scored_blocks[:5]

        # For the top 5 matches, collect indices with a tight sliding window of +/- 2 blocks
        matched_indices = set()
        for _, match_idx, _ in top_matches:
            for offset in range(-2, 3):  # +/- 2 blocks
                neighbour = match_idx + offset
                if 0 <= neighbour < n:
                    matched_indices.add(neighbour)

        if not matched_indices:
            # Absolute fallback: return empty context so recovery pass handles it
            return ""

        # Stitch matched blocks in original document sequence
        selected_indices = sorted(list(matched_indices))
        parts = []
        last_heading = None

        for idx in selected_indices:
            block = blocks[idx]
            heading = block.get("section_heading")
            raw_text = str(block.get("raw_text") or "").strip()

            if not raw_text:
                continue

            if heading and heading != last_heading:
                parts.append(f"\n## {heading}\n")
                last_heading = heading
            elif block.get("block_type") == "heading":
                parts.append(f"\n## {raw_text}\n")
                last_heading = raw_text
                continue

            parts.append(raw_text)

        return "\n".join(parts)

    @staticmethod
    def build_full_document_context(blocks: List[Dict]) -> str:
        """
        Build full document context sequentially. (Change A)
        Dynamic limits based on LLM backend:
          - Groq: 80,000 characters
          - Local: 24,000 characters
        """
        limit = 24_000 if settings.llm_backend == "local" else 80_000

        parts = []
        last_heading = None

        for block in blocks:
            heading = block.get("section_heading")
            raw_text = str(block.get("raw_text") or "").strip()

            if not raw_text:
                continue

            if heading and heading != last_heading:
                parts.append(f"\n## {heading}\n")
                last_heading = heading
            elif block.get("block_type") == "heading":
                parts.append(f"\n## {raw_text}\n")
                last_heading = raw_text
                continue

            parts.append(raw_text)

        document_text = "\n".join(parts)

        # Truncate to dynamic limit
        if len(document_text) > limit:
            document_text = document_text[:limit]
            last_space = document_text.rfind(" ")
            if last_space > limit * 0.9:
                document_text = document_text[:last_space]

        return document_text

    @staticmethod
    def _build_prompt(batch_name: str, parameters: List[str], document_text: str) -> str:
        """
        Build the user-turn prompt for a given batch.

        Optimized for local models (such as Gemma) and heavy models (such as Llama 3 70B) to:
          - Mitigate recency bias by placing context above instructions.
          - Guide structural format via a concrete one-shot extraction example.
          - Handle Indian date formats and preamble/metadata patterns.
        """
        param_list = "\n".join([f"{i + 1}. {p}" for i, p in enumerate(parameters)])

        return f"""You are a contract analysis expert specialising in structured data extraction from legal agreements, including Indian contracts and MSAs.

### SOURCE CONTRACT TEXT (section-filtered; ## headers mark clause boundaries):
{document_text}

---

### PARAMETERS TO EXTRACT ({batch_name}):
{param_list}

---

### EXTRACTION RULES:

1. **Dates** — Indian contracts use many formats. Accept ALL of these:
   - "26th January, 2026" → "2026-01-26"
   - "January 26, 2026" → "2026-01-26"
   - "26/01/2026" or "26.01.2026" → "2026-01-26"
   - Dates embedded in preamble: "entered into as of the 1st day of January, 2026" → "2026-01-01"
   - Preserve the original format in supporting_text; use ISO in extracted_value.

2. **Affiliates / Subsidiaries** — Only extract explicitly named affiliate/subsidiary corporate entities. Do NOT extract generic legal placeholders like successors, assigns, representatives, agents, employees, or permitted assignees. If no specific affiliate corporate entity is explicitly named, return null.

3. **Inferences & Normalizations** — Do not return null simply because a value is not explicitly labeled. Infer contract fields when they are clearly stated in prose:
   - "This Agreement shall remain valid for 24 months commencing 21-Oct-2024..." → End Date / Expiry Date = "2026-10-20"
   - "payment within thirty (30) working days after end of month" → Payment Terms = "Net 30 Working Days"
   - "laws of India" or "governed by Indian Law" → Governing Law = "India"
   - "Either party may terminate with 30 days notice" → Notice Period = "30 Days"
   - "The parties may extend the agreement by mutual consent" → Renewal Terms = "Mutual Consent"

4. **Null Policy** — Return null ONLY when the information is genuinely absent from the contract text. Prefer low-confidence candidate extractions over null if there is any plausible prose evidence (such as implied values or related sentences).

5. **supporting_text** — must be a VERBATIM excerpt from the contract text above. Never paraphrase. Include the surrounding sentence for context.

6. **confidence** — be conservative:
   - Explicit label + value (e.g. "Effective Date: 1 Jan 2026"): 0.90–0.95
   - Implied/inferred value: 0.60–0.80
   - Absent or uncertain: 0.0–0.40

---

### ONE-SHOT EXTRACTION EXAMPLE:
If the parameters "Effective Date", "Contract Value", "Governing Law", and "Affiliates / Subsidiaries" were requested from the following text fragment:
"This Agreement is entered into on 26th January, 2026 (the 'Effective Date') by and between the parties. The total consideration of the project is $50,000. This contract is governed by the laws of India. Permitted assignees and successors of the parties shall be bound."

Expected JSON output:
{{
  "parameters": [
    {{
      "parameter_name": "Effective Date",
      "extracted_value": "2026-01-26",
      "supporting_text": "entered into on 26th January, 2026",
      "confidence": 0.95,
      "section_title": "Preamble",
      "notes": null
    }},
    {{
      "parameter_name": "Contract Value",
      "extracted_value": "$50,000",
      "supporting_text": "total consideration of the project is $50,000",
      "confidence": 0.90,
      "section_title": "Preamble",
      "notes": null
    }},
    {{
      "parameter_name": "Governing Law",
      "extracted_value": "India",
      "supporting_text": "governed by the laws of India",
      "confidence": 0.95,
      "section_title": "Preamble",
      "notes": null
    }},
    {{
      "parameter_name": "Affiliates / Subsidiaries",
      "extracted_value": null,
      "supporting_text": null,
      "confidence": 0.0,
      "section_title": null,
      "notes": "No specific affiliate corporate entities named. Successors and assignees are generic legal placeholders and must be ignored."
    }}
  ]
}}

---

### RESPONSE FORMAT CONSTRAINT:
Return ONLY a valid JSON object matching the schema below. Do not add any conversational markdown prefix (such as "Here is the JSON:") or suffix outside of the JSON block itself. Ensure all strings inside the JSON are correctly escaped.

Expected JSON schema:
{{
  "parameters": [
    {{
      "parameter_name": "exact parameter name from the list above",
      "extracted_value": "extracted value or null",
      "supporting_text": "verbatim excerpt from the contract text",
      "confidence": 0.85,
      "section_title": "## heading under which the evidence appears, or null",
      "notes": "any caveats or null"
    }}
  ]
}}"""

    @staticmethod
    def extract_batch(batch_name: str, parameters: List[str], document_text: str) -> List[Dict]:
        """
        Extract a batch of related parameters (synchronous — call via async_call).

        Args:
            batch_name:    Name of the batch
            parameters:    List of parameter names to extract
            document_text: Pre-selected, section-focused document text

        Returns:
            List of extracted parameters
        """
        prompt = ExtractionAgent._build_prompt(batch_name, parameters, document_text)

        try:
            response = groq_client.call(
                model=settings.groq_model_heavy,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a contract parameter extraction expert. "
                            "Always return valid JSON. Never invent values. "
                            "Pay special attention to Indian contract date formats."
                        ),
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.1,   # Very low temp → minimal hallucination
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