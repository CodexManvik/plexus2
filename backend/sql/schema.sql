-- PLEXUS Contract Intelligence Platform
-- Oracle 26ai Database Schema
-- Version 1.0

-- Clean up all existing tables and their constraints
DROP TABLE draft_tag_suggestions CASCADE CONSTRAINTS;
DROP TABLE draft_grounding_records CASCADE CONSTRAINTS;
DROP TABLE draft_parameters CASCADE CONSTRAINTS;
DROP TABLE published_parameters CASCADE CONSTRAINTS;
DROP TABLE document_blocks CASCADE CONSTRAINTS;
DROP TABLE contracts CASCADE CONSTRAINTS;
DROP TABLE refresh_tokens CASCADE CONSTRAINTS;
DROP TABLE users CASCADE CONSTRAINTS;

-- Clear out structural trash from recycling bin
PURGE RECYCLEBIN;

-- ============================================================================
-- AUTH TABLES
-- ============================================================================

CREATE TABLE users (
    user_id       RAW(16) DEFAULT SYS_GUID() PRIMARY KEY,
    email         VARCHAR2(255) NOT NULL UNIQUE,
    password_hash VARCHAR2(255) NOT NULL,
    full_name     VARCHAR2(255) NOT NULL,
    role          VARCHAR2(50) NOT NULL CHECK (role IN ('admin','operation_head','operation_user')),
    is_active     NUMBER(1) DEFAULT 1,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

CREATE TABLE refresh_tokens (
    token_id    RAW(16) DEFAULT SYS_GUID() PRIMARY KEY,
    user_id     RAW(16) NOT NULL REFERENCES users(user_id),
    token_hash  VARCHAR2(255) NOT NULL,
    expires_at  TIMESTAMP NOT NULL,
    revoked     NUMBER(1) DEFAULT 0,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);

-- ============================================================================
-- CONTRACT CORE
-- ============================================================================

CREATE TABLE contracts (
    contract_id       RAW(16) DEFAULT SYS_GUID() PRIMARY KEY,
    -- Upload metadata
    organization      VARCHAR2(255),
    business_unit     VARCHAR2(255),
    location          VARCHAR2(255),
    department        VARCHAR2(255),
    customer_name     VARCHAR2(255),
    financial_year    VARCHAR2(20),
    contract_type     VARCHAR2(100),
    agreement_type    VARCHAR2(100),
    additional_info   CLOB,
    -- File info
    original_filename VARCHAR2(500) NOT NULL,
    file_size_bytes   NUMBER,
    file_checksum     VARCHAR2(64),
    oci_object_key    VARCHAR2(1000) NOT NULL,
    mime_type         VARCHAR2(100),
    page_count        NUMBER,
    -- Workflow
    workflow_state    VARCHAR2(50) DEFAULT 'UPLOADED'
                      CHECK (workflow_state IN (
                        'UPLOADED','PARSING','TAG_SUGGESTION_READY',
                        'EXTRACTION_RUNNING','GROUNDING_RUNNING','VALIDATION_RUNNING',
                        'DRAFT_READY','USER_EDITING','PAUSED','REVIEW_PENDING',
                        'APPROVED','PUBLISHED','REJECTED','ARCHIVED'
                      )),
    -- Ownership
    uploaded_by       RAW(16) REFERENCES users(user_id),
    reviewed_by       RAW(16) REFERENCES users(user_id),
    approved_by       RAW(16) REFERENCES users(user_id),
    -- Timestamps
    uploaded_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    approved_at       TIMESTAMP,
    published_at      TIMESTAMP,
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_contracts_workflow ON contracts(workflow_state);
CREATE INDEX idx_contracts_uploaded_by ON contracts(uploaded_by);
CREATE INDEX idx_contracts_type ON contracts(contract_type);
CREATE INDEX idx_contracts_dept ON contracts(department);
CREATE INDEX idx_contracts_fy ON contracts(financial_year);

-- ============================================================================
-- CANONICAL BLOCKS (source of truth for positions)
-- ============================================================================

CREATE TABLE document_blocks (
    block_id        RAW(16) DEFAULT SYS_GUID() PRIMARY KEY,
    contract_id     RAW(16) NOT NULL REFERENCES contracts(contract_id),
    page_number     NUMBER NOT NULL,
    block_type      VARCHAR2(50) CHECK (block_type IN (
                      'paragraph','heading','table_row','list_item','signature_region','annotation'
                    )),
    raw_text        CLOB,
    normalized_text CLOB,
    bbox_x1         NUMBER,  -- normalized 0-1
    bbox_y1         NUMBER,
    bbox_x2         NUMBER,
    bbox_y2         NUMBER,
    section_heading VARCHAR2(1000),
    table_context   VARCHAR2(500),
    block_order     NUMBER,  -- position within page
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_blocks_contract ON document_blocks(contract_id);
CREATE INDEX idx_blocks_page ON document_blocks(contract_id, page_number);

-- ============================================================================
-- DRAFT TABLES
-- ============================================================================

CREATE TABLE draft_parameters (
    param_id           RAW(16) DEFAULT SYS_GUID() PRIMARY KEY,
    contract_id        RAW(16) NOT NULL REFERENCES contracts(contract_id),
    parameter_name     VARCHAR2(255) NOT NULL,
    parameter_group    VARCHAR2(100),
    extracted_value    CLOB,
    supporting_text    CLOB,
    confidence         NUMBER(5,4),
    validation_status  VARCHAR2(20) DEFAULT 'NEEDS_REVIEW'
                       CHECK (validation_status IN ('VALID','NEEDS_REVIEW','INVALID','MISSING','AMBIGUOUS','UNGROUNDED')),
    model_used         VARCHAR2(100),
    extraction_ts      TIMESTAMP,
    -- Human edit
    edited_value       CLOB,
    edited_by          RAW(16) REFERENCES users(user_id),
    edited_at          TIMESTAMP,
    reviewer_status    VARCHAR2(20) CHECK (reviewer_status IN ('PENDING','ACCEPTED','EDITED','REJECTED')),
    created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_draft_params_contract ON draft_parameters(contract_id);
CREATE INDEX idx_draft_params_status ON draft_parameters(validation_status);
CREATE INDEX idx_draft_params_group ON draft_parameters(parameter_group);

CREATE TABLE draft_grounding_records (
    grounding_id        RAW(16) DEFAULT SYS_GUID() PRIMARY KEY,
    param_id            RAW(16) NOT NULL REFERENCES draft_parameters(param_id),
    block_id            RAW(16) REFERENCES document_blocks(block_id),
    page_number         NUMBER,
    bbox_x1             NUMBER,
    bbox_y1             NUMBER,
    bbox_x2             NUMBER,
    bbox_y2             NUMBER,
    source_text         CLOB,
    grounding_confidence NUMBER(5,4),
    match_method        VARCHAR2(20) CHECK (match_method IN ('EXACT','NORMALIZED','FUZZY','LLM_ALIGNED')),
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_draft_grounding_param ON draft_grounding_records(param_id);
CREATE INDEX idx_draft_grounding_block ON draft_grounding_records(block_id);

CREATE TABLE draft_tag_suggestions (
    suggestion_id   RAW(16) DEFAULT SYS_GUID() PRIMARY KEY,
    contract_id     RAW(16) NOT NULL REFERENCES contracts(contract_id),
    field_name      VARCHAR2(100),
    suggested_value VARCHAR2(500),
    confidence      NUMBER(5,4),
    rationale       CLOB,
    evidence_text   CLOB,
    accepted        NUMBER(1),
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_draft_tags_contract ON draft_tag_suggestions(contract_id);

-- ============================================================================
-- PUBLISHED TABLES
-- ============================================================================

CREATE TABLE published_parameters (
    pub_param_id    RAW(16) DEFAULT SYS_GUID() PRIMARY KEY,
    contract_id     RAW(16) NOT NULL REFERENCES contracts(contract_id),
    param_id        RAW(16) REFERENCES draft_parameters(param_id),
    parameter_name  VARCHAR2(255) NOT NULL,
    parameter_group VARCHAR2(100),
    final_value     CLOB,
    supporting_text CLOB,
    confidence      NUMBER(5,4),
    page_number     NUMBER,
    bbox_x1         NUMBER,
    bbox_y1         NUMBER,
    bbox_x2         NUMBER,
    bbox_y2         NUMBER,
    published_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_pub_params_contract ON published_parameters(contract_id);
CREATE INDEX idx_pub_params_name ON published_parameters(parameter_name);

-- ============================================================================
-- WORKFLOW & AUDIT
-- ============================================================================

CREATE TABLE workflow_transitions (
    transition_id   RAW(16) DEFAULT SYS_GUID() PRIMARY KEY,
    contract_id     RAW(16) NOT NULL REFERENCES contracts(contract_id),
    from_state      VARCHAR2(50),
    to_state        VARCHAR2(50),
    triggered_by    RAW(16) REFERENCES users(user_id),
    reason          CLOB,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_transitions_contract ON workflow_transitions(contract_id);
CREATE INDEX idx_transitions_user ON workflow_transitions(triggered_by);

CREATE TABLE review_sessions (
    session_id      RAW(16) DEFAULT SYS_GUID() PRIMARY KEY,
    contract_id     RAW(16) NOT NULL REFERENCES contracts(contract_id),
    user_id         RAW(16) NOT NULL REFERENCES users(user_id),
    last_param_id   RAW(16),
    scroll_position NUMBER,
    is_active       NUMBER(1) DEFAULT 1,
    last_saved_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sessions_contract ON review_sessions(contract_id);
CREATE INDEX idx_sessions_user ON review_sessions(user_id);

CREATE TABLE audit_log (
    log_id          RAW(16) DEFAULT SYS_GUID() PRIMARY KEY,
    contract_id     RAW(16) REFERENCES contracts(contract_id),
    user_id         RAW(16) REFERENCES users(user_id),
    action          VARCHAR2(100) NOT NULL,
    entity_type     VARCHAR2(100),
    entity_id       VARCHAR2(100),
    old_value       CLOB,
    new_value       CLOB,
    metadata        CLOB,  -- JSON blob for extra context
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_contract ON audit_log(contract_id);
CREATE INDEX idx_audit_user ON audit_log(user_id);
CREATE INDEX idx_audit_action ON audit_log(action);
CREATE INDEX idx_audit_created ON audit_log(created_at);

-- ============================================================================
-- VECTOR EMBEDDINGS (Oracle 26ai native)
-- ============================================================================

CREATE TABLE draft_embeddings (
    embedding_id       RAW(16) DEFAULT SYS_GUID() PRIMARY KEY,
    contract_id        RAW(16) NOT NULL REFERENCES contracts(contract_id),
    block_id           RAW(16) REFERENCES document_blocks(block_id),
    chunk_text         CLOB,
    embedding_vector   VECTOR,  -- Oracle 26ai native vector type
    embedding_model    VARCHAR2(100),
    embedding_dimension NUMBER,
    quantization_type  VARCHAR2(50),
    parser_version     VARCHAR2(50),
    chunking_version   VARCHAR2(50),
    created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_draft_emb_contract ON draft_embeddings(contract_id);

CREATE TABLE published_embeddings (
    embedding_id       RAW(16) DEFAULT SYS_GUID() PRIMARY KEY,
    contract_id        RAW(16) NOT NULL REFERENCES contracts(contract_id),
    pub_param_id       RAW(16) REFERENCES published_parameters(pub_param_id),
    chunk_text         CLOB,
    embedding_vector   VECTOR,
    embedding_model    VARCHAR2(100),
    embedding_dimension NUMBER,
    quantization_type  VARCHAR2(50),
    parser_version     VARCHAR2(50),
    chunking_version   VARCHAR2(50),
    created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_pub_emb_contract ON published_embeddings(contract_id);

-- ============================================================================
-- TRIGGERS FOR UPDATED_AT
-- ============================================================================

CREATE OR REPLACE TRIGGER trg_users_updated
BEFORE UPDATE ON users
FOR EACH ROW
BEGIN
    :NEW.updated_at := CURRENT_TIMESTAMP;
END;
/

CREATE OR REPLACE TRIGGER trg_contracts_updated
BEFORE UPDATE ON contracts
FOR EACH ROW
BEGIN
    :NEW.updated_at := CURRENT_TIMESTAMP;
END;
/

CREATE OR REPLACE TRIGGER trg_draft_params_updated
BEFORE UPDATE ON draft_parameters
FOR EACH ROW
BEGIN
    :NEW.updated_at := CURRENT_TIMESTAMP;
END;
/

-- ============================================================================
-- INITIAL SEED DATA (Admin User)
-- ============================================================================

-- Default admin user (password: Admin@123456)
-- Password hash generated with bcrypt rounds=12
INSERT INTO users (email, password_hash, full_name, role, is_active)
VALUES (
    'admin@plexus.local',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYqYqYqYqYq',  -- Replace with actual bcrypt hash
    'System Administrator',
    'admin',
    1
);

COMMIT;
