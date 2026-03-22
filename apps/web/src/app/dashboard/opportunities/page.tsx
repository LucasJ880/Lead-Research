"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams as useNextSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Search,
  SlidersHorizontal,
  Download,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  X,
  Loader2,
  Eye,
  Sparkles,
  FileSearch,
  ChevronDown,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatDate,
  getRelevanceColor,
  getBucketLabel,
  getBucketColor,
} from "@/lib/utils";
import type {
  OpportunitySummary,
  OpportunityStatus,
  PaginatedResponse,
} from "@/types";

const QUICK_FILTERS = [
  "Blinds", "Shades", "Curtains", "Fabric", "Linen", "Bedding",
  "Window Coverings", "FF&E", "Hospitality", "Healthcare", "School",
] as const;

const BUCKET_OPTIONS: { label: string; value: string }[] = [
  { label: "Relevant Only", value: "relevant" },
  { label: "Highly Relevant", value: "highly_relevant" },
  { label: "Moderate", value: "moderately_relevant" },
  { label: "Low Relevance", value: "low_relevance" },
  { label: "Irrelevant", value: "irrelevant" },
  { label: "All Buckets", value: "all" },
];

const SORT_OPTIONS = [
  { label: "Highest Relevance", value: "relevance" },
  { label: "Newest", value: "newest" },
  { label: "Closing Soon", value: "closing_soon" },
];

const STATUS_OPTIONS: { label: string; value: OpportunityStatus | "" }[] = [
  { label: "All Statuses", value: "" },
  { label: "Open", value: "open" },
  { label: "Closed", value: "closed" },
  { label: "Awarded", value: "awarded" },
  { label: "Cancelled", value: "cancelled" },
];

const COUNTRY_OPTIONS = [
  { label: "All Countries", value: "" },
  { label: "Canada", value: "CA" },
  { label: "United States", value: "US" },
];

const WORKFLOW_OPTIONS: { label: string; value: string }[] = [
  { label: "All Stages", value: "" },
  { label: "New", value: "new" },
  { label: "Hot", value: "hot" },
  { label: "Review", value: "review" },
  { label: "Shortlisted", value: "shortlisted" },
  { label: "Pursuing", value: "pursuing" },
  { label: "Monitor", value: "monitor" },
  { label: "Passed", value: "passed" },
  { label: "Not Relevant", value: "not_relevant" },
];

function buildQueryString(params: Record<string, string | number>): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== "" && value !== 0) {
      searchParams.set(key, String(value));
    }
  }
  return searchParams.toString();
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 80 ? "bg-emerald-500" : score >= 60 ? "bg-blue-500" : score >= 40 ? "bg-amber-400" : score >= 20 ? "bg-orange-400" : "bg-slate-300";
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-bold text-tabular w-6 text-right">{score}</span>
      <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

function AnalysisBadge({ opp }: { opp: OpportunitySummary }) {
  if (!opp.hasIntelligence) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-dashed px-2 py-0.5 text-xs text-muted-foreground">
        <Sparkles className="h-3 w-3" /> None
      </span>
    );
  }
  if (opp.analysisMode === "deep") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-xs font-medium text-emerald-700">
        <Sparkles className="h-3 w-3" /> Deep
      </span>
    );
  }
  if (opp.analysisModel === "fallback_rule_based") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-slate-50 border border-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
        <Sparkles className="h-3 w-3" /> Rule
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 border border-blue-200 px-2 py-0.5 text-xs font-medium text-blue-700">
      <Sparkles className="h-3 w-3" /> Quick
    </span>
  );
}

export default function OpportunitiesPageWrapper() {
  return (
    <Suspense fallback={<OpportunitiesLoadingSkeleton />}>
      <OpportunitiesPage />
    </Suspense>
  );
}

function OpportunitiesLoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-8 w-24" />
      </div>
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-[400px] w-full rounded-lg" />
    </div>
  );
}

function OpportunitiesPage() {
  const nextSearchParams = useNextSearchParams();
  const initialWorkflow = nextSearchParams.get("workflow") || "";

  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [countryFilter, setCountryFilter] = useState("");
  const initialBucket = nextSearchParams.get("bucket") || "relevant";
  const initialSort = nextSearchParams.get("sort") || "relevance";
  const [bucketFilter, setBucketFilter] = useState(initialBucket);
  const [workflowFilter, setWorkflowFilter] = useState(initialWorkflow);
  const [tagFilter, setTagFilter] = useState("");
  const [sortBy, setSortBy] = useState(initialSort);
  const [minRelevance, setMinRelevance] = useState(0);
  const [closingAfter, setClosingAfter] = useState("");
  const [closingBefore, setClosingBefore] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [businessFocus, setBusinessFocus] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("bidtogo_business_focus") !== "false";
    }
    return true;
  });

  function toggleBusinessFocus() {
    const next = !businessFocus;
    setBusinessFocus(next);
    localStorage.setItem("bidtogo_business_focus", String(next));
    setPage(1);
  }

  const [data, setData] = useState<PaginatedResponse<OpportunitySummary> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedKeyword(keyword);
      setPage(1);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [keyword]);

  const effectiveBucket = businessFocus ? "relevant" : bucketFilter;

  const fetchOpportunities = useCallback(() => {
    setLoading(true);
    const qs = buildQueryString({
      keyword: debouncedKeyword,
      status: statusFilter,
      workflow: workflowFilter,
      country: countryFilter,
      bucket: effectiveBucket,
      tag: tagFilter,
      minRelevance,
      closingAfter,
      closingBefore,
      sort: sortBy,
      page,
      pageSize,
    });
    fetch(`/api/opportunities?${qs}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load opportunities");
        return res.json();
      })
      .then((result: PaginatedResponse<OpportunitySummary>) => {
        setData(result);
        setError(null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [debouncedKeyword, statusFilter, workflowFilter, countryFilter, effectiveBucket, tagFilter, minRelevance, closingAfter, closingBefore, sortBy, page, pageSize]);

  useEffect(() => {
    fetchOpportunities();
  }, [fetchOpportunities]);

  const opportunities = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const activeFilterCount = [statusFilter, workflowFilter, countryFilter, bucketFilter !== "relevant" ? bucketFilter : "", tagFilter, closingAfter, closingBefore, minRelevance > 0 ? String(minRelevance) : ""].filter(Boolean).length;

  function clearFilters() {
    setStatusFilter("");
    setWorkflowFilter("");
    setCountryFilter("");
    setBucketFilter("relevant");
    setTagFilter("");
    setMinRelevance(0);
    setClosingAfter("");
    setClosingBefore("");
    setBusinessFocus(false);
    setPage(1);
  }

  function handleQuickFilter(label: string) {
    const tagMap: Record<string, string> = {
      Blinds: "blinds", Shades: "shades", Curtains: "curtains", Fabric: "fabric", Linen: "linen",
      Bedding: "bedding", "Window Coverings": "window coverings", "FF&E": "FF&E",
      Hospitality: "hospitality", Healthcare: "healthcare", School: "school",
    };
    const newTag = tagMap[label] ?? label.toLowerCase();
    setTagFilter(tagFilter === newTag ? "" : newTag);
    setPage(1);
  }

  function handleExport() {
    const qs = buildQueryString({
      format: "xlsx",
      keyword: debouncedKeyword,
      status: statusFilter,
      country: countryFilter,
      bucket: effectiveBucket,
      workflow: workflowFilter,
      tag: tagFilter,
      minRelevance,
      closingAfter,
      closingBefore,
    });
    window.open(`/api/exports?${qs}`, "_blank");
  }

  const selectClass = "h-8 rounded-md border border-input bg-card px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring appearance-none cursor-pointer";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Opportunities</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {loading ? "Loading…" : `${total.toLocaleString()} result${total !== 1 ? "s" : ""}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleBusinessFocus}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium border transition-colors ${
              businessFocus ? "bg-primary text-primary-foreground border-primary shadow-sm" : "bg-card border-input text-muted-foreground hover:text-foreground"
            }`}
          >
            <Eye className="h-3.5 w-3.5" />
            Focus Mode
          </button>
          <button onClick={handleExport} className="inline-flex items-center gap-1.5 rounded-md border bg-card px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            <Download className="h-3.5 w-3.5" />
            Export
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          placeholder="Search blinds, curtains, shades, linen…"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="h-10 w-full rounded-lg border bg-card pl-10 pr-4 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Primary filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <select value={businessFocus ? "relevant" : bucketFilter} onChange={(e) => { setBucketFilter(e.target.value); setBusinessFocus(false); setPage(1); }} className={selectClass}>
          {BUCKET_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={sortBy} onChange={(e) => { setSortBy(e.target.value); setPage(1); }} className={selectClass}>
          {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className={selectClass}>
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={countryFilter} onChange={(e) => { setCountryFilter(e.target.value); setPage(1); }} className={selectClass}>
          {COUNTRY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={workflowFilter} onChange={(e) => { setWorkflowFilter(e.target.value); setPage(1); }} className={selectClass}>
          {WORKFLOW_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-sm font-medium transition-colors ${showAdvanced ? "bg-muted text-foreground" : "bg-card text-muted-foreground hover:text-foreground"}`}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          More
          <ChevronDown className={`h-3 w-3 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
        </button>
        {activeFilterCount > 0 && (
          <button onClick={clearFilters} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-3.5 w-3.5" /> Clear ({activeFilterCount})
          </button>
        )}
      </div>

      {/* Advanced filters */}
      {showAdvanced && (
        <div className="flex items-center gap-4 flex-wrap rounded-lg border bg-muted/30 px-4 py-3">
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground whitespace-nowrap">Min Score:</label>
            <input type="range" min={0} max={100} step={5} value={minRelevance} onChange={(e) => { setMinRelevance(Number(e.target.value)); setPage(1); }} className="w-24 accent-primary" />
            <span className="text-sm font-medium text-tabular w-6">{minRelevance}</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground">After</label>
            <input type="date" value={closingAfter} onChange={(e) => { setClosingAfter(e.target.value); setPage(1); }} className="h-8 rounded-md border bg-card px-2 text-sm" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground">Before</label>
            <input type="date" value={closingBefore} onChange={(e) => { setClosingBefore(e.target.value); setPage(1); }} className="h-8 rounded-md border bg-card px-2 text-sm" />
          </div>
        </div>
      )}

      {/* Quick-filter chips */}
      <div className="flex flex-wrap gap-1.5">
        {QUICK_FILTERS.map((label) => {
          const tagMap: Record<string, string> = {
            Blinds: "blinds", Shades: "shades", Curtains: "curtains", Fabric: "fabric", Linen: "linen",
            Bedding: "bedding", "Window Coverings": "window coverings", "FF&E": "FF&E",
            Hospitality: "hospitality", Healthcare: "healthcare", School: "school",
          };
          const isActive = tagFilter === (tagMap[label] ?? label.toLowerCase());
          return (
            <button
              key={label}
              onClick={() => handleQuickFilter(label)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                isActive
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-card text-muted-foreground border-input hover:bg-accent hover:text-foreground"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="relative">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 backdrop-blur-[1px]">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="font-semibold">Opportunity</TableHead>
                <TableHead className="font-semibold w-28">Score</TableHead>
                <TableHead className="font-semibold">Bucket</TableHead>
                <TableHead className="font-semibold">Organization</TableHead>
                <TableHead className="font-semibold whitespace-nowrap">Closing</TableHead>
                <TableHead className="font-semibold">Analysis</TableHead>
                <TableHead className="font-semibold w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {opportunities.map((opp) => (
                <TableRow key={opp.id} className="group">
                  <TableCell className="max-w-[340px]">
                    <Link href={`/dashboard/opportunities/${opp.id}`} className="text-sm font-medium line-clamp-1 hover:text-primary transition-colors">
                      {opp.title}
                    </Link>
                    <div className="flex items-center gap-1 mt-0.5">
                      {opp.hasQingyanSync && (
                        <span className="inline-flex items-center rounded bg-violet-100 px-1.5 py-px text-[10px] text-violet-700 font-bold" title={`Qingyan: ${opp.qingyanProjectId || "Linked"}`}>
                          QY
                        </span>
                      )}
                      {opp.keywordsMatched.slice(0, 2).map((kw) => (
                        <span key={kw} className="inline-block rounded bg-emerald-50 px-1.5 py-px text-[10px] text-emerald-700 font-medium">{kw}</span>
                      ))}
                      {opp.industryTags.slice(0, 1).map((tag) => (
                        <span key={tag} className="inline-block rounded bg-accent px-1.5 py-px text-[10px] text-accent-foreground font-medium">{tag}</span>
                      ))}
                      <span className="text-[10px] text-muted-foreground">{opp.sourceName}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <ScoreBar score={opp.relevanceScore} />
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs ${getBucketColor(opp.relevanceBucket)}`}>
                      {getBucketLabel(opp.relevanceBucket)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-[160px]">
                    <span className="line-clamp-1">{opp.organization || "—"}</span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap text-tabular">
                    {formatDate(opp.closingDate)}
                  </TableCell>
                  <TableCell>
                    <AnalysisBadge opp={opp} />
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/dashboard/opportunities/${opp.id}`}
                      className="invisible group-hover:visible inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
                    >
                      Open
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && opportunities.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-16 text-center">
                    <FileSearch className="mx-auto h-10 w-10 text-muted-foreground/30 mb-3" />
                    <p className="text-sm font-medium text-muted-foreground">No opportunities match your filters</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">Try adjusting your search or filter criteria</p>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Pagination */}
      {total > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground text-tabular">
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total.toLocaleString()}
          </p>
          <div className="flex items-center gap-1">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-md border px-2.5 py-1.5 text-sm disabled:opacity-30 hover:bg-muted transition-colors">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-medium text-tabular px-3">{page} / {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="rounded-md border px-2.5 py-1.5 text-sm disabled:opacity-30 hover:bg-muted transition-colors">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
