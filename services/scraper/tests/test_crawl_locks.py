"""Regression tests for the server-side crawl dedup lock.

The lock has a defined lifecycle (see ``src/api/crawl_locks.py`` module
docstring). Summary:

  - API endpoint pre-generates the Celery task id, acquires the lock,
    then dispatches with that exact task id.
  - Celery task body releases the lock in its ``finally`` block by
    identity match.
  - 30-minute TTL is a safety net for crashed workers; the happy path
    releases via the task body.

This test file covers:
  - SETNX semantics (first wins, others get the existing holder)
  - Identity-checked release (stale callers cannot free others' locks)
  - Fail-open on Redis outage (manual crawl button stays usable)
  - Static-analysis assertions that the Celery task bodies actually
    contain the ``finally`` + ``release(...)`` block. Without this we
    would silently regress to short-window dedup if a future edit
    removes the release call.

These tests use fakeredis so they run without a real Redis instance.
"""

from __future__ import annotations

import importlib

import fakeredis
import pytest


@pytest.fixture
def crawl_locks(monkeypatch):
    """Reload crawl_locks with a fakeredis client injected."""
    from src.api import crawl_locks as module

    importlib.reload(module)
    fake = fakeredis.FakeRedis(decode_responses=True)
    # Inject our fake client into the module-level singleton.
    module._redis_client = fake  # type: ignore[attr-defined]
    return module


def test_first_call_acquires_lock(crawl_locks):
    result = crawl_locks.try_acquire("all", "task-1")
    assert result.acquired is True
    assert result.holder_task_id == "task-1"


def test_second_call_within_ttl_returns_existing_holder(crawl_locks):
    first = crawl_locks.try_acquire("all", "task-1")
    second = crawl_locks.try_acquire("all", "task-2")

    assert first.acquired is True
    assert second.acquired is False, (
        "Second call must NOT acquire the lock — otherwise double-click "
        "of the manual crawl button would dispatch duplicate Celery tasks."
    )
    assert second.holder_task_id == "task-1", (
        "When the lock is held, the response must surface the original "
        "holder so the UI can show 'crawl already running' with the "
        "correct task id."
    )


def test_per_source_locks_are_isolated(crawl_locks):
    """Lock scopes are independent: a global crawl-all does not block a
    single-source crawl, and two different sources don't block each other."""
    crawl_locks.try_acquire("all", "all-task")
    src_a = crawl_locks.try_acquire("source:aaa", "src-a")
    src_b = crawl_locks.try_acquire("source:bbb", "src-b")

    assert src_a.acquired is True
    assert src_b.acquired is True
    # but a second call to the same scope should still be blocked
    src_a_again = crawl_locks.try_acquire("source:aaa", "src-a-2")
    assert src_a_again.acquired is False
    assert src_a_again.holder_task_id == "src-a"


def test_release_only_clears_own_lock(crawl_locks):
    """A stale caller cannot accidentally release a newer holder's lock."""
    crawl_locks.try_acquire("all", "task-1")
    # Wrong task id — should be a no-op.
    crawl_locks.release("all", "task-2")
    second = crawl_locks.try_acquire("all", "task-3")
    assert second.acquired is False, (
        "release() with the wrong task_id must not clear the lock; "
        "otherwise a slow stale request could free a fresh holder's lock."
    )
    assert second.holder_task_id == "task-1"


def test_release_with_correct_token_frees_lock(crawl_locks):
    crawl_locks.try_acquire("all", "task-1")
    crawl_locks.release("all", "task-1")
    second = crawl_locks.try_acquire("all", "task-2")
    assert second.acquired is True
    assert second.holder_task_id == "task-2"


def test_lock_expires_after_ttl(crawl_locks):
    """After TTL the lock must be reacquirable.

    We force expiry by manually deleting the key — this is a unit-level
    proxy for "TTL elapsed". The real TTL behaviour is provided by
    Redis itself and is not what we are testing here; what we are
    testing is that ``try_acquire`` does not have any in-memory state
    that would prevent re-acquisition after the underlying key is gone.
    """
    crawl_locks.try_acquire("all", "task-1", ttl_seconds=60)
    # Simulate TTL elapse by removing the key directly.
    crawl_locks._redis_client.delete(crawl_locks._key("all"))  # type: ignore[attr-defined]
    second = crawl_locks.try_acquire("all", "task-2", ttl_seconds=60)
    assert second.acquired is True, (
        "Lock did not become reacquirable after the underlying key was "
        "removed — would block legitimate retries long after the "
        "original crawl completed."
    )
    assert second.holder_task_id == "task-2"


def test_default_ttl_covers_realistic_crawl_duration(crawl_locks):
    """The default TTL must be long enough that a real long-running crawl
    cannot have its lock auto-expire mid-flight under normal conditions.

    SAM.gov crawls are 2-10 min, MERX crawls can be longer. A 60-second
    TTL would auto-expire while the crawl is still running, defeating
    the dedup. The TTL must be at least 15 min (preferably 30 min) and
    cannot be infinite (otherwise a crashed worker would permanently
    block the manual button).
    """
    ttl = crawl_locks.DEFAULT_LOCK_TTL_SECONDS
    assert ttl >= 15 * 60, (
        f"DEFAULT_LOCK_TTL_SECONDS={ttl}s is too short to cover a real "
        f"crawl. The lock would auto-expire mid-crawl, allowing duplicate "
        f"manual triggers and defeating server-side dedup."
    )
    assert ttl <= 60 * 60, (
        f"DEFAULT_LOCK_TTL_SECONDS={ttl}s is too long. If a worker "
        f"crashes mid-crawl, the manual button would be blocked for "
        f"longer than an hour with no manual recovery path."
    )


def test_redis_failure_fails_open(monkeypatch, crawl_locks):
    """If Redis is unavailable, acquiring the lock must NOT block the
    user from triggering a crawl. The manual button is a critical
    operator escape hatch and a degraded Redis should not lock it out."""
    import redis as redis_module

    class _BrokenRedis:
        def set(self, *args, **kwargs):
            raise redis_module.RedisError("simulated outage")

        def get(self, *args, **kwargs):
            raise redis_module.RedisError("simulated outage")

        def delete(self, *args, **kwargs):
            raise redis_module.RedisError("simulated outage")

    crawl_locks._redis_client = _BrokenRedis()  # type: ignore[attr-defined]
    result = crawl_locks.try_acquire("all", "task-1")
    assert result.acquired is True, (
        "When Redis is degraded the lock must fail open so the manual "
        "crawl button still works (logged as a warning, not a blocker)."
    )


# ──────────────────────────────────────────────────────────────────────
# Static-analysis tests for the Celery task lifecycle.
#
# These guard the *task-level* release contract: the Celery task body
# must call ``release(...)`` from a ``finally`` block so the lock is
# freed when the actual crawl finishes, not just when the API endpoint
# returns. Without these the lock would auto-expire only via TTL and
# we would silently regress to short-window dedup.
# ──────────────────────────────────────────────────────────────────────


def _read_task_source(task_func_name: str) -> str:
    import inspect

    from src.tasks import crawl_tasks

    func = getattr(crawl_tasks, task_func_name)
    # Celery wraps tasks; the underlying function is on `.run`.
    underlying = getattr(func, "run", func)
    return inspect.getsource(underlying)


def test_crawl_source_releases_lock_in_finally():
    """``crawl_source`` task body must release its per-source lock in
    ``finally``. Without this, the lock would only auto-expire via TTL,
    making the dedup short-window again."""
    source = _read_task_source("crawl_source")
    assert "finally:" in source, (
        "crawl_source no longer has a finally block — lock would only "
        "release via TTL, regressing to short-window dedup."
    )
    # Release call must reference the per-source scope and use the
    # task's own request id for identity-checked release.
    assert 'f"source:{source_id}"' in source or "f'source:{source_id}'" in source, (
        "crawl_source finally block does not release the per-source "
        "scope; lock would never be freed by the task."
    )
    assert "self.request.id" in source, (
        "crawl_source finally must call release with self.request.id "
        "so identity check passes for tasks dispatched via the per-source "
        "API endpoint."
    )


def test_crawl_all_active_sources_releases_lock_in_finally():
    """``crawl_all_active_sources`` must release its ``"all"`` lock in
    ``finally``. The fan-out is fast but the lock should still be
    released by the task, not only by TTL."""
    source = _read_task_source("crawl_all_active_sources")
    assert "finally:" in source, (
        "crawl_all_active_sources no longer has a finally block — "
        "lock would only release via TTL."
    )
    assert '"all"' in source or "'all'" in source, (
        "crawl_all_active_sources finally must release scope='all'."
    )
    assert "self.request.id" in source, (
        "crawl_all_active_sources finally must use self.request.id; "
        "task must be defined with bind=True for this attribute to exist."
    )


def test_crawl_all_active_sources_is_bind_true():
    """``self.request.id`` only exists when the task is bound. Guard
    against accidentally dropping ``bind=True`` in a future edit.

    Celery wraps the task so ``inspect.signature(task.run)`` returns the
    wrapper, not the underlying function. We assert against the source
    text instead — coarser, but adequate for this regression class.
    """
    source = _read_task_source("crawl_all_active_sources")
    decorator_line = source.splitlines()[0]
    assert "bind=True" in decorator_line, (
        f"crawl_all_active_sources decorator must include bind=True so "
        f"self.request.id is available for identity-checked lock "
        f"release. Got: {decorator_line!r}"
    )
    # And the function signature must accept self as the first argument.
    def_line = next((ln for ln in source.splitlines() if ln.startswith("def ")), "")
    assert "(self" in def_line, (
        f"crawl_all_active_sources must take self as first arg "
        f"(matching bind=True). Got: {def_line!r}"
    )


def test_api_endpoints_use_pre_generated_celery_task_id():
    """The API endpoints must pre-generate the Celery task id and pass
    it via apply_async(task_id=...). Otherwise the lock value (a
    placeholder) would not match the real task id, and the task body's
    identity-checked release would not free the lock — every lock would
    wait for the TTL."""
    import inspect

    from src.api import main as api_main

    for endpoint_name in ("trigger_all_crawls", "trigger_crawl"):
        source = inspect.getsource(getattr(api_main, endpoint_name))
        assert "celery_uuid" in source or "celery.utils" in source, (
            f"{endpoint_name} no longer pre-generates a Celery task id; "
            f"the lock value will not match the real task id and "
            f"identity-checked release in the task body will fail."
        )
        # Require both apply_async (not .delay) and an explicit task_id=
        # kwarg so the lock value can match the dispatched task's id.
        assert "apply_async" in source and "task_id=" in source, (
            f"{endpoint_name} no longer dispatches with apply_async("
            f"task_id=...); lock value will drift from real task id and "
            f"the task body's release will become a no-op."
        )
