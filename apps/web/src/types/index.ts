export type OpportunityStatus =
  | "open"
  | "closed"
  | "awarded"
  | "cancelled"
  | "archived"
  | "unknown";

export type SourceType =
  | "bid_portal"
  | "municipal"
  | "school_board"
  | "housing_authority"
  | "university"
  | "hospital"
  | "construction"
  | "aggregator"
  | "other";

export type RunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type CrawlFrequency = "hourly" | "daily" | "weekly" | "manual";

export type OrgType =
  | "government"
  | "education"
  | "healthcare"
  | "housing"
  | "commercial"
  | "non_profit"
  | "other";

export interface OpportunityFilters {
  keyword?: string;
  status?: OpportunityStatus;
  country?: string;
  region?: string;
  city?: string;
  organization?: string;
  source?: string;
  category?: string;
  postedAfter?: string;
  postedBefore?: string;
  closingAfter?: string;
  closingBefore?: string;
  minRelevance?: number;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface DashboardStats {
  totalOpportunities: number;
  openOpportunities: number;
  closingThisWeek: number;
  highRelevanceLeads: number;
  recentOpportunities: OpportunitySummary[];
}

export interface OpportunitySummary {
  id: string;
  title: string;
  status: OpportunityStatus;
  organization?: string;
  country?: string;
  region?: string;
  city?: string;
  category?: string;
  postedDate?: string;
  closingDate?: string;
  relevanceScore: number;
  sourceUrl: string;
  sourceName: string;
  estimatedValue?: number;
  currency?: string;
}

export interface OpportunityDetail extends OpportunitySummary {
  externalId?: string;
  descriptionSummary?: string;
  descriptionFull?: string;
  locationRaw?: string;
  projectType?: string;
  solicitationNumber?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  hasDocuments: boolean;
  mandatorySiteVisit?: string;
  preBidMeeting?: string;
  addendaCount: number;
  keywordsMatched: string[];
  relevanceBreakdown: Record<string, number>;
  documents: DocumentItem[];
  notes: NoteItem[];
  tags: string[];
}

export interface DocumentItem {
  id: string;
  title?: string;
  url: string;
  fileType?: string;
  fileSizeBytes?: number;
}

export interface NoteItem {
  id: string;
  content: string;
  userName: string;
  createdAt: string;
  updatedAt: string;
}

export interface SourceItem {
  id: string;
  name: string;
  sourceType: SourceType;
  baseUrl: string;
  country: string;
  region?: string;
  frequency: CrawlFrequency;
  isActive: boolean;
  lastCrawledAt?: string;
  lastRunStatus?: RunStatus;
  categoryTags: string[];
}

export interface CrawlLogEntry {
  id: string;
  sourceName: string;
  sourceId: string;
  status: RunStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  pagesCrawled: number;
  opportunitiesFound: number;
  opportunitiesCreated: number;
  opportunitiesUpdated: number;
  errorMessage?: string;
  triggeredBy: string;
  createdAt: string;
}

export interface SavedSearch {
  id: string;
  name: string;
  filters: Record<string, string | number>;
  notify: boolean;
  resultCount?: number;
  createdAt: string;
  updatedAt: string;
}
