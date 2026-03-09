"""Backfill: rescore all existing live opportunities with Relevance Engine v2.

Generates: relevance_score, relevance_bucket, matched/negative keywords,
industry_tags, relevance_breakdown, and business_fit_explanation.

Run:
    cd services/scraper && python backfill_scores.py
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from sqlalchemy import create_engine, text
from src.utils.scorer import score_opportunity

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://leadharvest:changeme_in_production@localhost:5433/leadharvest",
)


def main() -> None:
    engine = create_engine(DATABASE_URL)
    with engine.begin() as conn:
        rows = conn.execute(
            text(
                "SELECT o.id, o.title, o.description_summary, o.description_full, "
                "o.project_type, o.category, s.industry_fit_score "
                "FROM opportunities o "
                "JOIN sources s ON o.source_id = s.id "
                "WHERE o.ingestion_mode = 'live'"
            )
        ).fetchall()

        print(f"Rescoring {len(rows)} opportunities with Relevance Engine v2...\n")

        buckets_before = {}
        buckets_after = {}

        for row in rows:
            oid = row.id
            title = row.title or ""
            desc = row.description_full or row.description_summary or ""
            project_type = row.project_type
            category = getattr(row, "category", None)
            source_fit = row.industry_fit_score

            score, breakdown = score_opportunity(
                title=title,
                description=desc,
                org_type=None,
                project_type=project_type,
                category=category,
                source_fit_score=source_fit,
            )

            keywords_matched = (
                breakdown.get("primary_matches", [])
                + breakdown.get("secondary_matches", [])
                + breakdown.get("contextual_matches", [])
            )
            negative_keywords = breakdown.get("negative_matches", [])
            industry_tags = breakdown.get("industry_tags", [])
            bucket = breakdown.get("relevance_bucket", "irrelevant")
            explanation = breakdown.get("business_fit_explanation", "")

            conn.execute(
                text("""
                    UPDATE opportunities SET
                        relevance_score = :score,
                        relevance_bucket = :bucket,
                        relevance_breakdown = :breakdown,
                        keywords_matched = :keywords,
                        negative_keywords = :neg_keywords,
                        industry_tags = :tags,
                        business_fit_explanation = :explanation,
                        updated_at = NOW()
                    WHERE id = :id
                """),
                {
                    "id": oid,
                    "score": score,
                    "bucket": bucket,
                    "breakdown": json.dumps(breakdown),
                    "keywords": keywords_matched,
                    "neg_keywords": negative_keywords,
                    "tags": industry_tags,
                    "explanation": explanation,
                },
            )

            buckets_after[bucket] = buckets_after.get(bucket, 0) + 1

            marker = "***" if bucket in ("highly_relevant", "moderately_relevant") else "   "
            print(f"  {marker} [{bucket:>20}] {score:3d}  {title[:65]}")
            if explanation:
                print(f"       → {explanation[:100]}")

        print(f"\n{'='*70}")
        print(f"Done. Rescored {len(rows)} opportunities.\n")

        print("Bucket distribution after rescore:")
        for b in ["highly_relevant", "moderately_relevant", "low_relevance", "irrelevant"]:
            print(f"  {b:>20}: {buckets_after.get(b, 0)}")


if __name__ == "__main__":
    main()
