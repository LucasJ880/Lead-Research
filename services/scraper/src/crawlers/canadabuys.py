"""CanadaBuys crawler — Canadian federal procurement via Open Data CSV.

Downloads the official "Open tender notices" CSV from the Government of
Canada Open Data portal. The file is refreshed daily (7:00–8:30 AM EST)
and contains all currently open federal tenders.

CSV source:
  https://canadabuys.canada.ca/opendata/pub/openTenderNotice-ouvertAvisAppelOffres.csv
"""

from __future__ import annotations

import csv
import io
from datetime import datetime, timezone
from typing import Any

import requests

from src.crawlers.base import BaseCrawler
from src.core.logging import get_logger
from src.models.opportunity import OpportunityCreate, OpportunityStatus

logger = get_logger(__name__)

_OPEN_CSV_URL = (
    "https://canadabuys.canada.ca/opendata/pub/"
    "openTenderNotice-ouvertAvisAppelOffres.csv"
)

_PROVINCE_MAP = {
    "Alberta": "AB", "British Columbia": "BC", "Manitoba": "MB",
    "New Brunswick": "NB", "Newfoundland and Labrador": "NL",
    "Northwest Territories": "NT", "Nova Scotia": "NS", "Nunavut": "NU",
    "Ontario": "ON", "Prince Edward Island": "PE", "Quebec": "QC",
    "Saskatchewan": "SK", "Yukon": "YT",
    "National Capital Region (Gatineau)": "QC",
    "National Capital Region (Ottawa)": "ON",
}


def _parse_dt(val: str | None) -> datetime | None:
    if not val or not val.strip():
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(val.strip()[:19], fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _clean(val: str | None, max_len: int = 500) -> str | None:
    if not val or not val.strip():
        return None
    return val.strip()[:max_len]


def _extract_province(row: dict[str, str]) -> str | None:
    """Best-effort province code from delivery regions or entity address."""
    province = _clean(row.get(
        "contractingEntityAddressProvince-entiteContractanteAdresseProvince-eng", ""
    ))
    if province:
        return _PROVINCE_MAP.get(province, province[:5])

    regions = _clean(row.get("regionsOfDelivery-regionsLivraison-eng", ""), 500)
    if regions:
        for name, code in _PROVINCE_MAP.items():
            if name.lower() in regions.lower():
                return code
    return None


class CanadaBuysCrawler(BaseCrawler):
    """Fetch Canadian federal open tenders from the CanadaBuys Open Data CSV."""

    def crawl(self) -> list[OpportunityCreate]:
        cfg = self.source_config.crawl_config
        csv_url = cfg.get("csv_url", _OPEN_CSV_URL)

        self.logger.info("Downloading CanadaBuys CSV from %s", csv_url)
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            "Accept": "text/csv,text/plain,*/*",
        }
        resp = requests.get(csv_url, timeout=120, headers=headers)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding or "utf-8"

        text = resp.text
        self.logger.info("CSV downloaded: %d bytes", len(text))

        reader = csv.DictReader(io.StringIO(text))
        all_opps: list[OpportunityCreate] = []
        skipped = 0

        for row in reader:
            try:
                opp = self._parse_row(row)
                if opp:
                    all_opps.append(opp)
                else:
                    skipped += 1
            except Exception:
                self.logger.debug("Error parsing row: %s", row.get("referenceNumber-numeroReference", "?"), exc_info=True)
                skipped += 1

        self.logger.info(
            "CanadaBuys crawl complete: %d opportunities parsed, %d skipped",
            len(all_opps), skipped,
        )
        return all_opps

    def _parse_row(self, row: dict[str, str]) -> OpportunityCreate | None:
        title = _clean(row.get("title-titre-eng", ""), 500)
        if not title:
            return None

        ref_number = _clean(row.get("referenceNumber-numeroReference", ""), 250)
        sol_number = _clean(row.get("solicitationNumber-numeroSollicitation", ""), 250)
        notice_url = _clean(row.get("noticeURL-URLavis-eng", ""), 1000)

        if not notice_url and not ref_number:
            return None

        source_url = notice_url or f"https://canadabuys.canada.ca/en/tender-opportunities/{ref_number}"

        pub_date = _parse_dt(row.get("publicationDate-datePublication"))
        closing_date = _parse_dt(row.get("tenderClosingDate-appelOffresDateCloture"))

        province = _extract_province(row)
        city = _clean(row.get(
            "contractingEntityAddressCity-entiteContractanteAdresseVille-eng", ""
        ), 200)
        org_name = _clean(row.get("contractingEntityName-nomEntitContractante-eng", ""), 300)

        description = _clean(row.get("tenderDescription-descriptionAppelOffres-eng", ""), 15000)
        category = _clean(row.get("procurementCategory-categorieApprovisionnement", ""), 250)
        notice_type = _clean(row.get("noticeType-avisType-eng", ""), 250)
        procurement_method = _clean(row.get("procurementMethod-methodeApprovisionnement-eng", ""), 250)

        delivery_regions = _clean(row.get("regionsOfDelivery-regionsLivraison-eng", ""), 500)
        location_raw = delivery_regions or (f"{city}, {province}" if city and province else province)

        contact_name = _clean(row.get("contactInfoName-informationsContactNom", ""), 200)
        contact_email = _clean(row.get("contactInfoEmail-informationsContactCourriel", ""), 200)
        contact_phone = _clean(row.get("contactInfoPhone-contactInfoTelephone", ""), 50)

        gsin = _clean(row.get("gsin-nibs", ""), 100)
        unspsc = _clean(row.get("unspsc", ""), 100)
        trade_agreements = _clean(row.get("tradeAgreements-accordsCommerciaux-eng", ""), 500)

        category_label = {
            "CNST": "Construction", "GD": "Goods",
            "SRV": "Services", "SRVTGD": "Services related to goods",
        }.get(category or "", category or "Federal Procurement")

        summary_parts = []
        if notice_type:
            summary_parts.append(notice_type)
        if category_label:
            summary_parts.append(f"Category: {category_label}")
        if procurement_method:
            summary_parts.append(f"Method: {procurement_method}")
        if org_name:
            summary_parts.append(f"Entity: {org_name}")
        desc_summary = ". ".join(summary_parts)[:500] if summary_parts else None

        return OpportunityCreate(
            source_id=self.source_config.id,
            external_id=ref_number or sol_number,
            title=title,
            description_summary=desc_summary,
            description_full=description,
            status=OpportunityStatus.OPEN,
            country="CA",
            region=province,
            city=city,
            location_raw=location_raw,
            posted_date=pub_date.date() if pub_date else None,
            closing_date=closing_date,
            project_type=notice_type,
            category=category_label,
            solicitation_number=sol_number or ref_number,
            estimated_value=None,
            currency="CAD",
            contact_name=contact_name,
            contact_email=contact_email,
            contact_phone=contact_phone,
            source_url=source_url,
            has_documents=False,
            organization_name=org_name,
            raw_data={
                "parser_version": "canadabuys_csv_v1",
                "reference_number": ref_number,
                "amendment_number": _clean(row.get("amendmentNumber-numeroModification", ""), 50),
                "gsin": gsin,
                "unspsc": unspsc,
                "procurement_category": category,
                "notice_type": notice_type,
                "procurement_method": procurement_method,
                "trade_agreements": trade_agreements,
                "regions_of_opportunity": _clean(row.get("regionsOfOpportunity-regionAppelOffres-eng", ""), 500),
                "regions_of_delivery": delivery_regions,
                "end_user_entity": _clean(row.get("endUserEntitiesName-nomEntitesUtilisateurFinal-eng", ""), 300),
                "selection_criteria": _clean(row.get("selectionCriteria-criteresSelection-eng", ""), 500),
                "expected_contract_start": _clean(row.get("expectedContractStartDate-dateDebutContratPrevue", ""), 50),
                "expected_contract_end": _clean(row.get("expectedContractEndDate-dateFinContratPrevue", ""), 50),
                "fetch_timestamp": datetime.now(timezone.utc).isoformat(),
            },
            fingerprint="",
        )
