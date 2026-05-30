/**
 * Parameter extraction and grounding type definitions.
 */

export type ValidationStatus =
  | 'VALID'
  | 'NEEDS_REVIEW'
  | 'INVALID'
  | 'MISSING'
  | 'AMBIGUOUS'
  | 'UNGROUNDED';

export type ReviewerStatus = 'PENDING' | 'ACCEPTED' | 'EDITED' | 'REJECTED';

export type MatchMethod = 'EXACT' | 'NORMALIZED' | 'FUZZY' | 'LLM_ALIGNED';

export interface DraftParameter {
  param_id: string;
  contract_id: string;
  parameter_name: string;
  parameter_group?: string;
  extracted_value?: string;
  supporting_text?: string;
  confidence?: number;
  validation_status: ValidationStatus;
  model_used?: string;
  extraction_ts?: string;
  edited_value?: string;
  edited_by?: string;
  edited_at?: string;
  reviewer_status?: ReviewerStatus;
  created_at: string;
  updated_at: string;
}

export interface GroundingRecord {
  grounding_id: string;
  param_id: string;
  block_id?: string;
  page_number?: number;
  bbox_x1?: number;
  bbox_y1?: number;
  bbox_x2?: number;
  bbox_y2?: number;
  source_text?: string;
  grounding_confidence?: number;
  match_method?: MatchMethod;
  created_at: string;
}

export interface BoundingBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
