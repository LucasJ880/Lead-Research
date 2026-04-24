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

export type OpportunityLifecycleState =
  | "active"
  | "closing_soon"
  | "expired";

export type WorkflowStatus =
  | "new"
  | "hot"
  | "review"
  | "shortlisted"
  | "pursuing"
  | "bid_submitted"
  | "won"
  | "lost"
  | "passed"
  | "not_relevant"
  | "monitor"
  | "rfq_sent"
  | "bid_drafted";

export type AccessMode =
  | "api"
  | "http_scrape"
  | "authenticated_browser"
  | "local_connector";

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
  lifecycle?: OpportunityLifecycleState | "actionable" | "watch";
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
  actionableOpportunities?: number;
  expiredOpportunities?: number;
  samSetAsideSkipped24h?: number;
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
  titleZh?: string;
  status: OpportunityStatus;
  workflowStatus: WorkflowStatus;
  organization?: string;
  country?: string;
  region?: string;
  city?: string;
  category?: string;
  postedDate?: string;
  closingDate?: string;
  lifecycleState?: OpportunityLifecycleState;
  setAside?: string;
  setAsideRestricted?: boolean;
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
  analysisMode?: string;
  analysisModel?: string;
  hasQingyanSync?: boolean;
  qingyanProjectId?: string;
}

export interface OpportunityDetail extends OpportunitySummary {
  externalId?: string;
  descriptionSummary?: string;
  descriptionSummaryZh?: string;
  descriptionFull?: string;
  descriptionFullZh?: string;
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
  responseDeadline?: string;
  officeAddress?: string;
  placeOfPerformance?: string;
  department?: string;
  subTier?: string;
  office?: string;
  setAside?: string;
  naicsName?: string;
  classificationName?: string;
  allContacts?: Array<Record<string, string>>;
  documents: DocumentItem[];
  notes: NoteItem[];
  tags: string[];
  qingyanSync?: QingyanSyncInfo;
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
  accessMode: AccessMode;
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
  setAsideSkipped?: number;
  errorMessage?: string;
  triggeredBy: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

// ─── AI Intelligence types (v2.0 report) ───

export interface V2Verdict {
  one_line?: string;
  recommendation?: "pursue" | "review_carefully" | "low_probability" | "skip" | string;
  confidence?: "high" | "medium" | "low" | "very_low" | string;
  confidence_rationale?: string;
}

export interface V2ProjectSummary {
  overview?: string;
  issuing_body?: string;
  project_type?: string;
}

export interface V2ScopeBreakdown {
  main_deliverables?: string[];
  quantities?: string;
  scope_type?: string;
  service_scope?: string;
  intended_use?: string;
}

export interface V2TechnicalRequirements {
  product_requirements?: string[];
  environmental_requirements?: string[];
  installation_requirements?: string[];
  standards_certifications?: string[];
  control_systems?: string;
  specialized_needs?: string[];
}

export interface V2TimelineMilestones {
  bid_closing?: string | null;
  response_due?: string | null;
  site_visit?: string | null;
  pre_bid_meeting?: string | null;
  project_start?: string | null;
  delivery_deadline?: string | null;
  milestone_dates?: string[];
  schedule_pressure?: "realistic" | "moderate" | "tight" | "very_tight" | string;
  schedule_notes?: string;
}

export interface V2EvaluationStrategy {
  pricing_weight?: string;
  technical_weight?: string;
  experience_weight?: string;
  other_criteria?: string[];
  likely_evaluator_focus?: string;
}

export interface V2BusinessFit {
  fit_assessment?: "strong_fit" | "moderate_fit" | "weak_fit" | "poor_fit" | string;
  fit_explanation?: string;
  recommended_role?: string;
  capability_gaps?: string[];
}

export interface V2RedFlag {
  requirement: string;
  severity: "fatal_blocker" | "serious_risk" | "normal_requirement" | string;
  explanation?: string;
}

export interface V2ComplianceRisks {
  red_flags?: V2RedFlag[];
  mandatory_certifications?: string[];
  experience_thresholds?: string;
  bonding_insurance?: string;
  local_requirements?: string;
}

export interface V2CompatibilityAnalysis {
  existing_system?: string;
  brand_compatibility?: string;
  proof_required?: string;
  compatibility_risk?: "none" | "low" | "medium" | "high" | string;
  compatibility_notes?: string;
}

export interface V2SupplyChainFeasibility {
  china_sourcing_viable?: boolean;
  sourcing_explanation?: string;
  buy_domestic_restrictions?: string[];
  shipping_lead_time?: string;
  warehousing_needs?: string;
  import_compliance?: string;
  local_installation?: string;
}

export interface V2ParticipationStrategy {
  recommended_approach?: string;
  strategy_rationale?: string;
  potential_partners?: string;
  competitive_positioning?: string;
}

export interface V2RequiredEvidence {
  before_bidding?: string[];
  with_submission?: string[];
  examples?: string[];
}

export interface V2FeasibilityScores {
  technical_feasibility?: number;
  compliance_feasibility?: number;
  commercial_feasibility?: number;
  overall_score?: number;
  score_rationale?: string;
}

export interface V2IntelligenceReport {
  report_version?: string;
  verdict?: V2Verdict;
  project_summary?: V2ProjectSummary;
  scope_breakdown?: V2ScopeBreakdown;
  technical_requirements?: V2TechnicalRequirements;
  timeline_milestones?: V2TimelineMilestones;
  evaluation_strategy?: V2EvaluationStrategy;
  business_fit?: V2BusinessFit;
  compliance_risks?: V2ComplianceRisks;
  compatibility_analysis?: V2CompatibilityAnalysis;
  supply_chain_feasibility?: V2SupplyChainFeasibility;
  participation_strategy?: V2ParticipationStrategy;
  required_evidence?: V2RequiredEvidence;
  feasibility_scores?: V2FeasibilityScores;
  analysis_model?: string;
  analyzed_at?: string;
  fallback_used?: boolean;
}

export interface TenderIntelligence {
  id?: string;
  opportunityId?: string;
  feasibilityScore?: number;
  feasibility_score?: number;
  recommendationStatus?: string;
  recommendation_status?: string;
  analysisModel?: string;
  analysis_model?: string;
  analysisMode?: string;
  analysis_mode?: string;
  analysisStatus?: string;
  analysis_status?: string;
  analyzedAt?: string;
  analyzed_at?: string;
  intelligenceSummary?: V2IntelligenceReport;
  intelligence_summary?: V2IntelligenceReport;
  projectOverview?: string;
  project_overview?: string;
  businessFitExplanation?: string;
  business_fit_explanation?: string;
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

// ─── Qingyan Integration types ───

export type QingyanSyncStatus = "pending" | "pushing" | "synced" | "failed" | "cancelled";

export interface QingyanSyncInfo {
  id: string;
  syncStatus: QingyanSyncStatus;
  qingyanProjectId?: string;
  qingyanTaskId?: string;
  qingyanUrl?: string;
  qingyanStatus?: string;
  pushedBy?: string;
  pushedByName?: string;
  pushedAt?: string;
  lastSyncAt?: string;
  errorMessage?: string;
  retryCount: number;
}

export interface QingyanPushOptions {
  opportunityId: string;
  createAs: "project" | "task";
  priority: "high" | "medium" | "low";
  assignTo?: string;
  notes?: string;
}

export interface QingyanPushResponse {
  syncId: string;
  status: QingyanSyncStatus;
  qingyanProjectId?: string;
  qingyanUrl?: string;
  pushedAt?: string;
  error?: string;
  retryable?: boolean;
}
