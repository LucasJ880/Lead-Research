"""Redis-based dedup locks for crawl trigger endpoints.

Lifecycle (the contract this module enforces)
---------------------------------------------

1. **API endpoint** pre-generates a Celery ``task_id`` and calls
   :func:`try_acquire`. If the lock is taken, the endpoint returns
   ``status="already_running"`` with the existing holder's task id and
   does NOT dispatch a new Celery task.

2. **API endpoint** dispatches the Celery task with that pre-generated
   ``task_id`` (via ``.apply_async(task_id=...)``) so the lock value
   matches the real task id from the moment the task is queued.
   No race window between dispatch and lock-value update.

3. **Celery task body** runs the actual crawl. On normal completion or
   on exception the task's ``finally`` block calls :func:`release`,
   which only deletes the key if it still belongs to this task id —
   so a stale, retried, or unrelated task cannot accidentally release
   another task's lock.

4. **Worker crash, lost connection, or hung process** is the worst case.
   The Redis key has a TTL safety net of 30 minutes (configurable via
   ``DEFAULT_LOCK_TTL_SECONDS``). After the TTL expires the lock auto-
   releases regardless of task state, so a crash can never permanently
   block the manual crawl button.

In summary: this is **task-level dedup with a TTL-based crash fallback**,
not the "60-second double-click guard" the earlier draft of this module
claimed. The 30-minute TTL is sized to cover the longest realistic
crawl cycle (MERX + Biddingo across all sources). If a real crawl
genuinely takes longer than the TTL, see "Known limitations" below.

Known limitations
-----------------

* Only the API endpoints (``/api/crawl/all``, ``/api/crawl/{source_id}``)
  acquire locks. The Celery beat schedule (daily 9 AM cron) and any
  fan-out from ``crawl_all_active_sources`` to per-source tasks dispatch
  Celery directly. Cross-path concurrency (cron firing while a
  user-triggered crawl is running) is therefore NOT prevented at the
  lock layer; it is naturally limited by ``worker_prefetch_multiplier=1``
  but a fully task-body-level lock is required to fully eliminate
  duplicate per-source crawls across paths. Tracked as a follow-up.

* If a real crawl takes longer than the TTL (>30 min) the lock will
  auto-release while the task is still running. A subsequent manual
  click within that window would dispatch a duplicate. To raise the TTL
  above 30 min we should also add periodic lock heartbeats so that a
  crashed worker is still detected within a reasonable time.

* On Celery automatic retry (``self.retry``) the original task's
  ``finally`` releases the lock before the retry runs. The retried
  task body has no lock, so a manual click during the retry delay
  (default 60 s) could dispatch a duplicate. Acceptable given the
  small window; mitigated by the still-active per-source dedup at the
  pipeline level (``UNIQUE(source_id, external_id)`` and fingerprint).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import redis

from src.core.config import settings
from src.core.logging import get_logger

logger = get_logger(__name__)

# Sized to cover the longest realistic crawl cycle (~ tens of minutes).
# Acts as a safety net: if a worker crashes mid-crawl, the lock auto-
# releases at most this long after the crash. The happy path releases
# the lock in the task body's `finally` block, so this TTL is rarely
# what frees the lock in practice.
DEFAULT_LOCK_TTL_SECONDS = 30 * 60  # 30 minutes

# Key namespace — keep distinct from Celery result keys.
_LOCK_PREFIX = "bidtogo:crawl_lock"


@dataclass
class LockResult:
    """Outcome of a lock acquisition attempt."""

    acquired: bool
    holder_task_id: Optional[str]
    """Task id of the holder. If ``acquired`` is True this is the task id we
    just stored. If False this is the existing holder."""


_redis_client: Optional[redis.Redis] = None


def _get_redis() -> redis.Redis:
    """Return a lazily initialised Redis client (single connection pool)."""
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.Redis.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            socket_timeout=2.0,
            socket_connect_timeout=2.0,
        )
    return _redis_client


def _key(scope: str) -> str:
    return f"{_LOCK_PREFIX}:{scope}"


def try_acquire(
    scope: str,
    task_id: str,
    ttl_seconds: int = DEFAULT_LOCK_TTL_SECONDS,
) -> LockResult:
    """Attempt to acquire a dedup lock for ``scope``.

    Args:
        scope: Logical lock scope, e.g. ``"all"`` for global crawl-all, or
            ``"source:<uuid>"`` for a single source crawl.
        task_id: Task id we want to associate with this lock if we win it.
            Callers should use the actual Celery task id (pre-generated
            via ``celery.utils.uuid()``) so the task body can release
            the lock by identity in its ``finally`` block.
        ttl_seconds: Lock TTL in seconds; auto-released after this window.
            See :data:`DEFAULT_LOCK_TTL_SECONDS` for default rationale.

    Returns:
        LockResult describing whether the lock was acquired and the
        current holder's task id.

    On Redis connection failure the lock is treated as acquired (fail-open)
    so the manual crawl path stays usable even if Redis is degraded.
    """
    key = _key(scope)
    try:
        client = _get_redis()
        ok = client.set(key, task_id, nx=True, ex=ttl_seconds)
        if ok:
            return LockResult(acquired=True, holder_task_id=task_id)
        existing = client.get(key)
        return LockResult(acquired=False, holder_task_id=existing)
    except redis.RedisError:
        logger.exception("Crawl dedup lock Redis error for scope=%s; failing open", scope)
        return LockResult(acquired=True, holder_task_id=task_id)


def release(scope: str, task_id: str) -> None:
    """Best-effort release of a lock.

    Only releases if the stored task id matches ``task_id`` so a stale
    caller, a retried task, or a cron-triggered task that didn't
    originally acquire the lock cannot accidentally release another
    task's lock. Missing lock or Redis errors are ignored.

    Intended to be called from the Celery task body's ``finally`` block
    so the lock is freed promptly when the actual crawl finishes,
    without waiting for the TTL safety net.
    """
    key = _key(scope)
    try:
        client = _get_redis()
        current = client.get(key)
        if current == task_id:
            client.delete(key)
    except redis.RedisError:
        logger.debug("Crawl dedup lock release failed for scope=%s", scope, exc_info=True)
