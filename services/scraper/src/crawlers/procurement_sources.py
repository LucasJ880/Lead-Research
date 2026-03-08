"""Procurement data adapters for the LeadHarvest crawl pipeline.

Each adapter produces demonstration opportunities that represent the TYPES
of listings found on real public procurement portals. Every source_url
points to a REAL, WORKING public procurement page that users can verify.

When real HTTP crawlers are implemented, these adapters will be replaced
with actual HTML/API parsers. Until then, they demonstrate the full
pipeline (normalizer → scorer → deduplicator → database) with realistic
data linked to verifiable public portals.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

from src.crawlers.base import BaseCrawler
from src.models.opportunity import OpportunityCreate, OpportunityStatus, SourceConfig


class SamGovCrawler(BaseCrawler):
    """Adapter for SAM.gov — US federal procurement.

    All source_url values point to the real SAM.gov public search page
    filtered for relevant NAICS codes and keywords. Users can verify
    these are real, publicly accessible government pages.
    """

    # Real SAM.gov search URLs for relevant categories
    _SEARCH_BASE = "https://sam.gov/search/?keywords={kw}&index=opp&is_active=true&sort=-modifiedDate"

    def crawl(self) -> list[OpportunityCreate]:
        self.logger.info("Generating SAM.gov demonstration opportunities")
        today = date.today()
        opps: list[OpportunityCreate] = []

        listings = [
            {
                "external_id": "demo-sam-001",
                "title": "Window Blinds and Shades — Military Base Renovation",
                "org": "US Army Corps of Engineers",
                "desc": (
                    "Supply and installation of window blinds and solar shades for "
                    "barracks buildings. Requirements include blackout roller shades "
                    "for sleeping quarters, solar shades for common areas, and "
                    "motorized shade systems for the dining facility. Products must "
                    "meet fire resistance standards. "
                    "NOTE: This is a demonstration entry representing the type of "
                    "opportunity found on SAM.gov. Click the source link to browse "
                    "real federal procurement listings."
                ),
                "location": "Fort Bragg, NC",
                "value": "385000",
                "currency": "USD",
                "posted": today - timedelta(days=8),
                "closing": today + timedelta(days=28),
                "category": "Window Coverings",
                "source_url": "https://sam.gov/search/?keywords=window%20blinds%20shades&index=opp&is_active=true&sort=-modifiedDate",
            },
            {
                "external_id": "demo-sam-002",
                "title": "Privacy Curtains and Drapery Track Systems — VA Medical Center",
                "org": "Department of Veterans Affairs",
                "desc": (
                    "Procurement of privacy curtains, drapery tracks, and window "
                    "treatments for a VA medical center patient wing. Includes "
                    "cubicle privacy curtain systems, window drapery panels with "
                    "blackout lining, and motorized roller shades. Products must "
                    "comply with NFPA 701 fire standards. "
                    "NOTE: Demonstration entry. Click source link for real VA "
                    "procurement listings on SAM.gov."
                ),
                "location": "Tampa, FL",
                "value": "275000",
                "currency": "USD",
                "posted": today - timedelta(days=5),
                "closing": today + timedelta(days=35),
                "category": "Window Coverings",
                "source_url": "https://sam.gov/search/?keywords=privacy%20curtains%20drapery&index=opp&is_active=true&sort=-modifiedDate",
            },
            {
                "external_id": "demo-sam-003",
                "title": "Interior Furnishings Including Window Coverings — GSA Region 4",
                "org": "General Services Administration",
                "desc": (
                    "Blanket Purchase Agreement for interior furnishings including "
                    "roller shades, vertical blinds, cellular shades, and drapery "
                    "systems for federal office buildings. LEED-compliant and "
                    "energy-efficient products preferred. "
                    "NOTE: Demonstration entry. Click source link to search real "
                    "GSA furnishing contracts on SAM.gov."
                ),
                "location": "Atlanta, GA",
                "value": "520000",
                "currency": "USD",
                "posted": today - timedelta(days=3),
                "closing": today + timedelta(days=42),
                "category": "FF&E",
                "source_url": "https://sam.gov/search/?keywords=interior%20furnishings%20window%20coverings&index=opp&is_active=true&sort=-modifiedDate",
            },
            {
                "external_id": "demo-sam-004",
                "title": "Solar Shades and Light Control — Federal Office Building",
                "org": "General Services Administration",
                "desc": (
                    "Supply and installation of solar shade systems for "
                    "administrative buildings. Includes automated solar shading "
                    "with daylight sensors, blackout shades for secure rooms, and "
                    "manual roller shades for offices. "
                    "NOTE: Demonstration entry. Click source link for real federal "
                    "procurement on SAM.gov."
                ),
                "location": "San Antonio, TX",
                "value": "210000",
                "currency": "USD",
                "posted": today - timedelta(days=6),
                "closing": today + timedelta(days=30),
                "category": "Window Coverings",
                "source_url": "https://sam.gov/search/?keywords=solar%20shades%20window&index=opp&is_active=true&sort=-modifiedDate",
            },
            {
                "external_id": "demo-sam-005",
                "title": "Window Treatments — Public Housing Rehabilitation",
                "org": "Department of Housing and Urban Development",
                "desc": (
                    "Supply and installation of window treatments for public "
                    "housing rehabilitation. Includes vinyl vertical blinds, "
                    "cellular shades, and roller shades for residential units. "
                    "Products must meet FHA durability requirements. "
                    "NOTE: Demonstration entry. Click source link for real HUD "
                    "procurement on SAM.gov."
                ),
                "location": "Chicago, IL",
                "value": "185000",
                "currency": "USD",
                "posted": today - timedelta(days=4),
                "closing": today + timedelta(days=25),
                "category": "Window Coverings",
                "source_url": "https://sam.gov/search/?keywords=window%20treatments%20housing&index=opp&is_active=true&sort=-modifiedDate",
            },
            {
                "external_id": "demo-sam-006",
                "title": "Classroom Blinds Replacement — Federal School Facilities",
                "org": "Department of Education",
                "desc": (
                    "Replacement of window blinds in federally-funded schools. "
                    "Current mini-blinds to be replaced with cordless roller "
                    "shades meeting child safety standards. Energy-efficient "
                    "fabrics required. "
                    "NOTE: Demonstration entry. Click source link for real "
                    "education procurement on SAM.gov."
                ),
                "location": "Washington, DC",
                "value": "142000",
                "currency": "USD",
                "posted": today - timedelta(days=7),
                "closing": today + timedelta(days=21),
                "category": "Window Coverings",
                "source_url": "https://sam.gov/search/?keywords=blinds%20replacement%20school&index=opp&is_active=true&sort=-modifiedDate",
            },
            {
                "external_id": "demo-sam-007",
                "title": "FF&E Procurement — Federal Courthouse Renovation",
                "org": "US Marshals Service",
                "desc": (
                    "Furniture, fixtures, and equipment for courthouse renovation. "
                    "Includes courtroom drapery, office roller shades, and lobby "
                    "sheer panels. Custom motorized drapery systems for courtrooms. "
                    "NOTE: Demonstration entry. Click source link for real federal "
                    "courthouse procurement on SAM.gov."
                ),
                "location": "Miami, FL",
                "value": "340000",
                "currency": "USD",
                "posted": today - timedelta(days=2),
                "closing": today + timedelta(days=45),
                "category": "FF&E",
                "source_url": "https://sam.gov/search/?keywords=FF%26E%20furnishings%20courthouse&index=opp&is_active=true&sort=-modifiedDate",
            },
        ]

        for item in listings:
            opps.append(self._to_opportunity(item))

        self.logger.info("Generated %d SAM.gov demo opportunities", len(opps))
        return opps

    def _to_opportunity(self, item: dict) -> OpportunityCreate:
        return OpportunityCreate(
            source_id=self.source_config.id,
            external_id=item["external_id"],
            title=item["title"],
            description_summary=item["desc"][:200] + "...",
            description_full=item["desc"],
            status=OpportunityStatus.OPEN,
            country="US",
            location_raw=item.get("location", ""),
            posted_date=item.get("posted"),
            closing_date=datetime.combine(
                item["closing"], datetime.min.time(), tzinfo=timezone.utc
            ).replace(hour=16),
            category=item.get("category", "Window Coverings"),
            estimated_value=Decimal(item["value"]) if item.get("value") else None,
            currency=item.get("currency", "USD"),
            source_url=item["source_url"],
            has_documents=False,
            organization_name=item.get("org"),
            raw_data={"demo": True, "original_data": item},
            fingerprint="",
        )


class CanadianFederalCrawler(BaseCrawler):
    """Adapter for Canadian federal procurement (buyandsell.gc.ca).

    All source_url values point to real, working pages on buyandsell.gc.ca —
    the official Government of Canada procurement portal.
    """

    def crawl(self) -> list[OpportunityCreate]:
        self.logger.info("Generating Canadian federal demo opportunities")
        today = date.today()
        opps: list[OpportunityCreate] = []

        listings = [
            {
                "external_id": "demo-ca-001",
                "title": "Window Coverings Supply — Government Office Renovation",
                "org": "Public Services and Procurement Canada",
                "desc": (
                    "Supply and installation of window coverings for government "
                    "office renovation. Requirements include drapery systems for "
                    "offices, motorized roller shades for meeting rooms, and solar "
                    "shading for glass atriums. "
                    "NOTE: Demonstration entry. Click source link to browse real "
                    "Canadian federal procurement on buyandsell.gc.ca."
                ),
                "location": "Ottawa, ON",
                "value": "780000",
                "currency": "CAD",
                "posted": today - timedelta(days=6),
                "closing": today + timedelta(days=32),
                "category": "Window Coverings",
                "source_url": "https://buyandsell.gc.ca/procurement-data/search/site?search_text=window+coverings+blinds",
            },
            {
                "external_id": "demo-ca-002",
                "title": "Blinds and Window Treatments — Military Base",
                "org": "Department of National Defence",
                "desc": (
                    "Replacement of window blinds and treatments in residential "
                    "quarters and administrative buildings. Scope includes vinyl "
                    "vertical blinds, roller shades, and blackout curtains. "
                    "NOTE: Demonstration entry. Click source link to search real "
                    "DND procurement on buyandsell.gc.ca."
                ),
                "location": "Trenton, ON",
                "value": "165000",
                "currency": "CAD",
                "posted": today - timedelta(days=9),
                "closing": today + timedelta(days=20),
                "category": "Window Coverings",
                "source_url": "https://buyandsell.gc.ca/procurement-data/search/site?search_text=blinds+window+treatments",
            },
            {
                "external_id": "demo-ca-003",
                "title": "Interior Furnishings Including Drapery — Training Facility",
                "org": "Royal Canadian Mounted Police",
                "desc": (
                    "Procurement of interior furnishings for a training facility. "
                    "Window coverings component: roller blinds for classrooms, "
                    "blackout shades for dormitories, privacy curtains for medical "
                    "examination rooms. "
                    "NOTE: Demonstration entry. Click source link for real RCMP "
                    "procurement on buyandsell.gc.ca."
                ),
                "location": "Regina, SK",
                "value": "95000",
                "currency": "CAD",
                "posted": today - timedelta(days=4),
                "closing": today + timedelta(days=28),
                "category": "FF&E",
                "source_url": "https://buyandsell.gc.ca/procurement-data/search/site?search_text=interior+furnishings+drapery",
            },
            {
                "external_id": "demo-ca-004",
                "title": "Privacy Curtains — Health Canada Laboratory",
                "org": "Health Canada",
                "desc": (
                    "Supply of antimicrobial privacy curtains and ceiling track "
                    "systems for a clinical research wing. Includes cubicle curtain "
                    "assemblies, drapery track systems, and solar shades. "
                    "NOTE: Demonstration entry. Click source link for real Health "
                    "Canada procurement on buyandsell.gc.ca."
                ),
                "location": "Ottawa, ON",
                "value": "120000",
                "currency": "CAD",
                "posted": today - timedelta(days=3),
                "closing": today + timedelta(days=35),
                "category": "Window Coverings",
                "source_url": "https://buyandsell.gc.ca/procurement-data/search/site?search_text=privacy+curtains+hospital",
            },
        ]

        for item in listings:
            opps.append(self._to_opportunity(item))

        self.logger.info("Generated %d Canadian federal demo opportunities", len(opps))
        return opps

    def _to_opportunity(self, item: dict) -> OpportunityCreate:
        return OpportunityCreate(
            source_id=self.source_config.id,
            external_id=item["external_id"],
            title=item["title"],
            description_summary=item["desc"][:200] + "...",
            description_full=item["desc"],
            status=OpportunityStatus.OPEN,
            country="CA",
            location_raw=item.get("location", ""),
            posted_date=item.get("posted"),
            closing_date=datetime.combine(
                item["closing"], datetime.min.time(), tzinfo=timezone.utc
            ).replace(hour=16),
            category=item.get("category", "Window Coverings"),
            estimated_value=Decimal(item["value"]) if item.get("value") else None,
            currency=item.get("currency", "CAD"),
            source_url=item["source_url"],
            has_documents=False,
            organization_name=item.get("org"),
            raw_data={"demo": True, "original_data": item},
            fingerprint="",
        )


class MunicipalCrawler(BaseCrawler):
    """Adapter for Canadian and US municipal procurement portals.

    All source_url values point to real, working municipal procurement pages.
    """

    def crawl(self) -> list[OpportunityCreate]:
        self.logger.info("Generating municipal demo opportunities")
        today = date.today()
        opps: list[OpportunityCreate] = []

        listings = [
            {
                "external_id": "demo-mun-001",
                "title": "Roller Shades and Motorized Blinds — Public Library Branches",
                "org": "City of Toronto",
                "desc": (
                    "Supply and installation of roller shades and motorized blinds "
                    "for public library branches undergoing accessibility upgrades. "
                    "Light-filtering roller shades, motorized blackout shades for AV "
                    "rooms, and child-safe cordless blinds. "
                    "NOTE: Demonstration entry. Click source link to browse real "
                    "City of Toronto procurement listings."
                ),
                "location": "Toronto, ON",
                "country": "CA",
                "value": "225000",
                "currency": "CAD",
                "posted": today - timedelta(days=5),
                "closing": today + timedelta(days=30),
                "category": "Window Coverings",
                "source_url": "https://www.toronto.ca/business-economy/doing-business-with-the-city/searching-bidding-on-city-contracts/",
            },
            {
                "external_id": "demo-mun-002",
                "title": "Window Coverings — Community Centre Renovations",
                "org": "City of Vancouver",
                "desc": (
                    "Supply of window coverings for community centres undergoing "
                    "seismic upgrades. Includes roller shades, vertical blinds, "
                    "and blackout curtains. "
                    "NOTE: Demonstration entry. Click source link to browse real "
                    "City of Vancouver bid opportunities."
                ),
                "location": "Vancouver, BC",
                "country": "CA",
                "value": "175000",
                "currency": "CAD",
                "posted": today - timedelta(days=7),
                "closing": today + timedelta(days=25),
                "category": "Window Coverings",
                "source_url": "https://bids.vancouver.ca/bidopp/openBids.htm",
            },
            {
                "external_id": "demo-mun-003",
                "title": "Classroom Blinds Replacement — School District",
                "org": "Los Angeles Unified School District",
                "desc": (
                    "Replacement of classroom window blinds across elementary "
                    "schools. Cordless roller shades meeting California Title 24 "
                    "energy efficiency and CPSC child safety standards. "
                    "NOTE: Demonstration entry. Click source link to browse real "
                    "LA County bid opportunities."
                ),
                "location": "Los Angeles, CA",
                "country": "US",
                "value": "680000",
                "currency": "USD",
                "posted": today - timedelta(days=3),
                "closing": today + timedelta(days=40),
                "category": "Window Coverings",
                "source_url": "https://camisvr.co.la.ca.us/lacobids/BidLookUp/BidOpenList.aspx",
            },
            {
                "external_id": "demo-mun-004",
                "title": "Interior Renovation Including Window Treatments — Senior Centers",
                "org": "NYC Department of Design and Construction",
                "desc": (
                    "Interior renovation of senior centers including flooring, "
                    "lighting, and window treatments. Window covering component: "
                    "solar shades, privacy curtains, and vertical blinds. "
                    "NOTE: Demonstration entry. Click source link to browse real "
                    "NYC City Record procurement notices."
                ),
                "location": "New York, NY",
                "country": "US",
                "value": "1200000",
                "currency": "USD",
                "posted": today - timedelta(days=8),
                "closing": today + timedelta(days=33),
                "category": "Renovation",
                "source_url": "https://a856-cityrecord.nyc.gov/Section/2",
            },
            {
                "external_id": "demo-mun-005",
                "title": "Motorized Window Coverings — Convention Centre Expansion",
                "org": "City of Calgary",
                "desc": (
                    "Motorized window covering systems for convention centre "
                    "expansion. Automated solar shading for exhibition halls, "
                    "motorized blackout drapery for breakout rooms. "
                    "NOTE: Demonstration entry. Click source link to browse real "
                    "City of Calgary procurement."
                ),
                "location": "Calgary, AB",
                "country": "CA",
                "value": "450000",
                "currency": "CAD",
                "posted": today - timedelta(days=2),
                "closing": today + timedelta(days=38),
                "category": "Window Coverings",
                "source_url": "https://www.calgary.ca/business/selling-to-the-city/current-opportunities.html",
            },
        ]

        for item in listings:
            opps.append(self._to_opportunity(item))

        self.logger.info("Generated %d municipal demo opportunities", len(opps))
        return opps

    def _to_opportunity(self, item: dict) -> OpportunityCreate:
        country = item.get("country", self.source_config.country)
        return OpportunityCreate(
            source_id=self.source_config.id,
            external_id=item["external_id"],
            title=item["title"],
            description_summary=item["desc"][:200] + "...",
            description_full=item["desc"],
            status=OpportunityStatus.OPEN,
            country=country,
            location_raw=item.get("location", ""),
            posted_date=item.get("posted"),
            closing_date=datetime.combine(
                item["closing"], datetime.min.time(), tzinfo=timezone.utc
            ).replace(hour=16),
            category=item.get("category", "Window Coverings"),
            estimated_value=Decimal(item["value"]) if item.get("value") else None,
            currency=item.get("currency", "USD"),
            source_url=item["source_url"],
            has_documents=False,
            organization_name=item.get("org"),
            raw_data={"demo": True, "original_data": item},
            fingerprint="",
        )


class SchoolBoardCrawler(BaseCrawler):
    """Adapter for school board procurement portals.

    All source_url values point to real school board procurement pages.
    """

    def crawl(self) -> list[OpportunityCreate]:
        self.logger.info("Generating school board demo opportunities")
        today = date.today()
        opps: list[OpportunityCreate] = []

        listings = [
            {
                "external_id": "demo-school-001",
                "title": "Window Blinds Replacement — Summer Renovation Program",
                "org": "Toronto District School Board",
                "desc": (
                    "Supply and installation of replacement window blinds for "
                    "schools as part of the summer renovation program. Cordless "
                    "roller shades meeting Ontario Fire Code and child safety "
                    "standards. "
                    "NOTE: Demonstration entry. Click source link to browse real "
                    "TDSB procurement opportunities."
                ),
                "location": "Toronto, ON",
                "value": "310000",
                "currency": "CAD",
                "posted": today - timedelta(days=4),
                "closing": today + timedelta(days=22),
                "category": "Window Coverings",
                "source_url": "https://www.tdsb.on.ca/About-Us/Facility-Services/Procurement",
            },
            {
                "external_id": "demo-school-002",
                "title": "Solar Shades — New School Construction",
                "org": "Peel District School Board",
                "desc": (
                    "Supply of solar shades for new elementary schools. "
                    "Light-filtering solar shades for classrooms, blackout shades "
                    "for media rooms, and motorized shades for gymnasia. "
                    "NOTE: Demonstration entry. Click source link to browse real "
                    "Peel DSB procurement."
                ),
                "location": "Mississauga, ON",
                "value": "240000",
                "currency": "CAD",
                "posted": today - timedelta(days=6),
                "closing": today + timedelta(days=26),
                "category": "Window Coverings",
                "source_url": "https://www.peelschools.org/procurement",
            },
            {
                "external_id": "demo-school-003",
                "title": "Zebra Blinds and Sheer Shades — School Window Upgrades",
                "org": "York Region District School Board",
                "desc": (
                    "Dual-layer zebra blinds and sheer shade systems for schools "
                    "receiving window upgrades. Anti-static fabric, UL-rated "
                    "components, cordless child-safe operation. "
                    "NOTE: Demonstration entry. Click source link to browse real "
                    "YRDSB procurement."
                ),
                "location": "Newmarket, ON",
                "value": "195000",
                "currency": "CAD",
                "posted": today - timedelta(days=5),
                "closing": today + timedelta(days=30),
                "category": "Window Coverings",
                "source_url": "https://www.yrdsb.ca/AboutUs/Departments/Pages/Procurement-Services.aspx",
            },
        ]

        for item in listings:
            opps.append(self._to_opportunity(item))

        self.logger.info("Generated %d school board demo opportunities", len(opps))
        return opps

    def _to_opportunity(self, item: dict) -> OpportunityCreate:
        return OpportunityCreate(
            source_id=self.source_config.id,
            external_id=item["external_id"],
            title=item["title"],
            description_summary=item["desc"][:200] + "...",
            description_full=item["desc"],
            status=OpportunityStatus.OPEN,
            country="CA",
            location_raw=item.get("location", ""),
            posted_date=item.get("posted"),
            closing_date=datetime.combine(
                item["closing"], datetime.min.time(), tzinfo=timezone.utc
            ).replace(hour=16),
            category=item.get("category", "Window Coverings"),
            estimated_value=Decimal(item["value"]) if item.get("value") else None,
            currency=item.get("currency", "CAD"),
            source_url=item["source_url"],
            has_documents=False,
            organization_name=item.get("org"),
            raw_data={"demo": True, "original_data": item},
            fingerprint="",
        )


class HousingAuthorityCrawler(BaseCrawler):
    """Adapter for housing authority bid portals.

    All source_url values point to real housing authority pages.
    """

    def crawl(self) -> list[OpportunityCreate]:
        self.logger.info("Generating housing authority demo opportunities")
        today = date.today()
        opps: list[OpportunityCreate] = []

        listings = [
            {
                "external_id": "demo-housing-001",
                "title": "Vertical Blinds Replacement — Community Housing",
                "org": "Toronto Community Housing Corporation",
                "desc": (
                    "Replacement vertical blinds for residential high-rise "
                    "buildings. Standard sizes for living rooms and bedrooms, "
                    "plus custom sizes for balcony doors. "
                    "NOTE: Demonstration entry. Click source link to browse real "
                    "TCHC procurement opportunities."
                ),
                "location": "Toronto, ON",
                "country": "CA",
                "value": "155000",
                "currency": "CAD",
                "posted": today - timedelta(days=7),
                "closing": today + timedelta(days=18),
                "category": "Window Coverings",
                "source_url": "https://www.torontohousing.ca/doing-business/procurement-opportunities",
            },
            {
                "external_id": "demo-housing-002",
                "title": "Window Coverings — New Supportive Housing Development",
                "org": "BC Housing",
                "desc": (
                    "Supply and installation of window coverings for new supportive "
                    "housing developments. Bedroom roller shades (blackout), living "
                    "room roller shades (light-filtering), and bathroom cellular "
                    "shades (moisture-resistant). "
                    "NOTE: Demonstration entry. Click source link to browse real "
                    "BC Housing procurement."
                ),
                "location": "Vancouver, BC",
                "country": "CA",
                "value": "195000",
                "currency": "CAD",
                "posted": today - timedelta(days=3),
                "closing": today + timedelta(days=27),
                "category": "Window Coverings",
                "source_url": "https://www.bchousing.org/about/procurement",
            },
            {
                "external_id": "demo-housing-003",
                "title": "Window Blinds — Apartment Rehabilitation Program",
                "org": "New York City Housing Authority",
                "desc": (
                    "Supply and installation of window blinds for apartment "
                    "rehabilitation. Vinyl mini-blinds for bedrooms and kitchens, "
                    "roller shades for living rooms. Lead-free, child-safe products "
                    "required. "
                    "NOTE: Demonstration entry. Click source link to browse real "
                    "NYCHA procurement opportunities."
                ),
                "location": "New York, NY",
                "country": "US",
                "value": "420000",
                "currency": "USD",
                "posted": today - timedelta(days=5),
                "closing": today + timedelta(days=35),
                "category": "Window Coverings",
                "source_url": "https://www.nyc.gov/site/nycha/business/procurement.page",
            },
        ]

        for item in listings:
            opps.append(self._to_opportunity(item))

        self.logger.info("Generated %d housing authority demo opportunities", len(opps))
        return opps

    def _to_opportunity(self, item: dict) -> OpportunityCreate:
        country = item.get("country", self.source_config.country)
        return OpportunityCreate(
            source_id=self.source_config.id,
            external_id=item["external_id"],
            title=item["title"],
            description_summary=item["desc"][:200] + "...",
            description_full=item["desc"],
            status=OpportunityStatus.OPEN,
            country=country,
            location_raw=item.get("location", ""),
            posted_date=item.get("posted"),
            closing_date=datetime.combine(
                item["closing"], datetime.min.time(), tzinfo=timezone.utc
            ).replace(hour=16),
            category=item.get("category", "Window Coverings"),
            estimated_value=Decimal(item["value"]) if item.get("value") else None,
            currency=item.get("currency", "USD"),
            source_url=item["source_url"],
            has_documents=False,
            organization_name=item.get("org"),
            raw_data={"demo": True, "original_data": item},
            fingerprint="",
        )


CRAWLER_REGISTRY: dict[str, type[BaseCrawler]] = {
    "sam_gov": SamGovCrawler,
    "canadian_federal": CanadianFederalCrawler,
    "municipal": MunicipalCrawler,
    "school_board": SchoolBoardCrawler,
    "housing_authority": HousingAuthorityCrawler,
}
