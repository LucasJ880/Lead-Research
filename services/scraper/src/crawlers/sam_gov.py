"""SAM.gov crawler — US federal contract opportunities.

Uses the SAM.gov public-facing search API to fetch solicitations, presolicitations,
and combined synopsis/solicitation notices. After retrieving listing-level data,
fetches the detail description text from the SAM.gov notice description endpoint
and extracts resource links (documents/attachments).

Pagination: limit=100 per page, offset-based.
"""

from __future__ import annotations

import re
import time
from datetime import datetime, timezone, timedelta
from typing import Any
from urllib.parse import urlencode

from src.crawlers.base import BaseCrawler
from src.models.opportunity import OpportunityCreate, OpportunityStatus

_API_BASE = "https://sam.gov/api/prod/opportunities/v2/search"
_UI_BASE = "https://sam.gov/opp"

_NOTICE_TYPES = "o,p,k,r,s"

# NAICS codes relevant to our industry vertical
_INDUSTRY_NAICS = [
    "337920",  # Blind and Shade Manufacturing
    "314120",  # Curtain and Linen Mills
    "314999",  # All Other Miscellaneous Textile Product Mills
    "337127",  # Institutional Furniture Manufacturing
    "423220",  # Home Furnishing Merchant Wholesalers
    "236220",  # Commercial and Institutional Building Construction
    "238390",  # Other Building Finishing Contractors
    "238990",  # All Other Specialty Trade Contractors
]

_INDUSTRY_KEYWORDS = [
    "blinds", "curtains", "drapery", "window covering", "window treatment",
    "furnishing", "FF&E", "shade", "cubicle curtain", "privacy curtain",
    "roller shade", "blackout", "motorized shade", "solar shade",
    "window shade", "hospital curtain", "privacy divider",
    "interior fit-out", "tenant improvement",
    "standing agreement", "window", "liner", "blanket", "textiles",
    "shutters", "bedding", "towel", "bag", "sock", "mask",
]

_STATE_MAP = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho",
    "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
    "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming", "DC": "District of Columbia",
}

_KEYWORD_RE = re.compile(
    "|".join(re.escape(kw) for kw in _INDUSTRY_KEYWORDS),
    re.IGNORECASE,
)


def _parse_date(date_str: str | None) -> datetime | None:
    if not date_str:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(date_str[:19], fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


class SamGovCrawler(BaseCrawler):
    """Crawl SAM.gov for US federal procurement opportunities."""

    def crawl(self) -> list[OpportunityCreate]:
        cfg = self.source_config.crawl_config
        max_pages = cfg.get("max_pages", 10)
        per_page = cfg.get("per_page", 100)
        days_back = cfg.get("days_back", 30)
        pre_filter = cfg.get("pre_filter_keywords", True)
        naics_codes = cfg.get("naics_codes") or _INDUSTRY_NAICS

        self._http.headers.update({
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            "Accept": "application/json",
        })

        now = datetime.now(timezone.utc)
        date_from = (now - timedelta(days=days_back)).strftime("%m/%d/%Y")
        date_to = now.strftime("%m/%d/%Y")

        seen_ids: set[str] = set()
        all_opps: list[OpportunityCreate] = []

        # Strategy 1: NAICS-targeted searches for high-relevance hits
        for naics in naics_codes:
            opps = self._search_api(
                extra_params={"ncode": naics},
                date_from=date_from, date_to=date_to,
                max_pages=min(max_pages, 3), per_page=per_page,
                pre_filter=False, seen_ids=seen_ids,
            )
            all_opps.extend(opps)
            self.logger.info("NAICS %s: %d opportunities", naics, len(opps))
            time.sleep(1)

        # Strategy 2: Keyword searches for additional coverage
        keyword_groups = [
            "blinds curtains drapery",
            "window covering window treatment",
            "furnishing textile fabric linen",
            "FF&E interior renovation",
        ]
        for kw_group in keyword_groups:
            opps = self._search_api(
                extra_params={"q": kw_group},
                date_from=date_from, date_to=date_to,
                max_pages=min(max_pages, 3), per_page=per_page,
                pre_filter=pre_filter, seen_ids=seen_ids,
            )
            all_opps.extend(opps)
            self.logger.info("Keyword '%s': %d opportunities", kw_group[:30], len(opps))
            time.sleep(1)

        # Strategy 3: Broad recent postings with pre-filtering
        broad_opps = self._search_api(
            extra_params={},
            date_from=date_from, date_to=date_to,
            max_pages=max_pages, per_page=per_page,
            pre_filter=True, seen_ids=seen_ids,
        )
        all_opps.extend(broad_opps)
        self.logger.info("Broad scan: %d opportunities (pre-filtered)", len(broad_opps))

        self.logger.info("SAM.gov crawl complete: %d total unique opportunities", len(all_opps))
        return all_opps

    def _search_api(
        self,
        extra_params: dict,
        date_from: str,
        date_to: str,
        max_pages: int,
        per_page: int,
        pre_filter: bool,
        seen_ids: set[str],
    ) -> list[OpportunityCreate]:
        """Run a single search strategy against the SAM.gov API."""
        results: list[OpportunityCreate] = []
        total_fetched = 0

        for page_offset in range(0, max_pages * per_page, per_page):
            params = {
                "limit": per_page,
                "offset": page_offset,
                "api_key": "",
                "postedFrom": date_from,
                "postedTo": date_to,
                "ptype": _NOTICE_TYPES,
                **extra_params,
            }
            url = f"{_API_BASE}?{urlencode(params)}"

            try:
                response = self._http.get(url, timeout=30)
                response.raise_for_status()
                data = response.json()
            except Exception as exc:
                self.logger.warning("SAM.gov API error at offset %d: %s", page_offset, exc)
                break

            records = data.get("opportunitiesData") or []
            if not records:
                break

            total_records = data.get("totalRecords", 0)
            total_fetched += len(records)

            for record in records:
                notice_id = record.get("noticeId", "")
                if notice_id in seen_ids:
                    continue
                opp = self._parse_record(record, pre_filter)
                if opp:
                    seen_ids.add(notice_id)
                    results.append(opp)

            if total_fetched >= total_records:
                break
            time.sleep(2)

        return results

    def _fetch_description(self, description_url: str) -> str:
        """Fetch the actual description text from the SAM.gov notice description URL."""
        if not description_url or not description_url.startswith("http"):
            return ""

        # SAM.gov search API returns URLs on api.sam.gov but the working
        # endpoint lives under sam.gov/api — rewrite if needed.
        if description_url.startswith("https://api.sam.gov/"):
            description_url = description_url.replace(
                "https://api.sam.gov/", "https://sam.gov/api/", 1
            )
        try:
            resp = self._http.get(description_url, timeout=20)
            resp.raise_for_status()
            content_type = resp.headers.get("content-type", "")

            if "json" in content_type:
                data = resp.json()
                if isinstance(data, dict):
                    text = (
                        data.get("description", "")
                        or data.get("content", "")
                        or data.get("body", "")
                    )
                    if text:
                        clean = re.sub(r"<[^>]+>", " ", text)
                        clean = re.sub(r"\s+", " ", clean).strip()
                        return clean[:15000]
                    return str(data)[:10000]
                return str(data)[:10000]

            # HTML or plain text response
            text = resp.text.strip()
            if not text:
                return ""
            # Strip HTML
            clean = re.sub(r"<[^>]+>", " ", text)
            clean = re.sub(r"\s+", " ", clean).strip()
            return clean[:15000]
        except Exception as exc:
            self.logger.warning("Failed to fetch description from %s: %s", description_url[:80], exc)
            return ""

    def _fetch_attachments(self, notice_id: str) -> list[dict[str, Any]]:
        """Fetch attachment metadata from the SAM.gov opportunity resources API.

        Handles the nested _embedded.opportunityAttachmentList structure
        where each item has an inner `attachments` array with the actual files/links.
        """
        if not notice_id:
            return []
        url = f"https://sam.gov/api/prod/opps/v3/opportunities/{notice_id}/resources"
        try:
            resp = self._http.get(url, timeout=15)
            if resp.status_code != 200:
                return []
            data = resp.json()
            docs: list[dict[str, Any]] = []

            resources: list = []
            if isinstance(data, list):
                resources = data
            elif isinstance(data, dict):
                raw_list = (
                    data.get("resources")
                    or data.get("attachments")
                    or (data.get("_embedded") or {}).get("opportunityAttachmentList")
                    or data.get("opportunityAttachmentList")
                    or []
                )
                if isinstance(raw_list, list):
                    for entry in raw_list:
                        if isinstance(entry, dict) and "attachments" in entry:
                            resources.extend(entry["attachments"])
                        else:
                            resources.append(entry)
                else:
                    resources = []

            if not isinstance(resources, list):
                resources = []

            for item in resources:
                if not isinstance(item, dict):
                    continue
                if item.get("deletedFlag") == "1" or item.get("deletedDate"):
                    continue

                name = item.get("name", item.get("fileName", item.get("title", "")))
                att_type = item.get("type", item.get("mimeType", ""))
                size = item.get("size", item.get("fileSizeInBytes", item.get("fileSize", None)))
                access = item.get("accessLevel", item.get("access", ""))
                resource_id = item.get("resourceId", item.get("attachmentId", item.get("id", "")))
                description = item.get("description", "")

                is_link = att_type == "link"

                if is_link:
                    link_url = item.get("uri", item.get("url", item.get("href", "")))
                    if not link_url:
                        continue
                    doc_entry: dict[str, Any] = {
                        "title": (description or name or "Related Link")[:250],
                        "url": link_url,
                        "file_type": "link",
                    }
                    if self._is_piee_link(link_url):
                        doc_entry["title"] = f"PIEE Solicitation: {description or name}"[:250]
                    docs.append(doc_entry)
                    continue

                download_url = item.get("downloadUrl", item.get("url", ""))
                if not download_url and resource_id:
                    download_url = f"https://sam.gov/api/prod/opps/v3/opportunities/resources/files/{resource_id}/download"

                if not name and not download_url:
                    continue

                file_type = ""
                name_lower = (name or "").lower()
                for ext in (".pdf", ".docx", ".doc", ".xlsx", ".xls", ".zip", ".csv", ".txt"):
                    if name_lower.endswith(ext):
                        file_type = ext.lstrip(".")
                        break
                if not file_type:
                    mime = (item.get("mimeType") or "").lower()
                    if ".pdf" in mime or "pdf" in mime:
                        file_type = "pdf"

                doc_entry = {
                    "title": (name or "Attachment")[:250],
                    "url": download_url or "",
                    "file_type": file_type or (att_type[:20] if att_type else "file"),
                }
                if size:
                    try:
                        doc_entry["file_size_bytes"] = int(size)
                    except (ValueError, TypeError):
                        pass
                if access:
                    doc_entry["access"] = str(access)[:50]

                docs.append(doc_entry)

            return docs
        except Exception as exc:
            self.logger.debug("Failed to fetch attachments for %s: %s", notice_id, exc)
            return []

    @staticmethod
    def _is_piee_link(url: str) -> bool:
        return "piee.eb.mil" in url.lower()

    def _extract_resource_links(self, record: dict, notice_id: str = "") -> list[dict[str, Any]]:
        """Extract document/attachment metadata from the API record + attachments API."""
        docs: list[dict[str, Any]] = []
        seen_urls: set[str] = set()

        # 1. Try the attachments API first (most reliable for actual files)
        if notice_id:
            attachments = self._fetch_attachments(notice_id)
            for att in attachments:
                url = att.get("url", "")
                if url and url not in seen_urls:
                    seen_urls.add(url)
                    docs.append(att)

        # 2. Also check resourceLinks from the search result
        for link in (record.get("resourceLinks") or []):
            url = link if isinstance(link, str) else link.get("url", "")
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)
            title = link.get("title", "") if isinstance(link, dict) else ""
            if not title:
                title = url.rstrip("/").split("/")[-1].split("?")[0]
            file_type = ""
            lower_url = url.lower()
            for ext in (".pdf", ".docx", ".doc", ".xlsx", ".xls", ".zip", ".csv"):
                if ext in lower_url:
                    file_type = ext.lstrip(".")
                    break
            docs.append({
                "title": title[:250],
                "url": url,
                "file_type": file_type or "link",
            })

        # 3. Check links array
        for link in (record.get("links") or []):
            url = link.get("href", "") if isinstance(link, dict) else str(link)
            if url and url not in seen_urls:
                seen_urls.add(url)
                docs.append({
                    "title": (link.get("rel", "") if isinstance(link, dict) else "")[:250] or "Related Link",
                    "url": url,
                    "file_type": "link",
                })

        return docs

    def _parse_record(self, record: dict, pre_filter: bool) -> OpportunityCreate | None:
        title = record.get("title", "").strip()[:250]
        if not title:
            return None

        notice_id = record.get("noticeId", "")
        sol_number = record.get("solicitationNumber", "")

        org_path = record.get("fullParentPathName", "")
        org_name = org_path.split(".")[-1].strip()[:200] if org_path else None

        # --- Dates ---
        posted = _parse_date(record.get("postedDate"))
        response_deadline = _parse_date(record.get("responseDeadLine"))
        archive_date = _parse_date(record.get("archiveDate"))
        # Use archive/inactive date as closing date; fall back to response deadline
        closing = archive_date or response_deadline

        # --- Location from officeAddress ---
        office_addr = record.get("officeAddress") or {}
        state_code = office_addr.get("state", "")
        city = office_addr.get("city", "")
        zip_code = office_addr.get("zipcode", "")
        region = state_code if state_code else None

        # Build full office address string
        addr_parts = []
        if office_addr.get("streetAddress"):
            addr_parts.append(office_addr["streetAddress"])
        if office_addr.get("streetAddress2"):
            addr_parts.append(office_addr["streetAddress2"])
        if city:
            line = city
            if state_code:
                line += f", {state_code}"
            if zip_code:
                line += f" {zip_code}"
            addr_parts.append(line)
        office_address_full = ", ".join(addr_parts) if addr_parts else ""

        # --- Place of Performance ---
        pop = record.get("placeOfPerformance") or record.get("pop") or {}
        pop_city = pop.get("city", {}).get("name", "") if isinstance(pop.get("city"), dict) else pop.get("city", "")
        pop_state = pop.get("state", {}).get("code", "") if isinstance(pop.get("state"), dict) else pop.get("state", "")
        pop_text = ""
        if pop_city or pop_state:
            pop_text = f"{pop_city}, {pop_state}".strip(", ")

        notice_type = record.get("type", "")
        naics = record.get("naicsCode", "")
        classification = record.get("classificationCode", "")
        psc_name = record.get("classificationName", "")

        # Pre-filter: skip obvious non-matches to reduce DB volume
        if pre_filter:
            combined = f"{title} {org_path} {notice_type} {naics} {psc_name}".lower()
            if not _KEYWORD_RE.search(combined):
                broad_terms = ["construct", "renovat", "building", "facilit", "interior",
                               "maintenance", "repair", "install", "supply", "deliver"]
                if not any(t in combined for t in broad_terms):
                    return None

        ui_link = record.get("uiLink", "")
        if not ui_link and notice_id:
            ui_link = f"{_UI_BASE}/{notice_id}/view"

        # --- Contacts ---
        contacts = record.get("pointOfContact") or []
        contact_name = None
        contact_email = None
        contact_phone = None
        if contacts:
            primary = contacts[0]
            contact_name = primary.get("fullName") or primary.get("name")
            contact_email = primary.get("email")
            contact_phone = primary.get("phone") or primary.get("phoneNumber") or primary.get("fax")

        # --- Description ---
        description_url = record.get("description", "")
        desc_text = ""
        if description_url and description_url.startswith("http"):
            desc_text = self._fetch_description(description_url)
            time.sleep(0.3)

        # Build a rich summary from classification data
        summary_parts = []
        if naics:
            naics_name = record.get("naicsName", "")
            summary_parts.append(f"NAICS: {naics}" + (f" - {naics_name}" if naics_name else ""))
        if classification:
            summary_parts.append(f"PSC: {classification}" + (f" - {psc_name}" if psc_name else ""))
        if notice_type:
            summary_parts.append(f"Type: {notice_type}")
        if pop_text:
            summary_parts.append(f"Place of Performance: {pop_text}")

        # --- Documents from search API + attachments API ---
        resource_links = self._extract_resource_links(record, notice_id)
        if resource_links:
            time.sleep(0.3)

        # Build location display from place of performance if available, else office
        if pop_text:
            location_raw = pop_text
        elif city:
            location_raw = f"{city}, {_STATE_MAP.get(state_code, state_code)}" if city else state_code
        else:
            location_raw = state_code
        location_raw = (location_raw or "")[:200]

        est_value = None
        raw_est = record.get("estimatedValue") or record.get("baseAndAllOptionsValue")
        if raw_est:
            try:
                est_value = float(str(raw_est).replace(",", "").replace("$", ""))
            except (ValueError, TypeError):
                pass

        return OpportunityCreate(
            source_id=self.source_config.id,
            external_id=notice_id or sol_number,
            title=title,
            description_summary=". ".join(summary_parts)[:500] if summary_parts else None,
            description_full=desc_text[:15000] if desc_text else None,
            status=OpportunityStatus.OPEN,
            country="US",
            region=region or pop_state or None,
            city=pop_city or city or None,
            location_raw=location_raw,
            posted_date=posted.date() if posted else None,
            closing_date=closing,
            project_type=notice_type[:250] if notice_type else None,
            category=(f"NAICS {naics}" if naics else "Federal Procurement")[:250],
            solicitation_number=(sol_number or notice_id)[:250],
            estimated_value=est_value,
            currency="USD",
            contact_name=contact_name,
            contact_email=contact_email,
            contact_phone=contact_phone,
            source_url=ui_link,
            has_documents=len(resource_links) > 0,
            organization_name=org_name,
            raw_data={
                "parser_version": "samgov_v4",
                "notice_id": notice_id,
                "naics_code": naics,
                "naics_name": record.get("naicsName", ""),
                "classification_code": classification,
                "classification_name": psc_name,
                "notice_type": notice_type,
                "org_path": org_path,
                "description_url": description_url,
                "office_address": office_addr,
                "office_address_full": office_address_full,
                "place_of_performance": pop_text,
                "response_deadline": response_deadline.isoformat() if response_deadline else None,
                "archive_date": archive_date.isoformat() if archive_date else None,
                "department": record.get("department", ""),
                "sub_tier": record.get("subtierAgency", record.get("subTier", "")),
                "office": record.get("office", ""),
                "set_aside": record.get("typeOfSetAsideDescription", record.get("setAside", "")),
                "award": record.get("award") or {},
                "estimated_value": record.get("estimatedValue") or record.get("baseAndAllOptionsValue"),
                "contract_type": record.get("contractType", ""),
                "pop_country": pop.get("country", {}).get("code", "") if isinstance(pop.get("country"), dict) else pop.get("country", ""),
                "pop_zip": pop.get("zip", ""),
                "resource_links": resource_links,
                "all_contacts": [
                    {k: v for k, v in c.items() if v}
                    for c in contacts
                ] if contacts else [],
                "fetch_timestamp": datetime.now(timezone.utc).isoformat(),
            },
            fingerprint="",
        )
