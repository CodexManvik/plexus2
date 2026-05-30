# Phase 2 Complete — Upload & Tagging

## What Was Built

Phase 2 is **COMPLETE**. The following components are fully implemented:

### Core Utilities

1. **groq_client.py** — Centralized Groq API client
   - Exponential backoff retry logic (3 attempts)
   - Token usage tracking
   - Timeout handling (30s)
   - Supports both Llama 3.3 70B and 3.1 8B

2. **text_utils.py** — Text processing utilities
   - Text normalization (lowercase, whitespace)
   - Fuzzy matching with SequenceMatcher
   - Number and date extraction
   - Value cleaning

3. **bbox.py** — Bounding box coordinate utilities
   - Normalize/denormalize coordinates (0-1 scale)
   - Bbox area calculation
   - Overlap detection

### Services

4. **parsing_service.py** — Document parsing
   - PDF parsing with PyMuPDF (fitz)
   - DOCX parsing with python-docx
   - Canonical block extraction with bounding boxes
   - Page count tracking
   - Block type detection (paragraph, heading)

5. **ingestion_service.py** — File upload handling
   - Local file storage (uploads/ directory)
   - SHA-256 checksum calculation
   - Contract record creation
   - Metadata persistence
   - Audit logging

6. **tag_suggestion_service.py** — Tag suggestion orchestration
   - AI tag generation coordination
   - Suggestion persistence
   - Suggestion acceptance workflow
   - Contract metadata updates

### AI Agents

7. **tagging_agent.py** — AI metadata extraction
   - Uses Groq Llama 3.3 70B
   - Master data for contract types (9 categories, 40+ agreement types)
   - Suggests: contract_type, agreement_type, department, customer_name
   - Returns confidence scores and rationale
   - Evidence text extraction

### API Endpoints

8. **POST /upload/** — Upload contract file
   - Accepts PDF and DOCX
   - Validates file type
   - Ingests file → Parses → Generates tag suggestions
   - Workflow: UPLOADED → PARSING → TAG_SUGGESTION_READY
   - Returns contract_id, blocks_created, suggestions_count

9. **GET /upload/{contract_id}/tags/suggest** — Get tag suggestions
   - Returns AI-suggested metadata
   - Includes confidence, rationale, evidence

10. **POST /upload/{contract_id}/tags/{suggestion_id}/accept** — Accept suggestion
    - Applies suggestion to contract
    - Updates contract metadata

## Workflow

```
User uploads file
    ↓
Ingestion Service saves file locally
    ↓
Contract record created (UPLOADED state)
    ↓
Transition to PARSING
    ↓
Parsing Service extracts canonical blocks
    ↓
Transition to TAG_SUGGESTION_READY
    ↓
Tagging Agent generates AI suggestions
    ↓
User reviews and accepts/edits suggestions
    ↓
Ready for Phase 3 (Extraction)
```

## Master Data

Contract Types and Agreement Types (from PRD):

1. **Commercial & Business**: Sale Agreement, Purchase Agreement, Distribution Agreement, Franchise Agreement, Joint Venture Agreement, Shareholders Agreement, NDA

2. **Employment & HR**: Employment Agreement, Consultancy Agreement, Non-Compete Agreement, Freelance Agreement, Apprenticeship Contract

3. **Banking & Finance**: Loan Agreement, Credit Facility Agreement, Security Agreement, Guarantee Agreement, Lease Financing Agreement

4. **Real Estate & Infrastructure**: Sale Deed, Lease Agreement, Leave & License Agreement, Construction Contract, Development Agreement

5. **Technology & IT**: Software License Agreement, SaaS Agreement, SLA, Data Processing Agreement, IT Outsourcing Contract

6. **Intellectual Property**: Licensing Agreement, Assignment Agreement, Royalty Agreement, Trademark/Patent Licensing

7. **Insurance**: Life Insurance Policy, General Insurance Contract, Reinsurance Agreement

8. **Construction & EPC**: EPC Contract, Turnkey Contract, Subcontracting Agreement

9. **International Trade**: Import/Export Agreement, Shipping Contract, Letter of Credit, Incoterms-based Agreements

## Testing Phase 2

### 1. Upload a PDF Contract

```bash
curl -X POST http://localhost:8000/upload/ \
  -H "Authorization: Bearer <access_token>" \
  -F "file=@sample_contract.pdf" \
  -F "organization=Acme Corp" \
  -F "department=Legal"
```

Expected response:
```json
{
  "contract_id": "uuid",
  "filename": "sample_contract.pdf",
  "blocks_created": 150,
  "suggestions_count": 4,
  "workflow_state": "TAG_SUGGESTION_READY"
}
```

### 2. Get Tag Suggestions

```bash
curl http://localhost:8000/upload/{contract_id}/tags/suggest \
  -H "Authorization: Bearer <access_token>"
```

Expected response:
```json
{
  "contract_id": "uuid",
  "suggestions": [
    {
      "suggestion_id": "uuid",
      "field_name": "contract_type",
      "suggested_value": "Technology & IT",
      "confidence": 0.92,
      "rationale": "Document mentions software licensing and SaaS terms",
      "evidence_text": "This Software License Agreement..."
    },
    ...
  ],
  "count": 4
}
```

### 3. Accept a Suggestion

```bash
curl -X POST http://localhost:8000/upload/{contract_id}/tags/{suggestion_id}/accept \
  -H "Authorization: Bearer <access_token>"
```

## Files Created

```
backend/app/
├── utils/
│   ├── groq_client.py          # Groq API client with retry
│   ├── text_utils.py           # Text processing utilities
│   └── bbox.py                 # Bounding box utilities
├── services/
│   ├── parsing_service.py      # PDF/DOCX parsing
│   ├── ingestion_service.py    # File upload handling
│   └── tag_suggestion_service.py  # Tag orchestration
├── agents/
│   └── tagging_agent.py        # AI metadata extraction
└── routers/
    └── upload.py               # Upload endpoints (updated)
```

## Database Tables Used

- `contracts` — Contract metadata
- `document_blocks` — Canonical positioned blocks
- `draft_tag_suggestions` — AI-suggested tags
- `workflow_transitions` — State changes
- `audit_log` — All actions

## Next: Phase 3 — Extraction & Grounding

Phase 3 will implement:
- Parameter extraction (50+ fields in 9 semantic groups)
- Grounding service (exact → fuzzy → LLM chain)
- Validation service (deterministic rules)
- Draft review workspace (3-panel UI)
- PDF.js viewer with bounding box highlighting

See PRD Section 7.2-7.4 for details.
