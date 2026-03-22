"""Crawler registry for the LeadHarvest crawl pipeline.

Maps crawler_class keys (stored in source.crawl_config) to BaseCrawler
subclasses.  The default for any source is GenericCrawler, which drives
crawling via CSS selectors stored in the source's crawl_config JSON.

To add a new custom crawler:
  1. Create a subclass of BaseCrawler in a new module under src/crawlers/
  2. Import it here and add an entry to CRAWLER_REGISTRY.
"""

from __future__ import annotations

from src.crawlers.base import BaseCrawler
from src.crawlers.bcbid import BCBidCrawler
from src.crawlers.biddingo import BiddingoCrawler
from src.crawlers.canadabuys import CanadaBuysCrawler
from src.crawlers.generic import GenericCrawler
from src.crawlers.merx import MerxCrawler
from src.crawlers.novascotia import NovaScotiaCrawler
from src.crawlers.sam_gov import SamGovCrawler
from src.crawlers.sasktenders import SaskTendersCrawler
from src.crawlers.vancouver import VancouverCrawler

CRAWLER_REGISTRY: dict[str, type[BaseCrawler]] = {
    "bcbid": BCBidCrawler,
    "biddingo": BiddingoCrawler,
    "canadabuys": CanadaBuysCrawler,
    "generic": GenericCrawler,
    "merx": MerxCrawler,
    "novascotia": NovaScotiaCrawler,
    "sam_gov": SamGovCrawler,
    "sasktenders": SaskTendersCrawler,
    "vancouver": VancouverCrawler,
}
