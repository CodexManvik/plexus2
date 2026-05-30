# PLEXUS — Contract Intelligence Platform

Enterprise-grade AI-assisted contract intelligence platform built on Oracle Cloud Infrastructure (OCI).

## Architecture

- **Backend**: Python 3.11, FastAPI, Oracle 26ai
- **Frontend**: React 18, TypeScript, Tailwind CSS
- **AI Models**: Groq (Llama 3.3 70B + Llama 3.1 8B)
- **Embeddings**: Cohere Embed v3
- **Infrastructure**: Oracle Cloud Infrastructure (OCI)

## Phase 1 — Foundation ✓

Phase 1 is complete and includes:

- ✓ Oracle 26ai database schema (complete DDL)
- ✓ FastAPI backend with async Oracle connection pool
- ✓ JWT authentication system (register, login, refresh, logout)
- ✓ Role-based access control (Admin, Operation Head, Operation User)
- ✓ Workflow state machine with transition validation
- ✓ Audit logging service
- ✓ React frontend with ContractLens design system
- ✓ Protected routes and authentication flow
- ✓ Docker containerization

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 20+
- Oracle 26ai database (or Oracle XE for local dev)
- OCI account with Object Storage
- Groq API key
- Cohere API key

### 1. Environment Setup

```bash
# Copy environment template
cp .env.example .env

# Edit .env with your credentials
# - Oracle connection details
# - OCI Object Storage configuration
# - Groq API key
# - Cohere API key
# - JWT secret (generate with: openssl rand -hex 32)
```

### 2. Database Setup

```bash
# Connect to Oracle and run schema
sqlplus username/password@hostname:1521/servicename @backend/sql/schema.sql
```

### 3. Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run backend
uvicorn app.main:app --reload
```

Backend will be available at: http://localhost:8000

API documentation: http://localhost:8000/docs

### 4. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Run frontend
npm run dev
```

Frontend will be available at: http://localhost:3000

### 5. Docker Setup (Alternative)

```bash
# Build and run all services
docker-compose up --build

# Backend: http://localhost:8000
# Frontend: http://localhost:3000
```

## Default Admin User

After running the schema, a default admin user is created:

- **Email**: admin@plexus.local
- **Password**: Admin@123456 (change immediately in production)

## Project Structure

```
plexus/
├── backend/
│   ├── app/
│   │   ├── auth/              # Authentication & authorization
│   │   ├── services/          # Business logic services
│   │   ├── agents/            # AI agent implementations
│   │   ├── routers/           # API route handlers
│   │   ├── models/            # Pydantic models
│   │   ├── utils/             # Utility functions
│   │   ├── config.py          # Configuration management
│   │   ├── database.py        # Oracle connection pool
│   │   └── main.py            # FastAPI application
│   ├── sql/
│   │   └── schema.sql         # Complete Oracle DDL
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── pages/             # Page components
│   │   ├── components/        # Reusable components
│   │   ├── services/          # API client functions
│   │   ├── stores/            # Zustand state stores
│   │   ├── types/             # TypeScript type definitions
│   │   ├── hooks/             # Custom React hooks
│   │   └── utils/             # Utility functions
│   ├── package.json
│   ├── tailwind.config.ts     # ContractLens design system
│   └── Dockerfile
├── docker-compose.yml
├── .env.example
└── README.md
```

## Development Phases

### Phase 1 — Foundation ✓ COMPLETE

- Database schema and connection pool
- Authentication and authorization
- Workflow state machine
- Audit logging
- Frontend shell with routing

### Phase 2 — Upload & Tagging (Next)

- File upload to OCI Object Storage
- Document parsing (PDF/DOCX)
- AI tag suggestion with Llama 3.3 70B
- Tag confirmation UI

### Phase 3 — Extraction & Review

- Parameter extraction (9 semantic groups)
- Grounding and evidence resolution
- Validation rules
- Three-panel review workspace
- PDF.js with bounding box highlighting

### Phase 4 — Approval & Publication

- Approval workflow
- Draft → Published promotion
- Embedding generation
- Audit trail

### Phase 5 — AI Assistant

- Vector search on published corpus
- Evidence-backed answer synthesis
- Citation panel with PDF jump

### Phase 6 — Optimization & Polish

- Performance tuning
- Analytics dashboard
- Risk analysis features

## API Endpoints

### Authentication
- `POST /auth/register` — Register new user (admin only)
- `POST /auth/login` — Login and get tokens
- `POST /auth/refresh` — Refresh access token
- `POST /auth/logout` — Logout and revoke token
- `GET /auth/me` — Get current user info

### Contracts (Phase 2+)
- `GET /contracts` — List contracts
- `GET /contracts/{id}` — Get contract details
- `DELETE /contracts/{id}` — Delete contract (admin only)

### Upload (Phase 2+)
- `POST /upload` — Upload contract file
- `GET /upload/{id}/tags/suggest` — Get AI tag suggestions

### Extraction (Phase 3+)
- `POST /extraction/{id}/start` — Start extraction pipeline
- `GET /extraction/{id}/status` — Get extraction status

### Review (Phase 3+)
- `GET /review/{id}/parameters` — Get draft parameters
- `PUT /review/{id}/parameters/{param_id}` — Update parameter

### Approval (Phase 4+)
- `POST /approval/{id}/submit` — Submit for approval
- `POST /approval/{id}/approve` — Approve contract
- `POST /approval/{id}/reject` — Reject contract

### Assistant (Phase 5+)
- `POST /assistant/query` — Query AI assistant

### Audit
- `GET /audit/logs` — Query audit logs
- `GET /audit/contracts/{id}` — Get contract audit trail
- `GET /audit/users/{id}` — Get user activity

## Security

- All passwords hashed with bcrypt (12 rounds)
- JWT tokens with 15-minute access token expiry
- Refresh tokens with 7-day expiry
- Role-based access control enforced on backend
- All data encrypted at rest (AES-256) and in transit (TLS 1.3)
- Audit logging for all sensitive operations

## Critical Rules

1. **Extraction output must be structured JSON** — Never parse free text
2. **Grounding is mandatory** — No parameter without evidence
3. **Draft and published data never mix** — Separate tables, separate queries
4. **Workflow transitions are centralized** — All state changes through WorkflowService
5. **Every audit event is written** — No silent state changes
6. **BBoxOverlay uses normalized coordinates** — 0-1 scale, scaled at render time
7. **Groq retry logic is centralized** — All calls through groq_client.py
8. **No frontend role gating without backend enforcement** — Security on backend

## License

Confidential — Internal Use Only

## Support

For issues or questions, contact the Plexus development team.
