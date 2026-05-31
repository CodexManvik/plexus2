"""
AI Assistant service.
PUBLISHED DATA ONLY — never query draft tables here.
Phase 5 implementation.
"""

from typing import List, Optional
from ..database import db_pool
from ..agents.assistant_agent import AssistantAgent
from ..utils.text_utils import normalize_text
import logging

logger = logging.getLogger(__name__)


class AssistantService:
    """
    AI Assistant for querying published contract corpus.
    
    CRITICAL: This service ONLY queries published_parameters.
    Draft data is never exposed to the assistant.
    """
    
    @staticmethod
    async def query(
        question: str,
        contract_ids: Optional[List[str]] = None,
        limit: int = 20
    ) -> dict:
        """
        Query the assistant with a question.
        
        Args:
            question: User's question
            contract_ids: Optional list of contract IDs to scope the query
            limit: Maximum number of parameters to retrieve
        
        Returns:
            Dict with answer and citations
        """
        # PUBLISHED DATA ONLY — never query draft tables here
        relevant_params = await AssistantService._search_published_parameters(
            question=question,
            contract_ids=contract_ids,
            limit=limit
        )
        
        if not relevant_params:
            return {
                'answer': "I couldn't find any relevant information in the published contracts.",
                'citations': [],
                'confidence': 0.0,
                'parameters_searched': 0
            }
        
        # Synthesize answer with citations
        import asyncio
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            AssistantAgent.synthesize_answer,
            question,
            relevant_params
        )
        result['parameters_searched'] = len(relevant_params)
        
        return result
    
    @staticmethod
    async def _search_published_parameters(
        question: str,
        contract_ids: Optional[List[str]],
        limit: int
    ) -> List[dict]:
        """
        Search published parameters using Native Oracle 26ai Vector Similarity,
        with strict workflow state filtering (PUBLISHED only).
        Falls back to keyword matching if vector search is unavailable or returns 0.
        """
        from ..services.embedding_service import EmbeddingService
        
        # 1. Attempt Vector Similarity Search (P0)
        query_vector = await EmbeddingService.embed_query(question)
        if query_vector is not None:
            try:
                # Oracle TO_VECTOR expects "[f1,f2,…]" format
                vec_str = "[" + ",".join(f"{v:.8f}" for v in query_vector) + "]"
                
                # Build vector query clauses
                where_clauses = ["c.workflow_state = 'PUBLISHED'"]
                params = {'limit': limit, 'query_vec': vec_str}
                
                if contract_ids:
                    placeholders = ','.join([f'HEXTORAW(:cid{i})' for i in range(len(contract_ids))])
                    where_clauses.append(f"p.contract_id IN ({placeholders})")
                    for i, cid in enumerate(contract_ids):
                        params[f'cid{i}'] = cid
                
                where_clause = " AND ".join(where_clauses)
                
                # Cosine distance native vector search
                vector_query = f"""
                    SELECT p.pub_param_id, p.contract_id, p.parameter_name, p.parameter_group,
                           p.final_value, p.supporting_text, p.confidence,
                           p.page_number, p.bbox_x1, p.bbox_y1, p.bbox_x2, p.bbox_y2,
                           c.original_filename, c.customer_name, c.contract_type,
                           VECTOR_DISTANCE(e.embedding_vector, TO_VECTOR(:query_vec), COSINE) AS distance
                    FROM published_embeddings e
                    JOIN published_parameters p ON e.pub_param_id = p.pub_param_id
                    JOIN contracts c ON p.contract_id = c.contract_id
                    WHERE {where_clause}
                    ORDER BY distance ASC
                    FETCH FIRST :limit ROWS ONLY
                """
                
                async with db_pool.get_connection() as conn:
                    async with conn.cursor() as cursor:
                        await cursor.execute(vector_query, params)
                        rows = await cursor.fetchall()
                        
                        results = []
                        for row in rows:
                            final_value = row[4]
                            supporting_text = row[5]
                            if hasattr(final_value, 'read'):
                                final_value = await final_value.read()
                            if hasattr(supporting_text, 'read'):
                                supporting_text = await supporting_text.read()
                                
                            results.append({
                                'pub_param_id': row[0],
                                'contract_id': row[1],
                                'parameter_name': row[2],
                                'parameter_group': row[3],
                                'final_value': final_value,
                                'supporting_text': supporting_text,
                                'confidence': float(row[6]) if row[6] else 0.0,
                                'page_number': row[7],
                                'bbox_x1': float(row[8]) if row[8] else None,
                                'bbox_y1': float(row[9]) if row[9] else None,
                                'bbox_x2': float(row[10]) if row[10] else None,
                                'bbox_y2': float(row[11]) if row[11] else None,
                                'contract_name': row[12],
                                'customer_name': row[13],
                                'contract_type': row[14],
                                'distance': float(row[15]) if row[15] is not None else 0.0
                            })
                            
                        if results:
                            # Assistant Retrieval Logging (P0)
                            logger.info(
                                f"🔍 [Vector Search] query: '{question}', top_k: {limit}, matches found: {len(results)}"
                            )
                            for idx, r in enumerate(results):
                                logger.info(
                                    f"    [{idx+1}] pub_param_id: {r['pub_param_id']}, contract_id: {r['contract_id']}, "
                                    f"distance: {r['distance']:.4f}, param: '{r['parameter_name']}'"
                                )
                            return results
                            
            except Exception as vector_err:
                logger.error(f"❌ Oracle Native Vector Search failed, falling back to keywords: {vector_err}")

        # 2. Fallback Keyword Search (P0)
        logger.info("ℹ Falling back to keyword search for assistant query.")
        norm_question = normalize_text(question)
        keywords = norm_question.split()[:5]  # Top 5 keywords
        
        where_clauses = ["c.workflow_state = 'PUBLISHED'"]
        params = {'limit': limit}
        
        if contract_ids:
            placeholders = ','.join([f'HEXTORAW(:cid{i})' for i in range(len(contract_ids))])
            where_clauses.append(f"p.contract_id IN ({placeholders})")
            for i, cid in enumerate(contract_ids):
                params[f'cid{i}'] = cid
        
        keyword_conditions = []
        for i, keyword in enumerate(keywords):
            keyword_conditions.append(
                f"(LOWER(p.parameter_name) LIKE :kw{i} OR LOWER(p.final_value) LIKE :kw{i} OR LOWER(p.supporting_text) LIKE :kw{i})"
            )
            params[f'kw{i}'] = f'%{keyword}%'
        
        if keyword_conditions:
            where_clauses.append(f"({' OR '.join(keyword_conditions)})")
        
        where_clause = " AND ".join(where_clauses)
        
        query = f"""
            SELECT p.pub_param_id, p.contract_id, p.parameter_name, p.parameter_group,
                   p.final_value, p.supporting_text, p.confidence,
                   p.page_number, p.bbox_x1, p.bbox_y1, p.bbox_x2, p.bbox_y2,
                   c.original_filename, c.customer_name, c.contract_type
            FROM published_parameters p
            JOIN contracts c ON p.contract_id = c.contract_id
            WHERE {where_clause}
            ORDER BY p.confidence DESC
            FETCH FIRST :limit ROWS ONLY
        """
        
        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(query, params)
                rows = await cursor.fetchall()
                
                results = []
                for row in rows:
                    final_value = row[4]
                    supporting_text = row[5]
                    if hasattr(final_value, 'read'):
                        final_value = await final_value.read()
                    if hasattr(supporting_text, 'read'):
                        supporting_text = await supporting_text.read()
                        
                    results.append({
                        'pub_param_id': row[0],
                        'contract_id': row[1],
                        'parameter_name': row[2],
                        'parameter_group': row[3],
                        'final_value': final_value,
                        'supporting_text': supporting_text,
                        'confidence': float(row[6]) if row[6] else 0.0,
                        'page_number': row[7],
                        'bbox_x1': float(row[8]) if row[8] else None,
                        'bbox_y1': float(row[9]) if row[9] else None,
                        'bbox_x2': float(row[10]) if row[10] else None,
                        'bbox_y2': float(row[11]) if row[11] else None,
                        'contract_name': row[12],
                        'customer_name': row[13],
                        'contract_type': row[14]
                    })
                return results
    
    @staticmethod
    async def get_published_contracts() -> List[dict]:
        """Get list of all published contracts for scope selection."""
        query = """
            SELECT contract_id, original_filename, customer_name, contract_type,
                   published_at
            FROM contracts
            WHERE workflow_state = 'PUBLISHED'
            ORDER BY published_at DESC
        """
        
        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(query)
                rows = await cursor.fetchall()
                
                return [
                    {
                        'contract_id': row[0],
                        'filename': row[1],
                        'customer_name': row[2],
                        'contract_type': row[3],
                        'published_at': row[4]
                    }
                    for row in rows
                ]
