"""
WebSocket endpoint for live extraction pipeline status.

Endpoint: GET /ws/extraction/{contract_id}

Protocol:
  - Client connects immediately after triggering extraction.
  - Server streams JSON event objects until a terminal event is received.
  - Client must send the JWT access token as the `token` query parameter
    because browser WebSocket APIs cannot set Authorization headers.

Event schema:
  {
    "stage":     "EXTRACTION_RUNNING" | "GROUNDING_RUNNING" | ... | "DRAFT_READY" | "ERROR",
    "message":   "Human-readable status text",
    "progress":  0.0 – 1.0,          // optional
    "batch":     "Batch N: Label",    // optional, per-batch events
    "timestamp": "2026-05-30T15:00:00Z"
  }

Terminal events: stage == "DRAFT_READY" or stage == "ERROR".
After a terminal event the server closes the WebSocket connection.
"""

import asyncio
import json
from datetime import datetime, timezone
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, status
from ..utils.pipeline_bus import get_or_create_queue, release_queue
from ..auth.service import AuthService
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["WebSocket"])

# How long to wait for the next event before sending a heartbeat ping (seconds)
_HEARTBEAT_INTERVAL = 20

# Sentinel value placed on the queue by the extraction pipeline when done/failed
_TERMINAL_STAGES = {"DRAFT_READY", "ERROR"}


@router.websocket("/extraction/{contract_id}")
async def extraction_status_ws(
    websocket: WebSocket,
    contract_id: str,
    token: str = Query(..., description="JWT access token (query param)"),
):
    """
    Stream real-time extraction pipeline events to the browser.

    Authentication: JWT token is passed as `?token=<access_token>` because
    browser WebSocket does not support custom request headers.
    """
    # ── Auth ──────────────────────────────────────────────────────────────────
    try:
        payload = AuthService.decode_token(token)
        if not payload or not payload.get("sub"):
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
    except Exception as auth_exc:
        logger.warning(f"WS auth failed for contract {contract_id}: {auth_exc}")
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()
    logger.info(f"WS connected: contract={contract_id} user={payload.get('sub')}")

    queue = get_or_create_queue(contract_id)

    # Send initial connection ack
    await _send(websocket, {
        "stage":    "CONNECTED",
        "message":  "Connected to extraction pipeline. Waiting for events...",
        "progress": 0.0,
    })

    try:
        while True:
            try:
                # Non-blocking wait with heartbeat timeout
                event = await asyncio.wait_for(queue.get(), timeout=_HEARTBEAT_INTERVAL)
            except asyncio.TimeoutError:
                # Send a heartbeat ping to keep the connection alive
                await _send(websocket, {"stage": "HEARTBEAT", "message": "Pipeline active..."})
                continue

            await _send(websocket, event)

            # Close cleanly on terminal events
            if event.get("stage") in _TERMINAL_STAGES:
                logger.info(f"WS closing after terminal event: {event.get('stage')}")
                await websocket.close()
                break

    except WebSocketDisconnect:
        logger.info(f"WS client disconnected: contract={contract_id}")
    except Exception as exc:
        logger.error(f"WS error for contract {contract_id}: {exc}")
        try:
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
        except Exception:
            pass
    finally:
        asyncio.create_task(release_queue(contract_id))


async def _send(ws: WebSocket, event: dict) -> None:
    """Add timestamp and send event as JSON text."""
    event.setdefault("timestamp", datetime.now(timezone.utc).isoformat())
    await ws.send_text(json.dumps(event))
