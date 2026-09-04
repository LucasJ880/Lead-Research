"""SEAO (Québec) crawler — open data in OCDS format.

Québec publishes every SEAO notice as OCDS releases on Données Québec:
weekly files ``hebdo_YYYYMMDD_YYYYMMDD.json`` (~4–5k releases, ~20 MB) and
monthly roll-ups. We read the newest N weekly files through the CKAN API,
keep releases tagged ``tender`` / ``tenderUpdate`` whose tender is still
active, and build opportunities from ``tender`` + ``buyer`` + ``items``.
Titles/descriptions are French; the relevance scorer has a French lexicon.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone

from src.crawlers.base import BaseCrawler
from src.models.opportunity import OpportunityCreate, OpportunityStatus

_CKAN_PACKAGE = "https://www.donneesquebec.ca/recherche/api/3/action/package_show?id=systeme-electronique-dappel-doffres-seao"


@dataclass
class _Diagnostics:
    files: list = field(default_factory=list)
    releases_seen: int = 0
    tenders_kept: int = 0
    skipped_not_tender: int = 0
    skipped_closed: int = 0
    skipped_dup: int = 0
    search_results: list = field(default_factory=list)


def _parse_iso(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


class SeaoCrawler(BaseCrawler):
    """Ingest SEAO weekly OCDS files."""

    def crawl(self) -> list[OpportunityCreate]:
        cfg = self.source_config.crawl_config
        weeks = int(cfg.get("weeks", 2))
        self._diag = _Diagnostics()
        self._http.headers.update({"User-Agent": "Mozilla/5.0 (compatible; BidToGo/1.0)"})

        self.rate_limit()
        pkg = self._http.get(_CKAN_PACKAGE, timeout=60)
        pkg.raise_for_status()
        resources = pkg.json().get("result", {}).get("resources", [])
        weekly = sorted(
            (r for r in resources if str(r.get("name", "")).startswith("hebdo_")),
            key=lambda r: r["name"],
            reverse=True,
        )[:weeks]

        seen: set[str] = set()
        results: list[OpportunityCreate] = []
        now = datetime.now(timezone.utc)
        for res in weekly:
            if self.should_stop():
                break
            self.rate_limit()
            resp = self._http.get(res["url"], timeout=120)
            resp.raise_for_status()
            releases = json.loads(resp.content).get("releases", [])
            self._diag.files.append(res["name"])
            kept = 0
            for rel in releases:
                self._diag.releases_seen += 1
                opp = self._from_release(rel, seen, now)
                if opp:
                    results.append(opp)
                    kept += 1
            self._diag.search_results.append((res["name"], kept))

        self._diag.tenders_kept = len(results)
        self.logger.info("SEAO crawl complete: %d open tenders from %d file(s)", len(results), len(self._diag.files))
        return results

    def _from_release(self, rel: dict, seen: set[str], now: datetime) -> OpportunityCreate | None:
        tags = set(rel.get("tag") or [])
        if not tags & {"tender", "tenderUpdate"}:
            self._diag.skipped_not_tender += 1
            return None
        tender = rel.get("tender") or {}
        status = (tender.get("status") or "").lower()
        period = tender.get("tenderPeriod") or {}
        closing = _parse_iso(period.get("endDate"))
        if status in ("complete", "cancelled", "unsuccessful", "withdrawn") or (closing and closing < now):
            self._diag.skipped_closed += 1
            return None
        ocid = rel.get("ocid") or ""
        if not ocid or ocid in seen:
            self._diag.skipped_dup += 1
            return None
        title = (tender.get("title") or "").strip()
        if not title:
            return None
        seen.add(ocid)

        buyer = (rel.get("buyer") or {}).get("name") or (tender.get("procuringEntity") or {}).get("name")
        items = tender.get("items") or []
        item_lines = []
        codes = []
        for it in items[:15]:
            desc = it.get("description") or ""
            cls = it.get("classification") or {}
            if cls.get("id"):
                codes.append(f"{cls.get('scheme', 'UNSPSC')}:{cls['id']}")
            if desc:
                item_lines.append(desc)
        description = tender.get("description") or ""
        if item_lines:
            description = (description + "\n\nCatégories: " + "; ".join(item_lines)).strip()
        docs = tender.get("documents") or []
        source_url = next((d.get("url") for d in docs if d.get("url")), None) or f"https://seao.gouv.qc.ca/avis-resultat-recherche?ocid={ocid}"
        region_raw = None
        for p in rel.get("parties") or []:
            if "buyer" in (p.get("roles") or []):
                addr = p.get("address") or {}
                region_raw = ", ".join(x for x in (addr.get("locality"), addr.get("region")) if x) or None
                break

        return OpportunityCreate(
            source_id=self.source_config.id,
            external_id=ocid,
            title=title,
            description_summary=(tender.get("description") or "; ".join(item_lines))[:500] or None,
            description_full=description or None,
            status=OpportunityStatus.OPEN,
            country="CA",
            region="QC",
            location_raw=region_raw or "Québec, Canada",
            posted_date=(_parse_iso(period.get("startDate")) or _parse_iso(rel.get("date")) or now).date(),
            closing_date=closing,
            project_type=tender.get("procurementMethodDetails"),
            category=tender.get("mainProcurementCategory") or "Procurement",
            solicitation_number=(tender.get("id") or "").strip() or None,
            currency="CAD",
            source_url=source_url,
            has_documents=bool(docs),
            organization_name=buyer,
            raw_data={
                "parser_version": "seao_ocds_v1",
                "ocid": ocid,
                "release_id": rel.get("id"),
                "tags": sorted(tags),
                "procurement_method": tender.get("procurementMethod"),
                "procurement_type": tender.get("procurementMethodDetails"),
                "classification_codes": codes,
                "language": rel.get("language"),
                "fetch_timestamp": now.isoformat(),
            },
            fingerprint="",
        )
