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

export type SourcePriority =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "experimental";

export type SourceHealthStatus =
  | "healthy"
  | "degraded"
  | "failing"
  | "unsupported"
  | "untested";

export type OrgType =
  | "government"
  | "education"
  | "healthcare"
  | "housing"
  | "commercial"
  | "non_profit"
  | "other";

export type RelevanceBucket =
  | "highly_relevant"
  | "moderately_relevant"
  | "low_relevance"
  | "irrelevant";

export type WorkflowStatus =
  | "new"
  | "hot"
  | "review"
  | "shortlisted"
  | "pursuing"
  | "passed"
  | "not_relevant"
  | "monitor";

export interface OpportunityFilters {
  keyword?: string;
  status?: OpportunityStatus;
  workflow?: WorkflowStatus;
  country?: string;
  region?: string;
  city?: string;
  organization?: string;
  source?: string;
  category?: string;
  bucket?: RelevanceBucket | "relevant";
  tag?: string;
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
  newLast24h: number;
  recentOpportunities: OpportunitySummary[];
  bucketDistribution?: {
    highly_relevant: number;
    moderately_relevant: number;
    low_relevance: number;
    irrelevant: number;
  };
  workflowDistribution?: Record<WorkflowStatus, number>;
  topSources?: { name: string; relevant: number; total: number }[];
  sourceNetwork?: {
    totalSources: number;
    activeSources: number;
    priorityCounts: Record<string, number>;
    healthCounts: Record<string, number>;
    crawlRunsLast24h: number;
    totalCrawlRuns: number;
  };
  intelligence?: {
    analyzedCount: number;
    pursueCount: number;
    reviewCount: number;
    skipCount: number;
    avgFeasibility: number;
  };
  lastCrawlRun?: {
    id: string;
    sourceName: string;
    status: RunStatus;
    startedAt: string | null;
    completedAt: string | null;
    opportunitiesFound: number;
    opportunitiesCreated: number;
    errorMessage: string | null;
    triggeredBy: string;
  } | null;
}

export interface OpportunitySummary {
  id: string;
  title: string;
  status: OpportunityStatus;
  workflowStatus: WorkflowStatus;
  organization?: string;
  country?: string;
  region?: string;
  city?: string;
  category?: string;
  postedDate?: string;
  closingDate?: string;
  relevanceScore: number;
  relevanceBucket: RelevanceBucket;
  keywordsMatched: string[];
  industryTags: string[];
  sourceUrl: string;
  sourceName: string;
  estimatedValue?: number;
  currency?: string;
  hasIntelligence?: boolean;
  recommendationStatus?: string;
  feasibilityScore?: number;
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
  negativeKeywords: string[];
  relevanceBreakdown: Record<string, unknown>;
  businessFitExplanation?: string;
  workflowNote?: string;
  workflowUpdatedAt?: string;
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
  listingPath?: string;
  country: string;
  region?: string;
  frequency: CrawlFrequency;
  isActive: boolean;
  lastCrawledAt?: string;
  lastRunStatus?: RunStatus;
  categoryTags: string[];
  industryFitScore: number;
  sourcePriority: SourcePriority;
  healthStatus: SourceHealthStatus;
  totalOpportunities: number;
  relevantOpportunities: number;
  highlyRelevantCount: number;
  sourceYieldPct: number;
  totalCrawlRuns: number;
  successfulCrawlRuns: number;
  failedCrawlRuns: number;
  avgCrawlDurationMs: number;
  yieldAnalyticsUpdatedAt?: string;
  lastCrawlSuccess: boolean;
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

// ─── AI Intelligence types ───

export interface IntelligenceFeasibility {
  feasibility_score?: number;
  recommendation?: string;
  business_fit_explanation?: string;
  key_concerns?: string[];
  key_advantages?: string[];
}

export interface IntelligenceChinaSourcing {
  viable?: boolean;
  explanation?: string;
  restrictions?: string[];
  lead_time_concern?: string;
}

export interface IntelligenceWCR {
  is_relevant?: boolean;
  relevance_explanation?: string;
  specific_products?: string[];
  estimated_scope_percentage?: number;
}

export interface IntelligenceTechReqs {
  materials?: string[];
  measurements?: string;
  compliance?: string[];
  specialized_needs?: string[];
}

export interface IntelligenceQualReqs {
  experience_years?: string;
  certifications?: string[];
  insurance_min?: string;
  labor_requirements?: string;
  bonding?: string;
  security_clearance?: string;
  other?: string[];
}

export interface IntelligenceDates {
  posting_date?: string | null;
  closing_date?: string | null;
  site_visit_date?: string | null;
  pre_bid_meeting?: string | null;
  project_start?: string | null;
  project_completion?: string | null;
  timeline_notes?: string;
}

export interface IntelligenceSummary {
  one_line_verdict?: string;
  project_overview?: string;
  scope_of_work?: string;
  scope_type?: string;
  technical_requirements?: IntelligenceTechReqs;
  qualification_requirements?: IntelligenceQualReqs;
  critical_dates?: IntelligenceDates;
  risk_factors?: string[];
  feasibility_assessment?: IntelligenceFeasibility;
  window_covering_relevance?: IntelligenceWCR;
  china_sourcing_analysis?: IntelligenceChinaSourcing;
  recommended_action?: string;
}

export interface TenderIntelligence {
  id?: string;
  opportunityId?: string;
  projectOverview?: string;
  project_overview?: string;
  scopeOfWork?: string;
  scope_of_work?: string;
  scopeType?: string;
  scope_type?: string;
  technicalRequirements?: IntelligenceTechReqs;
  technical_requirements?: IntelligenceTechReqs;
  qualificationReqs?: IntelligenceQualReqs;
  qualification_reqs?: IntelligenceQualReqs;
  criticalDates?: IntelligenceDates;
  critical_dates?: IntelligenceDates;
  riskFactors?: string[];
  risk_factors?: string[];
  feasibilityScore?: number;
  feasibility_score?: number;
  recommendationStatus?: string;
  recommendation_status?: string;
  businessFitExplanation?: string;
  business_fit_explanation?: string;
  chinaSourceAnalysis?: IntelligenceChinaSourcing | string;
  china_source_analysis?: IntelligenceChinaSourcing | string;
  intelligenceSummary?: IntelligenceSummary;
  intelligence_summary?: IntelligenceSummary;
  analysisModel?: string;
  analysis_model?: string;
  analyzedAt?: string;
  analyzed_at?: string;
}

export interface IntelligenceResponse {
  opportunity: Record<string, unknown>;
  intelligence: TenderIntelligence | null;
  documents: Array<{
    id: string;
    title?: string;
    url: string;
    fileType?: string;
    fileSizeBytes?: number;
    pageCount?: number;
    downloadedAt?: string;
    docCategory?: string;
    textExtracted?: boolean;
  }>;
}

export interface SavedSearch {
  id: string;
  name: string;
  filters: Record<string, string | number>;
  notifyEnabled?: boolean;
  resultCount?: number;
  createdAt: string;
  updatedAt?: string;
}
