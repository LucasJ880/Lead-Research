#!/usr/bin/env python3
"""Add source_priority field to every entry in sources.yaml.

Priority assignment rules:
  critical — federal portals, largest aggregators (SAM.gov, buyandsell.gc.ca, MERX)
  high     — industry_fit_score >= 60 (hospitals, housing authorities)
  medium   — industry_fit_score 30-59 (state/provincial, school boards, universities, cities)
  low      — industry_fit_score < 30 (generic municipal, small towns)
  experimental — inactive sources being evaluated

Also extracts listing_path from crawl_config.listing_url where available.
"""

import sys
from pathlib import Path

import yaml

YAML_PATH = Path(__file__).resolve().parent.parent / "data" / "sources.yaml"

CRITICAL_SOURCE_IDS = {
    "merx", "government_bids_ca", "sam_gov",
    "ontario_tenders", "bc_bid", "alberta_purchasing",
    "sasktenders", "california_eprocure", "texas_smartbuy",
    "ny_state_contract_reporter", "washington_webs",
    "florida_vendor_bid", "illinois_procurement",
    "massachusetts_commbuys",
}


def assign_priority(src: dict) -> str:
    sid = src.get("source_id", "")
    if sid in CRITICAL_SOURCE_IDS:
        return "critical"
    if not src.get("active", True):
        return "experimental"
    fit = src.get("industry_fit_score", 50)
    if fit >= 60:
        return "high"
    if fit >= 30:
        return "medium"
    return "low"


def extract_listing_path(src: dict):
    cfg = src.get("crawl_config", {})
    if not isinstance(cfg, dict):
        return None
    url = cfg.get("listing_url", "")
    if not url:
        return None
    # Strip the base_url prefix if it appears, keep just the path
    base = src.get("base_url", "")
    if url.startswith(base):
        return url[len(base):]
    if url.startswith("/"):
        return url
    return url


def main():
    raw = YAML_PATH.read_text()
    data = yaml.safe_load(raw)
    sources = data.get("sources", []) if isinstance(data, dict) else data

    updated = 0
    for src in sources:
        if "source_priority" not in src:
            src["source_priority"] = assign_priority(src)
            updated += 1
        elif not src["source_priority"]:
            src["source_priority"] = assign_priority(src)
            updated += 1

        if "listing_path" not in src:
            lp = extract_listing_path(src)
            if lp:
                src["listing_path"] = lp

    output = {"sources": sources}
    YAML_PATH.write_text(yaml.dump(output, default_flow_style=False, allow_unicode=True, sort_keys=False, width=120))

    # Stats
    counts = {}
    for src in sources:
        p = src.get("source_priority", "unknown")
        counts[p] = counts.get(p, 0) + 1

    print(f"Updated source_priority on {updated} entries")
    print(f"Total sources: {len(sources)}")
    for p in ["critical", "high", "medium", "low", "experimental"]:
        print(f"  {p}: {counts.get(p, 0)}")


if __name__ == "__main__":
    main()
