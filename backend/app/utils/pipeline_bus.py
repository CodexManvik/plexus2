"""
In-process pub/sub bus for pipeline stage events.

Used to bridge the extraction pipeline (which runs in a background task)
to the WebSocket endpoint that streams events to the browser.

Design:
  - One asyncio.Queue per contract_id, stored in a module-level dict.
  - The extraction service calls emit() at each stage transition.
  - The WS endpoint reads from the queue and forwards each event as JSON.
  - On pipeline completion (or error), a terminal sentinel is emitted so
    the WS handler can cleanly close the connection.
  - Queues are garbage-collected 60 seconds after the last subscriber
    disconnects (see _cleanup_queue).

Thread safety: All operations on _queues happen on the asyncio event loop.
The extraction pipeline runs in a ThreadPoolExecutor (via run_in_executor)
but calls asyncio.get_event_loop().call_soon_threadsafe() to enqueue safely.
"""

import asyncio
import time
from typing import Dict, Any
import logging

logger = logging.getLogger(__name__)

# contract_id → asyncio.Queue of event dicts
_queues: Dict[str, asyncio.Queue] = {}

# Tracks when the last subscriber disconnected, for GC
_last_seen: Dict[str, float] = {}


def get_or_create_queue(contract_id: str) -> asyncio.Queue:
    """Get (or create) the event queue for a contract."""
    if contract_id not in _queues:
        _queues[contract_id] = asyncio.Queue(maxsize=256)
    _last_seen[contract_id] = time.monotonic()
    return _queues[contract_id]


def emit(contract_id: str, event: Dict[str, Any]) -> None:
    """
    Non-blocking emit from any context (sync or async).

    If a queue does not exist for the contract (no active WS subscriber),
    the event is silently dropped — the extraction pipeline must not block
    on UI availability.
    """
    queue = _queues.get(contract_id)
    if queue is None:
        return
    try:
        queue.put_nowait(event)
    except asyncio.QueueFull:
        logger.warning(
            f"[pipeline_bus] Queue full for contract {contract_id}, "
            f"dropping event: {event.get('stage')}"
        )


async def emit_async(contract_id: str, event: Dict[str, Any]) -> None:
    """Async variant of emit — awaitable, never drops events unless queue is full."""
    queue = _queues.get(contract_id)
    if queue is None:
        return
    try:
        queue.put_nowait(event)
    except asyncio.QueueFull:
        logger.warning(f"[pipeline_bus] Queue full for {contract_id}, dropping {event.get('stage')}")


async def release_queue(contract_id: str) -> None:
    """Mark a subscriber as disconnected and schedule queue GC after 60s."""
    _last_seen[contract_id] = time.monotonic()
    await asyncio.sleep(60)
    if contract_id in _last_seen:
        if time.monotonic() - _last_seen[contract_id] >= 59:
            _queues.pop(contract_id, None)
            _last_seen.pop(contract_id, None)
            logger.debug(f"[pipeline_bus] Cleaned up queue for {contract_id}")
