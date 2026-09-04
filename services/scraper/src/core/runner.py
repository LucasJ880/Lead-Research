"""Celery-free job runner for serverless hosts (Vercel).

The ``source_runs`` table doubles as the work queue:

* ``POST /api/crawl/all`` / ``POST /api/crawl/{id}`` insert ``pending`` rows.
* A cron-driven ``tick()`` claims the oldest pending row (``FOR UPDATE SKIP
  LOCKED`` so overlapping ticks never crawl the same source twice), runs the
  crawl pipeline with a wall-clock budget, and finalizes the row.
* When nothing is queued the tick does maintenance (document extraction,
  translation, purge) and, once per day per source, queues scheduled crawls.

Everything here is plain synchronous Python so it also works under Docker.
"""

from __future__ import annotations

import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text

from src.core.database import get_db
from src.core.logging import get_logger
from src.core.sources import LOCAL_ACCESS_MODES, row_to_source_config
from src.models.opportunity import RunStatus, TriggerType

logger = get_logger(__name__)

# Overall wall-clock budget for one tick. Keep below the platform function limit.
TICK_BUDGET_SECONDS = float(os.environ.get("TICK_BUDGET_SECONDS", "250"))
# A run still "running" after this long belongs to an invocation that was killed.
STALE_RUN_MINUTES = int(os.environ.get("STALE_RUN_MINUTES", "20"))
# Queue a scheduled crawl for a source when its last run is older than this.
SCHEDULE_INTERVAL_HOURS = int(os.environ.get("SCHEDULE_INTERVAL_HOURS", "20"))

_STATUS_MAP = {
    "pending": "PENDING",
    "running": "STARTED",
    "completed": "SUCCESS",
    "failed": "FAILURE",
    "cancelled": "REVOKED",
}

_LOCAL_MODES_SQL = ", ".join(f"'{m}'" for m in LOCAL_ACCESS_MODES)


# ─── Queueing ───────────────────────────────────────────────


def _in_flight_run(session: Any, source_id: str) -> Any:
    return session.execute(
        text("""
            SELECT id, status FROM source_runs
            WHERE source_id = :sid AND status IN ('pending', 'running')
            ORDER BY created_at DESC LIMIT 1
        """),
        {"sid": source_id},
    ).fetchone()


def enqueue_crawl(source_id: str, triggered_by: TriggerType = TriggerType.MANUAL) -> dict[str, str]:
    """Queue a crawl for one source. Returns ``{"task_id", "source_id", "status"}``."""
    with get_db() as session:
        src = session.execute(
            text("SELECT id, name, is_active, access_mode FROM sources WHERE id = :id"),
            {"id": source_id},
        ).fetchone()
        if src is None:
            return {"task_id": "", "source_id": source_id, "status": "not_found"}
        if (src.access_mode or "http") in LOCAL_ACCESS_MODES:
            return {"task_id": "", "source_id": source_id, "status": "local_connector_only"}

        existing = _in_flight_run(session, source_id)
        if existing is not None:
            return {"task_id": str(existing.id), "source_id": source_id, "status": "already_running"}

        row = session.execute(
            text("""
                INSERT INTO source_runs (source_id, status, triggered_by)
                VALUES (:sid, 'pending', :trig)
                RETURNING id
            """),
            {"sid": source_id, "trig": triggered_by.value},
        ).fetchone()
        logger.info("Queued crawl run %s for source %s (%s)", row.id, source_id, src.name)
        return {"task_id": str(row.id), "source_id": source_id, "status": "dispatched"}


def enqueue_crawl_all(triggered_by: TriggerType = TriggerType.MANUAL) -> dict[str, Any]:
    """Queue a crawl for every active cloud-crawlable source."""
    with get_db() as session:
        rows = session.execute(
            text(f"""
                SELECT id FROM sources
                WHERE is_active = true
                  AND COALESCE(access_mode::text, 'http') NOT IN ({_LOCAL_MODES_SQL})
                ORDER BY source_priority DESC, name
            """)
        ).fetchall()
    results = [enqueue_crawl(str(r.id), triggered_by) for r in rows]
    dispatched = [r for r in results if r["status"] == "dispatched"]
    return {
        "task_ids": results,
        "count": len(dispatched),
        "status": "dispatched" if dispatched else "already_running",
    }


def get_run_status(run_id: str) -> dict[str, Any] | None:
    with get_db() as session:
        row = session.execute(
            text("""
                SELECT id, status, opportunities_found, opportunities_created,
                       opportunities_updated, opportunities_skipped, error_message,
                       started_at, completed_at
                FROM source_runs WHERE id = :id
            """),
            {"id": run_id},
        ).fetchone()
    if row is None:
        return None
    return {
        "task_id": str(row.id),
        "status": _STATUS_MAP.get(row.status, str(row.status).upper()),
        "result": {
            "source_run_id": str(row.id),
            "opportunities_found": row.opportunities_found,
            "opportunities_created": row.opportunities_created,
            "opportunities_updated": row.opportunities_updated,
            "opportunities_skipped": row.opportunities_skipped,
            "error": row.error_message,
        } if row.status in ("completed", "failed") else None,
    }


# ─── Housekeeping ───────────────────────────────────────────


def reap_stale_runs() -> int:
    """Mark runs whose invocation died (still 'running' far past the function limit) as failed."""
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=STALE_RUN_MINUTES)
    with get_db() as session:
        res = session.execute(
            text("""
                UPDATE source_runs
                SET status = 'failed', completed_at = NOW(),
                    error_message = COALESCE(error_message, 'Invocation timed out (serverless); partial results kept')
                WHERE status = 'running' AND started_at < :cutoff
            """),
            {"cutoff": cutoff},
        )
        n = res.rowcount or 0
    if n:
        logger.warning("Reaped %d stale running source_run(s)", n)
    return n


def ensure_scheduled_crawls() -> int:
    """Queue a 'schedule' crawl for each active source not crawled within SCHEDULE_INTERVAL_HOURS."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=SCHEDULE_INTERVAL_HOURS)
    with get_db() as session:
        rows = session.execute(
            text(f"""
                SELECT s.id
                FROM sources s
                WHERE s.is_active = true
                  AND COALESCE(s.access_mode::text, 'http') NOT IN ({_LOCAL_MODES_SQL})
                  AND NOT EXISTS (
                      SELECT 1 FROM source_runs r
                      WHERE r.source_id = s.id AND r.created_at >= :cutoff
                  )
            """),
            {"cutoff": cutoff},
        ).fetchall()
    queued = 0
    for r in rows:
        if enqueue_crawl(str(r.id), TriggerType.SCHEDULE)["status"] == "dispatched":
            queued += 1
    if queued:
        logger.info("Scheduled %d daily crawl(s)", queued)
    return queued


# ─── Execution ──────────────────────────────────────────────


def _claim_next_pending() -> tuple[str, Any] | None:
    """Atomically claim the oldest pending run. Returns (run_id, source_row) or None."""
    with get_db() as session:
        row = session.execute(
            text(f"""
                SELECT r.id AS run_id, r.triggered_by
                FROM source_runs r
                JOIN sources s ON s.id = r.source_id
                WHERE r.status = 'pending'
                  AND s.is_active = true
                  AND COALESCE(s.access_mode::text, 'http') NOT IN ({_LOCAL_MODES_SQL})
                ORDER BY r.created_at
                LIMIT 1
                FOR UPDATE OF r SKIP LOCKED
            """)
        ).fetchone()
        if row is None:
            return None
        session.execute(
            text("UPDATE source_runs SET status = 'running', started_at = NOW() WHERE id = :id"),
            {"id": row.run_id},
        )
        src = session.execute(
            text("SELECT * FROM sources WHERE id = (SELECT source_id FROM source_runs WHERE id = :id)"),
            {"id": row.run_id},
        ).fetchone()
        return str(row.run_id), (src, row.triggered_by)


def run_next_pending_crawl(time_budget_seconds: float) -> dict[str, Any] | None:
    """Crawl one queued source inside the time budget. Returns a result dict or None if idle."""
    claimed = _claim_next_pending()
    if claimed is None:
        return None
    run_id, (src_row, triggered_by_raw) = claimed
    source_config = row_to_source_config(src_row)
    try:
        triggered_by = TriggerType(triggered_by_raw)
    except ValueError:
        triggered_by = TriggerType.SCHEDULE

    from src.crawlers.pipeline import CrawlPipeline

    logger.info("Tick: crawling '%s' (run %s, budget %.0fs)", source_config.name, run_id, time_budget_seconds)
    try:
        with get_db() as session:
            pipeline = CrawlPipeline(source_config=source_config, db_session=session)
            result = pipeline.run(
                triggered_by=triggered_by,
                source_run_id=run_id,
                time_budget_seconds=time_budget_seconds,
            )
        payload = result.model_dump()
    except Exception as exc:  # pipeline.run() already finalizes on its own errors
        logger.exception("Crawl run %s crashed", run_id)
        with get_db() as session:
            session.execute(
                text("""
                    UPDATE source_runs SET status = 'failed', completed_at = NOW(), error_message = :err
                    WHERE id = :id AND status = 'running'
                """),
                {"id": run_id, "err": str(exc)[:1000]},
            )
        payload = {"source_id": source_config.id, "errors": [str(exc)]}
    payload["run_id"] = run_id
    payload["source_name"] = source_config.name
    return payload


def run_maintenance(deadline: float) -> dict[str, Any]:
    """Document extraction, translation and purge — bounded by ``deadline`` (monotonic)."""
    out: dict[str, Any] = {}

    try:
        from src.tasks.extract_documents import extract_pending_documents_now

        out["documents"] = extract_pending_documents_now(limit=10, deadline=deadline - 60)
    except Exception as exc:
        logger.exception("Maintenance: document extraction failed")
        out["documents"] = {"error": str(exc)}

    if time.monotonic() < deadline - 30:
        try:
            from src.utils.translator import translate_pending_batch

            with get_db() as session:
                out["translated"] = translate_pending_batch(session, limit=20)
        except Exception as exc:
            logger.exception("Maintenance: translation failed")
            out["translated"] = {"error": str(exc)}

    if time.monotonic() < deadline - 10:
        try:
            from src.tasks.cleanup_tasks import (
                purge_expired_opportunities_now,
                purge_sam_set_aside_restricted_now,
            )

            out["purged"] = {
                "expired": purge_expired_opportunities_now(),
                "sam_set_aside_restricted": purge_sam_set_aside_restricted_now(),
            }
        except Exception as exc:
            logger.exception("Maintenance: purge failed")
            out["purged"] = {"error": str(exc)}

    return out


def tick(budget_seconds: float | None = None) -> dict[str, Any]:
    """One unit of scheduler work. Safe to call every few minutes from a cron."""
    started = time.monotonic()
    budget = budget_seconds or TICK_BUDGET_SECONDS
    deadline = started + budget
    report: dict[str, Any] = {"budget_seconds": budget}

    try:
        report["reaped"] = reap_stale_runs()
    except Exception as exc:
        logger.exception("Tick: reap failed")
        report["reaped"] = {"error": str(exc)}
    try:
        report["scheduled"] = ensure_scheduled_crawls()
    except Exception as exc:
        logger.exception("Tick: schedule failed")
        report["scheduled"] = {"error": str(exc)}

    crawl = run_next_pending_crawl(max(30.0, deadline - time.monotonic() - 5))
    if crawl is not None:
        report["action"] = "crawl"
        report["crawl"] = crawl
    else:
        report["action"] = "maintenance"
        report["maintenance"] = run_maintenance(deadline)

    report["elapsed_seconds"] = round(time.monotonic() - started, 1)
    return report
