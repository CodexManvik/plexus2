"""
Tagging agent for AI-suggested contract metadata.
Uses Groq Llama 3.3 70B for semantic classification.
Phase 2 implementation.
"""

import json
from typing import Dict, List
from ..utils.groq_client import groq_client
from ..config import settings
import logging

logger = logging.getLogger(__name__)


class TaggingAgent:
    """AI agent for suggesting contract metadata tags."""
    
    # Master data from PRD
    CONTRACT_TYPES = {
        "Commercial & Business": [
            "Sale Agreement", "Purchase Agreement", "Distribution Agreement",
            "Franchise Agreement", "Joint Venture Agreement", "Shareholders Agreement", "NDA"
        ],
        "Employment & HR": [
            "Employment Agreement", "Consultancy Agreement", "Non-Compete Agreement",
            "Freelance Agreement", "Apprenticeship Contract"
        ],
        "Banking & Finance": [
            "Loan Agreement", "Credit Facility Agreement", "Security Agreement",
            "Guarantee Agreement", "Lease Financing Agreement"
        ],
        "Real Estate & Infrastructure": [
            "Sale Deed", "Lease Agreement", "Leave & License Agreement",
            "Construction Contract", "Development Agreement"
        ],
        "Technology & IT": [
            "Software License Agreement", "SaaS Agreement", "SLA",
            "Data Processing Agreement", "IT Outsourcing Contract"
        ],
        "Intellectual Property": [
            "Licensing Agreement", "Assignment Agreement", "Royalty Agreement",
            "Trademark/Patent Licensing"
        ],
        "Insurance": [
            "Life Insurance Policy", "General Insurance Contract", "Reinsurance Agreement"
        ],
        "Construction & EPC": [
            "EPC Contract", "Turnkey Contract", "Subcontracting Agreement"
        ],
        "International Trade": [
            "Import/Export Agreement", "Shipping Contract", "Letter of Credit",
            "Incoterms-based Agreements"
        ]
    }
    
    @staticmethod
    def suggest_tags(document_text: str, filename: str) -> List[Dict]:
        """
        Suggest contract metadata tags using AI.
        
        Args:
            document_text: First page or excerpt of document
            filename: Original filename
        
        Returns:
            List of tag suggestions with confidence and rationale
        """
        # Prepare contract types for prompt
        contract_types_str = "\n".join([
            f"- {ct}: {', '.join(ats)}"
            for ct, ats in TaggingAgent.CONTRACT_TYPES.items()
        ])
        
        prompt = f"""You are a contract analysis expert. Analyze this contract excerpt and suggest metadata tags.

CONTRACT TYPES AND AGREEMENT TYPES:
{contract_types_str}

DOCUMENT FILENAME: {filename}

DOCUMENT EXCERPT (first page):
{document_text[:3000]}

Analyze the document and provide suggestions for these fields:
1. contract_type (choose from the list above)
2. agreement_type (choose from the sub-types under the contract_type)
3. department (e.g., Legal, Finance, Procurement, HR, IT, Operations)
4. customer_name (counterparty name if mentioned)

Return ONLY a JSON object with this structure:
{{
  "suggestions": [
    {{
      "field_name": "contract_type",
      "suggested_value": "...",
      "confidence": 0.0-1.0,
      "rationale": "brief explanation",
      "evidence_text": "relevant excerpt from document"
    }},
    ...
  ]
}}

Be conservative with confidence scores. Only use >0.8 if you're very certain."""
        
        try:
            response = groq_client.call(
                model=settings.groq_model_heavy,
                messages=[
                    {"role": "system", "content": "You are a contract metadata extraction expert. Always return valid JSON."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.5,
                response_format={"type": "json_object"}
            )
            
            # Parse response
            result = json.loads(response)
            suggestions = result.get('suggestions', [])
            
            logger.info(f"Generated {len(suggestions)} tag suggestions")
            return suggestions
        
        except Exception as e:
            logger.error(f"Tag suggestion failed: {e}")
            # Return empty suggestions on failure
            return []
    
    @staticmethod
    def get_agreement_types_for_contract_type(contract_type: str) -> List[str]:
        """Get valid agreement types for a contract type."""
        return TaggingAgent.CONTRACT_TYPES.get(contract_type, [])
