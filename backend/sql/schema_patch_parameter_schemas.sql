-- PLEXUS — Schema Patch: Parameter Schemas Table
-- Run this script once against the Oracle 26ai instance after deploying v1.1.

CREATE TABLE parameter_schemas (
    schema_id      RAW(16)       DEFAULT SYS_GUID()        PRIMARY KEY,
    name           VARCHAR2(255) NOT NULL,
    logic          VARCHAR2(500),
    contract_types VARCHAR2(500),
    category       VARCHAR2(50)  CHECK (category IN ('Commercial', 'Vendor', 'Internal')),
    priority       VARCHAR2(10)  CHECK (priority IN ('High', 'Med', 'Low')),
    created_by     RAW(16)       REFERENCES users(user_id),
    created_at     TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_parameter_schemas_category ON parameter_schemas(category);
CREATE INDEX idx_parameter_schemas_priority ON parameter_schemas(priority);
