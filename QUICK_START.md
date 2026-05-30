# Plexus Quick Start Guide

## 🚀 Get Started in 5 Minutes

### Prerequisites
- Python 3.11+ with uv/pip
- Node.js 20+
- Oracle 26ai database (or Oracle XE for local dev)
- Groq API key
- Cohere API key

### 1. Clone and Setup

```bash
cd c:\Project\plexus2

# Copy environment file
copy .env.example .env

# Edit .env with your credentials:
# - Oracle connection details
# - Groq API key
# - Cohere API key
# - JWT secret (generate with: openssl rand -hex 32)
```

### 2. Database Setup

```bash
# Connect to Oracle and run schema
sqlplus username/password@localhost:1521/FREEPDB1 @backend/sql/schema.sql
```

### 3. Start Backend

```bash
# Backend is already running on http://localhost:8000
# If not, start it:
cd backend
..\.venv\Scripts\uvicorn.exe app.main:app --reload
```

### 4. Test the API

```bash
# Health check
curl http://localhost:8000/health

# Login (default admin)
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"admin@plexus.local\",\"password\":\"Admin@123456\"}"

# Save the access_token from response
```

### 5. Upload a Contract

```bash
# Upload PDF
curl -X POST http://localhost:8000/upload/ \
  -H "Authorization: Bearer <your_access_token>" \
  -F "file=@sample_contract.pdf" \
  -F "organization=Acme Corp" \
  -F "department=Legal"

# Response includes contract_id and tag suggestions
```

### 6. Extract Parameters

```bash
# Start extraction
curl -X POST http://localhost:8000/extraction/<contract_id>/start \
  -H "Authorization: Bearer <your_access_token>"

# This will:
# - Extract 50+ parameters
# - Ground evidence to source text
# - Validate parameters
# - Transition to DRAFT_READY
```

### 7. Review and Approve

```bash
# Get draft parameters
curl http://localhost:8000/review/<contract_id>/parameters \
  -H "Authorization: Bearer <your_access_token>"

# Submit for approval
curl -X POST http://localhost:8000/review/<contract_id>/submit \
  -H "Authorization: Bearer <your_access_token>"

# Approve (as Operation Head)
curl -X POST http://localhost:8000/approval/<contract_id>/approve \
  -H "Authorization: Bearer <your_access_token>" \
  -H "Content-Type: application/json" \
  -d "{\"comments\":\"Approved\"}"
```

### 8. Query AI Assistant

```bash
# Ask a question
curl -X POST http://localhost:8000/assistant/query \
  -H "Authorization: Bearer <your_access_token>" \
  -H "Content-Type: application/json" \
  -d "{\"question\":\"When does this contract expire?\"}"

# Response includes answer with citations
```

## 📚 API Documentation

Visit http://localhost:8000/docs for interactive API documentation (Swagger UI).

## 🔑 Default Credentials

- **Email**: admin@plexus.local
- **Password**: Admin@123456
- **Role**: admin

⚠️ **Change this password immediately in production!**

## 📊 What You Can Do

### As Admin
- Create users
- Manage roles
- Delete contracts
- View audit logs
- All operation user/head permissions

### As Operation Head
- Approve/reject contracts
- View all contracts
- Review parameters
- View audit logs
- All operation user permissions

### As Operation User
- Upload contracts
- Review tag suggestions
- Edit draft parameters
- Submit for approval
- Query AI assistant

## 🎯 Complete Workflow Example

```bash
# 1. Login
TOKEN=$(curl -s -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@plexus.local","password":"Admin@123456"}' \
  | jq -r '.access_token')

# 2. Upload contract
CONTRACT_ID=$(curl -s -X POST http://localhost:8000/upload/ \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@contract.pdf" \
  -F "organization=Acme Corp" \
  | jq -r '.contract_id')

# 3. Start extraction
curl -X POST http://localhost:8000/extraction/$CONTRACT_ID/start \
  -H "Authorization: Bearer $TOKEN"

# 4. Wait for extraction to complete (check status)
curl http://localhost:8000/extraction/$CONTRACT_ID/status \
  -H "Authorization: Bearer $TOKEN"

# 5. Review parameters
curl http://localhost:8000/review/$CONTRACT_ID/parameters \
  -H "Authorization: Bearer $TOKEN"

# 6. Submit for approval
curl -X POST http://localhost:8000/review/$CONTRACT_ID/submit \
  -H "Authorization: Bearer $TOKEN"

# 7. Approve
curl -X POST http://localhost:8000/approval/$CONTRACT_ID/approve \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"comments":"Approved"}'

# 8. Query assistant
curl -X POST http://localhost:8000/assistant/query \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"question":"What is the contract value?"}'
```

## 🐛 Troubleshooting

### Backend won't start
- Check .env file exists in root directory
- Verify Oracle connection details
- Ensure all API keys are valid
- Check Python dependencies installed

### Database connection fails
- Verify Oracle is running
- Check DSN format: `hostname:port/servicename`
- Test connection with sqlplus

### Extraction fails
- Check Groq API key is valid
- Verify Groq API quota
- Check document is valid PDF/DOCX

### No tag suggestions
- Ensure document has text content
- Check Groq API is accessible
- Verify first page has meaningful content

## 📖 Documentation

- `README.md` — Complete setup guide
- `ALL_PHASES_COMPLETE.md` — Feature list and architecture
- `PHASE1_VERIFICATION.md` — Phase 1 testing
- `PHASE2_COMPLETE.md` — Phase 2 details
- API Docs: http://localhost:8000/docs

## 🆘 Support

For issues or questions:
1. Check the documentation
2. Review audit logs: `GET /audit/logs`
3. Check backend logs in terminal
4. Verify workflow state: `GET /contracts/{id}`

## 🎉 You're Ready!

Plexus is now running and ready to process contracts. Upload your first contract and watch the AI extract structured data with evidence-backed citations!
