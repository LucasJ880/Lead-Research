"""Pydantic models for opportunities, source configs, and crawl results."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


# ─── Enums ──────────────────────────────────────────────────


class SourceType(str, Enum):
    BID_PORTAL = "bid_portal"
    MUNICIPAL = "municipal"
    SCHOOL_BOARD = "school_board"
    HOUSING_AUTHORITY = "housing_authority"
    UNIVERSITY = "university"
    HOSPITAL = "hospital"
    CONSTRUCTION = "construction"
    AGGREGATOR = "aggregator"
    OTHER = "other"


class CrawlFrequency(str, Enum):
    HOURLY = "hourly"
    DAILY = "daily"
    WEEKLY = "weekly"
    MANUAL = "manual"


class OpportunityStatus(str, Enum):
    OPEN = "open"
    CLOSED = "closed"
    AWARDED = "awarded"
    CANCELLED = "cancelled"
    ARCHIVED = "archived"
    UNKNOWN = "unknown"


class RunStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TriggerType(str, Enum):
    SCHEDULE = "schedule"
    MANUAL = "manual"
    RETRY = "retry"
    LOCAL_AGENT = "local_agent"


# ─── Source Config ──────────────────────────────────────────


class AccessMode(str, Enum):
    HTTP = "http"
    API = "api"
    AUTHENTICATED_HTTP = "authenticated_http"
    BROWSER = "browser"
    LOCAL_CONNECTOR = "local_authenticated_connector"


class SourceConfig(BaseModel):
    """Configuration for a crawl source."""

    id: str
    name: str
    source_type: SourceType
    base_url: str
    country: str = Field(max_length=2)
    region: str | None = None
    city: str | None = None
    crawl_config: dict[str, Any] = Field(default_factory=dict)
    access_mode: AccessMode = AccessMode.HTTP
    frequency: CrawlFrequency = CrawlFrequency.DAILY
    is_active: bool = True
    category_tags: list[str] = Field(default_factory=list)
    industry_fit_score: int = 50
    source_priority: str = "medium"
    listing_path: str | None = None


# ─── Opportunity Create / Update ────────────────────────────


class OpportunityCreate(BaseModel):
    """All fields needed to insert a new opportunity row."""

    source_id: str
    source_run_id: str | None = None
    organization_id: str | None = None
    external_id: str | None = None
    title: str
    description_summary: str | None = None
    description_full: str | None = None
    status: OpportunityStatus = OpportunityStatus.UNKNOWN
    country: str | None = None
    region: str | None = None
    city: str | None = None
    location_raw: str | None = None
    posted_date: date | None = None
    closing_date: datetime | None = None
    project_type: str | None = None
    category: str | None = None
    solicitation_number: str | None = None
    estimated_value: Decimal | None = None
    currency: str = "USD"
    contact_name: str | None = None
    contact_email: str | None = None
    contact_phone: str | None = None
    source_url: str
    has_documents: bool = False
    mandatory_site_visit: str | None = None
    pre_bid_meeting: str | None = None
    addenda_count: int = 0
    keywords_matched: list[str] = Field(default_factory=list)
    negative_keywords: list[str] = Field(default_factory=list)
    relevance_score: int = 0
    relevance_bucket: str = "irrelevant"
    relevance_breakdown: dict[str, Any] = Field(default_factory=dict)
    industry_tags: list[str] = Field(default_factory=list)
    raw_data: dict[str, Any] | None = None
    fingerprint: str

    # Org name carried through the pipeline for resolution
    organization_name: str | None = None


class OpportunityUpdate(BaseModel):
    """Partial update — every field is optional."""

    source_run_id: str | None = None
    organization_id: str | None = None
    external_id: str | None = None
    title: str | None = None
    description_summary: str | None = None
    description_full: str | None = None
    status: OpportunityStatus | None = None
    country: str | None = None
    region: str | None = None
    city: str | None = None
    location_raw: str | None = None
    posted_date: date | None = None
    closing_date: datetime | None = None
    project_type: str | None = None
    category: str | None = None
    solicitation_number: str | None = None
    estimated_value: Decimal | None = None
    currency: str | None = None
    contact_name: str | None = None
    contact_email: str | None = None
    contact_phone: str | None = None
    source_url: str | None = None
    has_documents: bool | None = None
    mandatory_site_visit: str | None = None
    pre_bid_meeting: str | None = None
    addenda_count: int | None = None
    keywords_matched: list[str] | None = None
    relevance_score: int | None = None
    relevance_breakdown: dict[str, Any] | None = None
    raw_data: dict[str, Any] | None = None
    fingerprint: str | None = None


# ─── Crawl Result ───────────────────────────────────────────


class CrawlResult(BaseModel):
    """Summary returned after a crawl run completes."""

    source_id: str
    opportunities_found: int = 0
    opportunities_created: int = 0
    opportunities_updated: int = 0
    opportunities_skipped: int = 0
    errors: list[str] = Field(default_factory=list)
    pages_crawled: int = 0


# ─── Agent Sync Models ──────────────────────────────────────


class AgentJobResponse(BaseModel):
    """A pending crawl job for the local agent to pick up."""
    run_id: str
    source_id: str
    source_name: str
    base_url: str
    crawl_config: dict[str, Any] = Field(default_factory=dict)
    access_mode: str = "local_authenticated_connector"


class AgentStatusUpdate(BaseModel):
    """Status report from the local agent."""
    run_id: str
    status: RunStatus
    pages_crawled: int = 0
    opportunities_found: int = 0
    opportunities_created: int = 0
    opportunities_updated: int = 0
    opportunities_skipped: int = 0
    error_message: str | None = None
    error_details: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class AgentOpportunityUpload(BaseModel):
    """Batch of opportunities uploaded by the local agent."""
    run_id: str
    source_id: str
    opportunities: list[OpportunityCreate]


class AgentDocumentUpload(BaseModel):
    """Document metadata uploaded by the local agent."""
    opportunity_external_id: str
    source_id: str
    documents: list[dict[str, Any]]
