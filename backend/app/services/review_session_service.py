"""
Review session service — persists and restores review progress.

The review_sessions table stores:
  - last_param_id:    the last parameter the user interacted with
  - scroll_position:  a scroll offset integer for the right pane
  - is_active:        1 while session is open; 0 after submit

Rules:
  - One active session per (contract_id, user_id) pair.
  - On save: MERGE (upsert) pattern — Oracle has no ON CONFLICT so we
    do UPDATE first, then INSERT if rowcount == 0.
  - Session is deactivated when the contract is submitted for approval.
"""

import uuid
from typing import Optional, Dict
from ..database import db_pool
import logging

logger = logging.getLogger(__name__)


class ReviewSessionService:

    @staticmethod
    async def save_session(
        contract_id: str,
        user_id: str,
        last_param_id: Optional[str],
        scroll_position: int,
    ) -> str:
        """
        Upsert the active review session for (contract_id, user_id).

        Returns the session_id.
        """
        # Try UPDATE first
        update_query = """
            UPDATE review_sessions
            SET last_param_id   = HEXTORAW(:last_param_id),
                scroll_position = :scroll_position,
                last_saved_at   = CURRENT_TIMESTAMP,
                is_active       = 1
            WHERE contract_id = HEXTORAW(:contract_id)
              AND user_id     = HEXTORAW(:user_id)
              AND is_active   = 1
        """

        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(update_query, {
                    "last_param_id":   last_param_id or "",
                    "scroll_position": scroll_position,
                    "contract_id":     contract_id,
                    "user_id":         user_id,
                })
                rows_updated = cursor.rowcount
                await conn.commit()

                if rows_updated > 0:
                    # Fetch the session_id we just updated
                    await cursor.execute(
                        """
                        SELECT RAWTOHEX(session_id)
                        FROM review_sessions
                        WHERE contract_id = HEXTORAW(:contract_id)
                          AND user_id     = HEXTORAW(:user_id)
                          AND is_active   = 1
                        """,
                        {"contract_id": contract_id, "user_id": user_id},
                    )
                    row = await cursor.fetchone()
                    return row[0] if row else ""

                # No existing active session — INSERT
                session_id = uuid.uuid4().hex.upper()
                insert_query = """
                    INSERT INTO review_sessions (
                        session_id, contract_id, user_id,
                        last_param_id, scroll_position, is_active, last_saved_at
                    ) VALUES (
                        HEXTORAW(:session_id),
                        HEXTORAW(:contract_id),
                        HEXTORAW(:user_id),
                        HEXTORAW(:last_param_id),
                        :scroll_position,
                        1,
                        CURRENT_TIMESTAMP
                    )
                """
                await cursor.execute(insert_query, {
                    "session_id":      session_id,
                    "contract_id":     contract_id,
                    "user_id":         user_id,
                    "last_param_id":   last_param_id or ("0" * 32),
                    "scroll_position": scroll_position,
                })
                await conn.commit()

        return session_id

    @staticmethod
    async def restore_session(contract_id: str, user_id: str) -> Optional[Dict]:
        """
        Retrieve the most recent active session for (contract_id, user_id).

        Returns None if no session exists (first visit).
        """
        query = """
            SELECT RAWTOHEX(session_id),
                   RAWTOHEX(last_param_id),
                   scroll_position,
                   last_saved_at
            FROM review_sessions
            WHERE contract_id = HEXTORAW(:contract_id)
              AND user_id     = HEXTORAW(:user_id)
              AND is_active   = 1
            ORDER BY last_saved_at DESC
            FETCH FIRST 1 ROWS ONLY
        """

        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(query, {
                    "contract_id": contract_id,
                    "user_id":     user_id,
                })
                row = await cursor.fetchone()

        if not row:
            return None

        return {
            "session_id":      row[0],
            "last_param_id":   row[1],
            "scroll_position": int(row[2]) if row[2] else 0,
            "last_saved_at":   row[3],
        }

    @staticmethod
    async def deactivate_session(contract_id: str, user_id: str) -> None:
        """Mark all active sessions for this contract+user as inactive."""
        query = """
            UPDATE review_sessions
            SET is_active = 0
            WHERE contract_id = HEXTORAW(:contract_id)
              AND user_id     = HEXTORAW(:user_id)
              AND is_active   = 1
        """

        async with db_pool.get_connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute(query, {
                    "contract_id": contract_id,
                    "user_id":     user_id,
                })
                await conn.commit()
