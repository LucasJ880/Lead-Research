"""Regression tests that lock in upsert behaviour for re-crawled opportunities.

Background
----------
When a crawler revisits a source and finds an opportunity it already
ingested, the pipeline runs ``_update_opportunity``. The team's product
contract is:

  Crawler-owned fields (title, status, closing_date, score, etc.)
  may be refreshed on every re-crawl. **User-managed fields**
  (business_status, workflow_status, archive reason history, notes)
  must NEVER be reset by a re-crawl.

This rule is what makes the "save for later" / archive feature safe —
without it, a user could archive a bid in the morning and have it pop
back into the active list the next day after the daily crawl.

Approach
--------
We do **static SQL inspection** rather than spinning up a real Postgres.
The pipeline's UPDATE statement is a literal string in source — checking
its column list catches any future edit that accidentally adds one of
the protected columns to the SET clause.

This is a deliberate trade-off: a runtime DB integration test would be
stronger, but the project does not yet have a Postgres-backed test
fixture, and adding one is out of scope for this hardening pass. The
static check is fast, dependency-free, and catches the regression
class we actually care about.
"""

from __future__ import annotations

import inspect
import re

from src.crawlers import pipeline as pipeline_module

# Columns the user owns. The crawler must NEVER write to these in the
# update path, otherwise re-crawling would clobber human decisions.
PROTECTED_COLUMNS = {
    "business_status",
    "business_status_reason_latest",
    "workflow_status",
    "workflow_note",
    "workflow_updated_at",
    "assigned_to",
    "archived_at",
    "archive_reason",
    "tenant_id",
    "organization_id",
    "ingestion_mode",
}

# Columns the crawler is expected to refresh on re-crawl. Keeping this
# explicit makes it obvious if a future change accidentally drops one.
EXPECTED_CRAWLER_OWNED_COLUMNS = {
    "title",
    "status",
    "closing_date",
    "estimated_value",
    "relevance_score",
    "relevance_bucket",
    "keywords_matched",
    "negative_keywords",
}


def _extract_update_sql() -> str:
    """Return the raw SQL text of pipeline._update_opportunity.

    Pulls out the first triple-quoted SQL string passed to ``text(...)``
    in the method body — that is the UPDATE statement.
    """
    source = inspect.getsource(pipeline_module.CrawlPipeline._update_opportunity)
    match = re.search(r'text\(\s*"' + r'""' + r'(.*?)"' + r'""' + r'\s*\)', source, re.DOTALL)
    assert match, "Could not locate UPDATE SQL in _update_opportunity"
    return match.group(1)


def _extract_set_columns(update_sql: str) -> set[str]:
    """Return the lowercase column names in the SET clause of an UPDATE."""
    set_match = re.search(r"SET\s+(.*?)\s+WHERE\s+", update_sql, re.IGNORECASE | re.DOTALL)
    assert set_match, f"Could not locate SET clause in: {update_sql[:200]}"
    set_clause = set_match.group(1)
    columns = set()
    for assignment in set_clause.split(","):
        col = assignment.strip().split("=", 1)[0].strip().lower()
        if col:
            columns.add(col)
    return columns


def test_update_does_not_touch_protected_user_columns():
    """The UPDATE statement must not write any user-managed column.

    If this test fails after a future edit, the change is almost
    certainly a regression: the scraper would now overwrite
    user-set status/notes on every re-crawl, breaking the archive
    workflow.
    """
    update_sql = _extract_update_sql()
    set_columns = _extract_set_columns(update_sql)
    leaked = PROTECTED_COLUMNS & set_columns
    assert not leaked, (
        f"_update_opportunity SET clause contains protected user-managed "
        f"columns: {sorted(leaked)}. This would let a re-crawl overwrite "
        f"user decisions (e.g. un-archive a bid the user marked for later)."
    )


def test_update_still_refreshes_crawler_owned_columns():
    """Sanity guard: ensure refactors don't accidentally remove the
    columns the scraper IS supposed to refresh."""
    update_sql = _extract_update_sql()
    set_columns = _extract_set_columns(update_sql)
    missing = EXPECTED_CRAWLER_OWNED_COLUMNS - set_columns
    assert not missing, (
        f"_update_opportunity no longer refreshes expected scraper-owned "
        f"columns: {sorted(missing)}"
    )


def test_dedup_strategy_is_preserve_existing_for_external_id_match():
    """When an opportunity matches by (source_id, external_id), the
    pipeline must call _update_opportunity (preserve user fields)
    rather than _insert_opportunity (which would create a duplicate).
    """
    source = inspect.getsource(pipeline_module.CrawlPipeline._dedup_and_store)
    # Order matters: source+external_id check first, then fingerprint
    assert source.index("check_source_duplicate") < source.index("check_duplicate"), (
        "_dedup_and_store must check (source_id, external_id) before "
        "fingerprint, otherwise re-crawls of the same source could "
        "create duplicate rows when external_ids change shape."
    )
    # On match the update path is taken
    assert "_update_opportunity" in source, (
        "_dedup_and_store no longer calls _update_opportunity on hit; "
        "this would silently skip refreshing existing opportunities."
    )


def test_archived_opportunity_stays_archived_after_simulated_recrawl():
    """End-to-end behaviour assertion against the SQL contract.

    We don't run a real DB here, but we encode the contract: the SET
    clause does not mention business_status, therefore an UPDATE built
    from this SQL cannot change a row's business_status from
    ``archived`` to anything else.

    This is the closest we can get to a "user archives, scraper runs,
    archive survives" integration test without a Postgres fixture.
    """
    update_sql = _extract_update_sql()
    assert "business_status" not in update_sql.lower(), (
        "UPDATE SQL references business_status — re-crawl could now "
        "reset an archived opportunity back to active. This breaks the "
        "save-for-later workflow."
    )
    assert "workflow_status" not in update_sql.lower()
    # Notes live in a separate table (`notes`) and are never touched by
    # this UPDATE; encode that as documentation:
    assert "notes" not in update_sql.lower(), (
        "UPDATE SQL touches a column whose name contains 'notes'; "
        "user-authored notes should remain in the separate notes table."
    )
