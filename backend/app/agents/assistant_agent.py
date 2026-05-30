"""
Assistant agent for answering queries with citations.
Uses Groq Llama 3.3 70B for evidence-backed synthesis.
Phase 5 implementation.
"""

import json
from typing import List, Dict
from ..utils.groq_client import groq_client
from ..config import settings
import logging

logger = logging.getLogger(__name__)


class AssistantAgent:
    """AI assistant for querying published contract corpus."""
    
    @staticmethod
    def synthesize_answer(question: str, relevant_parameters: List[Dict]) -> Dict:
        """
        Synthesize answer from relevant parameters with citations.
        
        Args:
            question: User's question
            relevant_parameters: List of relevant published parameters
        
        Returns:
            Dict with answer and citations
        """
        if not relevant_parameters:
            return {
                'answer': "I couldn't find any relevant information in the published contracts to answer your question.",
                'citations': [],
                'confidence': 0.0
            }
        
        # Build context from parameters
        context_parts = []
        for i, param in enumerate(relevant_parameters[:10]):  # Limit to top 10
            context_parts.append(
                f"[{i+1}] Contract: {param.get('contract_name', 'Unknown')}\n"
                f"    Parameter: {param['parameter_name']}\n"
                f"    Value: {param['final_value']}\n"
                f"    Evidence: {param.get('supporting_text', 'N/A')}\n"
                f"    Page: {param.get('page_number', 'N/A')}"
            )
        
        context = "\n\n".join(context_parts)
        
        prompt = f"""You are a contract intelligence assistant. Answer the user's question based ONLY on the provided contract information.

QUESTION: {question}

RELEVANT CONTRACT INFORMATION:
{context}

Instructions:
1. Answer the question directly and concisely
2. Base your answer ONLY on the provided information
3. Cite specific contracts and page numbers
4. If the information is insufficient, say so
5. Do not make assumptions or add information not in the context

Return ONLY a JSON object:
{{
  "answer": "your answer here",
  "citations": [
    {{
      "contract_name": "...",
      "parameter_name": "...",
      "page_number": 1,
      "evidence_text": "..."
    }}
  ],
  "confidence": 0.0-1.0
}}"""
        
        try:
            response = groq_client.call(
                model=settings.groq_model_heavy,
                messages=[
                    {"role": "system", "content": "You are a contract intelligence assistant. Always return valid JSON. Only use information from the provided context."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.2,
                response_format={"type": "json_object"}
            )
            
            result = json.loads(response)
            
            # Enhance citations with full details
            enhanced_citations = []
            for citation in result.get('citations', []):
                # Find matching parameter
                matching = next(
                    (p for p in relevant_parameters 
                     if p.get('parameter_name') == citation.get('parameter_name')),
                    None
                )
                
                if matching:
                    enhanced_citations.append({
                        'contract_id': matching.get('contract_id'),
                        'contract_name': matching.get('contract_name', 'Unknown'),
                        'parameter_name': citation.get('parameter_name'),
                        'page_number': citation.get('page_number') or matching.get('page_number'),
                        'evidence_text': citation.get('evidence_text'),
                        'bbox': {
                            'x1': matching.get('bbox_x1'),
                            'y1': matching.get('bbox_y1'),
                            'x2': matching.get('bbox_x2'),
                            'y2': matching.get('bbox_y2')
                        }
                    })
            
            return {
                'answer': result.get('answer', 'Unable to generate answer'),
                'citations': enhanced_citations,
                'confidence': result.get('confidence', 0.5)
            }
        
        except Exception as e:
            logger.error(f"Answer synthesis failed: {e}")
            return {
                'answer': f"Error generating answer: {str(e)}",
                'citations': [],
                'confidence': 0.0
            }
