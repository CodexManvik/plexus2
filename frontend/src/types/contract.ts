/**
 * Contract and workflow type definitions.
 */

export type WorkflowState =
  | 'UPLOADED'
  | 'PARSING'
  | 'TAG_SUGGESTION_READY'
  | 'EXTRACTION_RUNNING'
  | 'GROUNDING_RUNNING'
  | 'VALIDATION_RUNNING'
  | 'DRAFT_READY'
  | 'USER_EDITING'
  | 'PAUSED'
  | 'REVIEW_PENDING'
  | 'APPROVED'
  | 'PUBLISHED'
  | 'REJECTED'
  | 'ARCHIVED';

export interface Contract {
  contract_id: string;
  organization?: string;
  business_unit?: string;
  location?: string;
  department?: string;
  customer_name?: string;
  financial_year?: string;
  contract_type?: string;
  agreement_type?: string;
  additional_info?: string;
  original_filename: string;
  file_size_bytes?: number;
  file_checksum?: string;
  oci_object_key: string;
  mime_type?: string;
  page_count?: number;
  workflow_state: WorkflowState;
  uploaded_by?: string;
  reviewed_by?: string;
  approved_by?: string;
  uploaded_at: string;
  approved_at?: string;
  published_at?: string;
  created_at: string;
  updated_at: string;
}

export interface TagSuggestion {
  suggestion_id: string;
  contract_id: string;
  field_name: string;
  suggested_value: string;
  confidence: number;
  rationale?: string;
  evidence_text?: string;
  accepted?: boolean;
  created_at: string;
}
