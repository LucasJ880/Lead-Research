"""Backfill script for product enhancement fields.

Usage:
  python backfill_product_enhancements.py --dry-run
  python backfill_product_enhancements.py --batch-size 500
"""

from __future__ import annotations

import argparse

from sqlalchemy import text

from src.core.database import get_db_session
from src.core.logging import get_logger
from src.utils.normalizer import normalize_location_extended, normalize_procurement_type

logger = get_logger(__name__)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Backfill product enhancement fields safely.")
    parser.add_argument("--dry-run", action="store_true", help="Preview updates without committing.")
    parser.add_argument("--batch-size", type=int, default=200, help="Rows per batch.")
    return parser


def main() -> None:
    args = _build_parser().parse_args()
    dry_run = args.dry_run
    batch_size = max(1, args.batch_size)

    session = get_db_session()
    try:
        last_id = None
        scanned = 0
        updated = 0

        while True:
            if last_id:
                rows = session.execute(
                    text(
                        """
                        SELECT id, title, location_raw, country, region, raw_data,
                               state_province, postal_code, delivery_location, location_confidence,
                               is_north_america, procurement_type, procurement_type_source,
                               procurement_type_confidence
                        FROM opportunities
                        WHERE id > :last_id
                        ORDER BY id
                        LIMIT :batch_size
                        """
                    ),
                    {"last_id": last_id, "batch_size": batch_size},
                ).fetchall()
            else:
                rows = session.execute(
                    text(
                        """
                        SELECT id, title, location_raw, country, region, raw_data,
                               state_province, postal_code, delivery_location, location_confidence,
                               is_north_america, procurement_type, procurement_type_source,
                               procurement_type_confidence
                        FROM opportunities
                        ORDER BY id
                        LIMIT :batch_size
                        """
                    ),
                    {"batch_size": batch_size},
                ).fetchall()

            if not rows:
                break

            for row in rows:
                scanned += 1
                raw = row.raw_data if isinstance(row.raw_data, dict) else {}
                source_type = str(raw.get("procurement_type") or raw.get("notice_type") or "").strip() or None
                location_text = row.location_raw or ", ".join([p for p in [row.region, row.country] if p])

                location_data = normalize_location_extended(location_text or "", country=row.country or "US")
                procurement_data = normalize_procurement_type(
                    title=row.title,
                    source_metadata_type=source_type,
                    document_text=None,
                )

                updates: dict[str, object] = {"id": row.id}
                if row.state_province is None and location_data.get("state_province"):
                    updates["state_province"] = location_data.get("state_province")
                if row.postal_code is None and location_data.get("postal_code"):
                    updates["postal_code"] = location_data.get("postal_code")
                if row.delivery_location is None and location_data.get("delivery_location"):
                    updates["delivery_location"] = location_data.get("delivery_location")
                if (row.location_confidence or 0) == 0 and location_data.get("location_confidence"):
                    updates["location_confidence"] = location_data.get("location_confidence")
                if row.is_north_america is False and location_data.get("is_north_america"):
                    updates["is_north_america"] = bool(location_data.get("is_north_america"))
                if str(row.procurement_type).lower() == "unknown" and procurement_data["procurement_type"] != "unknown":
                    updates["procurement_type"] = procurement_data["procurement_type"]
                    updates["procurement_type_source"] = procurement_data["procurement_type_source"]
                    updates["procurement_type_confidence"] = procurement_data["procurement_type_confidence"]

                if len(updates) == 1:
                    continue

                updated += 1
                if not dry_run:
                    session.execute(
                        text(
                            """
                            UPDATE opportunities
                            SET state_province = COALESCE(:state_province, state_province),
                                postal_code = COALESCE(:postal_code, postal_code),
                                delivery_location = COALESCE(:delivery_location, delivery_location),
                                location_confidence = COALESCE(:location_confidence, location_confidence),
                                is_north_america = COALESCE(:is_north_america, is_north_america),
                                procurement_type = COALESCE(CAST(:procurement_type AS "ProcurementType"), procurement_type),
                                procurement_type_source = COALESCE(:procurement_type_source, procurement_type_source),
                                procurement_type_confidence = COALESCE(:procurement_type_confidence, procurement_type_confidence),
                                updated_at = NOW()
                            WHERE id = :id
                            """
                        ),
                        {
                            "id": row.id,
                            "state_province": updates.get("state_province"),
                            "postal_code": updates.get("postal_code"),
                            "delivery_location": updates.get("delivery_location"),
                            "location_confidence": updates.get("location_confidence"),
                            "is_north_america": updates.get("is_north_america"),
                            "procurement_type": updates.get("procurement_type"),
                            "procurement_type_source": updates.get("procurement_type_source"),
                            "procurement_type_confidence": updates.get("procurement_type_confidence"),
                        },
                    )

            last_id = rows[-1].id
            if not dry_run:
                session.commit()
            logger.info(
                "Backfill progress: scanned=%d updated=%d dry_run=%s last_id=%s",
                scanned,
                updated,
                dry_run,
                str(last_id),
            )

        if dry_run:
            session.rollback()
        logger.info("Backfill complete: scanned=%d updated=%d dry_run=%s", scanned, updated, dry_run)
    except Exception:
        session.rollback()
        logger.exception("Backfill failed")
        raise
    finally:
        session.close()


if __name__ == "__main__":
    main()
