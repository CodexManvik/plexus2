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
        
        # Build context from parameters (P0)
        context_parts = []
        for param in relevant_parameters[:10]:  # Limit to top 10
            context_parts.append(
                f"ParamID: {param['pub_param_id']}\n"
                f"    Contract: {param.get('contract_name', 'Unknown')}\n"
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
 1. Answer the question directly and concisely.
 2. Base your answer strictly on the provided facts under RELEVANT CONTRACT INFORMATION. Do not extrapolate, assume, or make claims not supported by the verbatim text.
 3. If the provided context is insufficient or does not contain direct answers to the question, you MUST return exactly:
    "answer": "Insufficient evidence to answer this question from the published contracts."
    with empty citations and a confidence of 0.0.
 4. For each fact or parameter value cited in your answer, you MUST link it deterministically to its "pub_param_id" under RELEVANT CONTRACT INFORMATION.
 
 Return ONLY a JSON object:
 {{
   "answer": "your direct answer here",
   "citations": [
     {{
       "pub_param_id": "...",
       "evidence_text": "verbatim text fragment used as evidence"
     }}
   ],
   "confidence": 0.0-1.0
 }}"""
        
        try:
            response = groq_client.call(
                model=settings.groq_model_heavy,
                messages=[
                    {"role": "system", "content": "You are a contract intelligence assistant. Always return valid JSON. Base answers strictly on facts from the provided context. Never hallucinate or assume fields."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.1,  # Low temperature for factuality
                response_format={"type": "json_object"}
            )
            
            result = json.loads(response)
            
            # Enhance citations with full details using pub_param_id (P0 Citation correctness)
            enhanced_citations = []
            for citation in result.get('citations', []):
                pub_param_id = citation.get('pub_param_id')
                if not pub_param_id:
                    continue
                # Find matching parameter deterministically by pub_param_id
                matching = next(
                    (p for p in relevant_parameters if p.get('pub_param_id') == pub_param_id),
                    None
                )
                
                if matching:
                    enhanced_citations.append({
                        'contract_id': matching.get('contract_id'),
                        'contract_name': matching.get('contract_name', 'Unknown'),
                        'parameter_name': matching.get('parameter_name'),
                        'page_number': matching.get('page_number'),
                        'evidence_text': citation.get('evidence_text') or matching.get('supporting_text'),
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
