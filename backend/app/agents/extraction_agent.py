"""
Extraction agent for structured parameter extraction.
Uses Groq Llama 3.3 70B for complex legal reasoning.
Phase 3 implementation.
"""

import json
from typing import Dict, List
from ..utils.groq_client import groq_client
from ..config import settings
import logging

logger = logging.getLogger(__name__)


class ExtractionAgent:
    """AI agent for extracting structured parameters from contracts."""
    
    # Parameter groups from PRD Section 5
    PARAMETER_GROUPS = {
        "Batch 1: Metadata & Dates": [
            "Contract Title / Agreement Name",
            "Contract Type",
            "Contract Number / Reference ID",
            "Version / Amendment Number",
            "Effective Date",
            "Execution / Signing Date",
            "Start Date",
            "End Date / Expiry Date",
            "Renewal Terms"
        ],
        "Batch 2: Parties": [
            "Legal Names of Parties",
            "Registered Addresses",
            "CIN / Registration Numbers",
            "Authorized Signatories",
            "Contact Persons",
            "Roles",
            "Affiliates / Subsidiaries"
        ],
        "Batch 3: Scope & Deliverables": [
            "Description of Services / Deliverables",
            "Project Scope",
            "Deliverables List",
            "Quantity / Volume Commitments",
            "Performance Expectations",
            "Dependencies / Assumptions"
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
            "Escalation Clauses"
        ],
        "Batch 5: Legal & Compliance": [
            "Governing Law",
            "Jurisdiction / Dispute Venue",
            "Arbitration Clause",
            "Compliance Requirements",
            "Anti-Bribery / Anti-Corruption",
            "Data Protection & Privacy",
            "Confidentiality / NDA Terms",
            "Intellectual Property Rights"
        ],
        "Batch 6: Risk & Liability": [
            "Limitation of Liability",
            "Indemnification Clauses",
            "Warranty Terms",
            "Insurance Requirements",
            "Force Majeure Clause",
            "Risk Allocation",
            "Consequential Damages Exclusion"
        ],
        "Batch 7: Performance & Penalties": [
            "SLA Metrics",
            "KPIs / Service Benchmarks",
            "Penalties / Liquidated Damages",
            "Service Credits",
            "Bonus / Incentives",
            "Escalation Matrix"
        ],
        "Batch 8: Termination & Exit": [
            "Notice Period",
            "Termination Conditions",
            "Termination for Convenience",
            "Termination for Cause",
            "Breach Conditions",
            "Cure Period",
            "Exit Strategy / Transition Plan",
            "Post-Termination Obligations"
        ],
        "Batch 9: Data & Confidentiality": [
            "Confidential Information Definition",
            "Data Storage / Processing Locations",
            "Security Standards",
            "Data Breach Notification Timelines",
            "Subcontractor Data Access",
            "Data Retention Policy"
        ]
    }
    
    @staticmethod
    def extract_batch(batch_name: str, parameters: List[str], document_text: str) -> List[Dict]:
        """
        Extract a batch of related parameters.
        
        Args:
            batch_name: Name of the batch (e.g., "Batch 1: Metadata & Dates")
            parameters: List of parameter names to extract
            document_text: Full document text or relevant sections
        
        Returns:
            List of extracted parameters with values, confidence, and supporting text
        """
        # Build parameter list for prompt
        param_list = "\n".join([f"{i+1}. {p}" for i, p in enumerate(parameters)])
        
        prompt = f"""You are a contract analysis expert. Extract the following parameters from this contract.

PARAMETERS TO EXTRACT ({batch_name}):
{param_list}

CONTRACT TEXT:
{document_text[:8000]}

For each parameter, extract:
1. The value (or null if not found)
2. The exact supporting text from the contract (verbatim quote)
3. Your confidence (0.0-1.0)

Return ONLY a JSON object with this structure:
{{
  "parameters": [
    {{
      "parameter_name": "Contract Title / Agreement Name",
      "extracted_value": "value or null",
      "supporting_text": "verbatim quote from contract",
      "confidence": 0.0-1.0,
      "notes": "any relevant notes or null"
    }},
    ...
  ]
}}

IMPORTANT:
- If a parameter is not found, set extracted_value to null
- supporting_text must be a verbatim quote from the contract
- Be conservative with confidence scores
- For dates, use format: YYYY-MM-DD or as written in contract
- For lists, separate with semicolons"""
        
        try:
            response = groq_client.call(
                model=settings.groq_model_heavy,
                messages=[
                    {"role": "system", "content": "You are a contract parameter extraction expert. Always return valid JSON."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.5,
                max_tokens=4000,
                response_format={"type": "json_object"}
            )
            
            # Parse response
            result = json.loads(response)
            extracted_params = result.get('parameters', [])
            
            logger.info(f"Extracted {len(extracted_params)} parameters from {batch_name}")
            return extracted_params
        
        except Exception as e:
            logger.error(f"Extraction failed for {batch_name}: {e}")
            # Return empty parameters with MISSING status
            return [
                {
                    "parameter_name": param,
                    "extracted_value": None,
                    "supporting_text": None,
                    "confidence": 0.0,
                    "notes": f"Extraction failed: {str(e)}"
                }
                for param in parameters
            ]
    
    @staticmethod
    def get_all_batches() -> Dict[str, List[str]]:
        """Get all parameter batches."""
        return ExtractionAgent.PARAMETER_GROUPS
