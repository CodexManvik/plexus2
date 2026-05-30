"""
Embedding service — Cohere Embed v3 on published parameters.

Called once per contract after approval promotes to published_parameters.
Writes dense vectors to published_embeddings so the assistant can do
vector search instead of keyword matching.

Design notes:
  - Cohere embed-english-v3.0 outputs 1024-dimensional float vectors.
  - Oracle 26ai stores them natively in a VECTOR column.
  - We batch in groups of 96 (Cohere's max per request is 96 texts).
  - Each published parameter produces ONE embedding whose chunk_text is
    "{parameter_name}: {final_value}  {supporting_text[:500]}".
    This gives the model signal on both the label and the content.
  - Failures are logged but never propagate — a missing embedding is
    not a pipeline-breaking error; keyword search is the fallback.
"""

import uuid
import asyncio
import functools
from typing import List, Dict, Optional
import cohere
from ..database import db_pool
from ..config import settings
import logging

logger = logging.getLogger(__name__)

# Cohere embed batch size cap
_COHERE_BATCH = 96

# Input type for retrieval use-case (asymmetric search)
_INPUT_TYPE = "search_document"

# Embedding dimension for cohere embed-english-v3.0
_EMBED_DIM = 1024


class EmbeddingService:
    """
    Generates and persists Cohere embeddings for published contract parameters.

    Thread safety: Cohere's Python client is synchronous.  We use
    run_in_executor to keep the async event loop unblocked.
    """

    _cohere_client: Optional[cohere.Client] = None

    @classmethod
    def _get_client(cls) -> cohere.Client:
        if cls._cohere_client is None:
            cls._cohere_client = cohere.Client(api_key=settings.cohere_api_key)
        return cls._cohere_client

    # -------------------------------------------------------------------------
    # Public entry point
    # -------------------------------------------------------------------------

    @staticmethod
    async def generate_published_embeddings(contract_id: str) -> int:
        """
        Generate Cohere embeddings for all published parameters of a contract
        and store them in published_embeddings.

        Returns the number of embeddings successfully written.
        """
        params = await EmbeddingService._fetch_published_params(contract_id)

        if not params:
            logger.warning(f"No published parameters found for contract {contract_id}")
            return 0

        # Build chunk texts — label + value + supporting evidence
        chunks: List[Dict] = []
        for p in params:
            value   = str(p["final_value"]    or "").strip()
            support = str(p["supporting_text"] or "").strip()[:500]
            name    = str(p["parameter_name"] or "").strip()
            chunk_text = f"{name}: {value}"
            if support:
                chunk_text += f"  [{support}]"
            chunks.append({
                "pub_param_id": p["pub_param_id"],
                "chunk_text":   chunk_text,
            })

        # Embed in batches of _COHERE_BATCH
        total_written = 0
        for batch_start in range(0, len(chunks), _COHERE_BATCH):
            batch = chunks[batch_start : batch_start + _COHERE_BATCH]
            texts = [c["chunk_text"] for c in batch]

            vectors = await EmbeddingService._embed_batch(texts)

            if vectors is None:
                logger.error(
                    f"Cohere embed batch failed for contract {contract_id} "
                    f"(items {batch_start}–{batch_start + len(batch) - 1})"
                )
                continue

            written = await EmbeddingService._persist_batch(
                contract_id=contract_id,
                batch=batch,
                vectors=vectors,
            )
            total_written += written

        logger.info(
            f"Embeddings generated for contract {contract_id}: "
            f"{total_written}/{len(chunks)} written"
        )
        return total_written

    # -------------------------------------------------------------------------
    # Private helpers
    # -------------------------------------------------------------------------

    @staticmethod
    async def _fetch_published_params(contract_id: str) -> List[Dict]:
        """Retrieve pub_param_id + text fields for all published params."""
        query = """
            SELECT pub_param_id, parameter_name, final_value, supporting_text
            FROM published_parameters
            WHERE contract_id = HEXTORAW(:contract_id)
            ORDER BY parameter_group, parameter_name
        """
        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(query, {"contract_id": contract_id})
                rows = await cursor.fetchall()

                result = []
                for row in rows:
                    final_value    = row[2]
                    supporting_text = row[3]
                    if hasattr(final_value, "read"):
                        final_value = await final_value.read()
                    if hasattr(supporting_text, "read"):
                        supporting_text = await supporting_text.read()
                    result.append({
                        "pub_param_id":   row[0],
                        "parameter_name": row[1],
                        "final_value":    final_value,
                        "supporting_text": supporting_text,
                    })

        return result

    @staticmethod
    async def _embed_batch(texts: List[str]) -> Optional[List[List[float]]]:
        """
        Call Cohere Embed v3 synchronously inside a thread executor.

        Returns a list of float vectors or None on failure.
        """
        client = EmbeddingService._get_client()

        def _sync_embed() -> List[List[float]]:
            response = client.embed(
                texts=texts,
                model=settings.cohere_embed_model,
                input_type=_INPUT_TYPE,
            )
            return response.embeddings

        loop = asyncio.get_event_loop()
        try:
            return await loop.run_in_executor(
                None, functools.partial(_sync_embed)
            )
        except cohere.errors.TooManyRequestsError as exc:
            logger.warning(f"Cohere rate limit hit, retrying after 10s: {exc}")
            await asyncio.sleep(10)
            try:
                return await loop.run_in_executor(None, functools.partial(_sync_embed))
            except Exception as retry_exc:
                logger.error(f"Cohere embed retry failed: {retry_exc}")
                return None
        except Exception as exc:
            logger.error(f"Cohere embed call failed: {exc}")
            return None

    @staticmethod
    async def _persist_batch(
        contract_id: str,
        batch: List[Dict],
        vectors: List[List[float]],
    ) -> int:
        """
        Insert embedding rows into published_embeddings.

        Oracle 26ai VECTOR columns accept a JSON array string literal.
        We cast via TO_VECTOR(:vec_str) from a comma-separated float string.
        """
        insert_sql = """
            INSERT INTO published_embeddings (
                embedding_id, contract_id, pub_param_id,
                chunk_text, embedding_vector,
                embedding_model, embedding_dimension,
                quantization_type, parser_version, chunking_version
            ) VALUES (
                HEXTORAW(:embedding_id),
                HEXTORAW(:contract_id),
                HEXTORAW(:pub_param_id),
                :chunk_text,
                TO_VECTOR(:vec_str),
                :embedding_model,
                :embedding_dimension,
                'FLOAT32',
                '1.0',
                '1.0'
            )
        """

        written = 0
        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                for chunk, vector in zip(batch, vectors):
                    embedding_id = uuid.uuid4().hex.upper()
                    # Oracle TO_VECTOR expects "[f1,f2,…]" format
                    vec_str = "[" + ",".join(f"{v:.8f}" for v in vector) + "]"
                    try:
                        await cursor.execute(insert_sql, {
                            "embedding_id":      embedding_id,
                            "contract_id":       contract_id,
                            "pub_param_id":      chunk["pub_param_id"],
                            "chunk_text":        chunk["chunk_text"][:4000],
                            "vec_str":           vec_str,
                            "embedding_model":   settings.cohere_embed_model,
                            "embedding_dimension": _EMBED_DIM,
                        })
                        written += 1
                    except Exception as row_exc:
                        logger.error(
                            f"Failed to insert embedding for pub_param_id="
                            f"{chunk['pub_param_id']}: {row_exc}"
                        )
                await conn.commit()

        return written
