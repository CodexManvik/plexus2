"""
Processing queue status routes.

Provides a lightweight polling endpoint so the frontend can render a live
job queue without requiring a persistent WebSocket connection.

GET /queue/jobs
  Returns all contracts currently in an active pipeline state, plus any
  contracts that completed/failed in the last 24 hours.
  The frontend polls this every 3 seconds to render the queue panel.

Response schema (per job):
  {
    "contract_id":     str,
    "filename":        str,
    "workflow_state":  str,   -- EXTRACTION_RUNNING | DRAFT_READY | EXTRACTION_FAILED | ...
    "customer_name":   str | null,
    "contract_type":   str | null,
    "uploaded_at":     datetime,
    "blocks_created":  int | null,  -- from document_blocks count
  }
"""

from fastapi import APIRouter, HTTPException, status, Depends, Query
from ..auth.dependencies import get_current_user
from ..database import db_pool
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/queue", tags=["Queue"])

# States that are considered "in-flight" or recently finished (show in queue)
_ACTIVE_STATES = (
    'UPLOADED', 'PARSING', 'TAG_SUGGESTION_READY',
    'EXTRACTION_RUNNING', 'GROUNDING_RUNNING', 'VALIDATION_RUNNING',
    'DRAFT_READY', 'EXTRACTION_FAILED',
)


@router.get("/jobs")
async def get_queue_jobs(
    hours: int = Query(24, ge=1, le=168, description="How many hours back to include finished jobs"),
    current_user: dict = Depends(get_current_user),
):
    """
    Return all contracts that are actively processing or finished within
    the last `hours` hours.  Sorted newest-first.
    """
    try:
        state_placeholders = ", ".join(f":s{i}" for i in range(len(_ACTIVE_STATES)))
        params: dict = {f"s{i}": s for i, s in enumerate(_ACTIVE_STATES)}
        params["hours"] = hours

        query = f"""
            SELECT
                RAWTOHEX(c.contract_id)  AS contract_id,
                c.original_filename      AS filename,
                c.workflow_state,
                c.customer_name,
                c.contract_type,
                c.uploaded_at,
                c.page_count,
                (
                    SELECT COUNT(*)
                    FROM document_blocks db
                    WHERE db.contract_id = c.contract_id
                ) AS blocks_count
            FROM contracts c
            WHERE
                c.workflow_state IN ({state_placeholders})
                AND c.uploaded_at >= SYSDATE - (:hours / 24)
            ORDER BY c.uploaded_at DESC
            FETCH FIRST 100 ROWS ONLY
        """

        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(query, params)
                rows = await cursor.fetchall()

        jobs = [
            {
                "contract_id":    row[0],
                "filename":       row[1],
                "workflow_state": row[2],
                "customer_name":  row[3],
                "contract_type":  row[4],
                "uploaded_at":    row[5].isoformat() if row[5] else None,
                "page_count":     row[6],
                "blocks_count":   row[7],
            }
            for row in rows
        ]

        # Summarise counts for the header badges
        summary = {
            "total":      len(jobs),
            "processing": sum(
                1 for j in jobs
                if j["workflow_state"] not in ("DRAFT_READY", "EXTRACTION_FAILED")
            ),
            "done":       sum(1 for j in jobs if j["workflow_state"] == "DRAFT_READY"),
            "failed":     sum(1 for j in jobs if j["workflow_state"] == "EXTRACTION_FAILED"),
        }

        return {"jobs": jobs, "summary": summary}

    except Exception as exc:
        logger.error(f"Failed to fetch queue jobs: {exc}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch queue jobs: {str(exc)}"
        )
