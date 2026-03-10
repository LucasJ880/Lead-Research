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
} from "lucide-react";
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
  RelevanceBucket,
  WorkflowStatus,
} from "@/types";
import { getWorkflowLabel, getWorkflowColor } from "@/lib/utils";

const QUICK_FILTERS = [
  "Blinds",
  "Shades",
  "Curtains",
  "Fabric",
  "Linen",
  "Bedding",
  "Window Coverings",
  "FF&E",
  "Hospitality",
  "Healthcare",
  "School",
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

export default function OpportunitiesPageWrapper() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Loading…</div>}>
      <OpportunitiesPage />
    </Suspense>
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
  const [showFilters, setShowFilters] = useState(true);
  const [page, setPage] = useState(1);
  const pageSize = 15;
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
  }, [
    debouncedKeyword,
    statusFilter,
    workflowFilter,
    countryFilter,
    effectiveBucket,
    tagFilter,
    minRelevance,
    closingAfter,
    closingBefore,
    sortBy,
    page,
    pageSize,
  ]);

  useEffect(() => {
    fetchOpportunities();
  }, [fetchOpportunities]);

  const opportunities = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const activeFilterCount = [
    statusFilter,
    workflowFilter,
    countryFilter,
    bucketFilter !== "relevant" ? bucketFilter : "",
    tagFilter,
    closingAfter,
    closingBefore,
    minRelevance > 0 ? String(minRelevance) : "",
  ].filter(Boolean).length;

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
      Blinds: "blinds",
      Shades: "shades",
      Curtains: "curtains",
      Fabric: "fabric",
      Linen: "linen",
      Bedding: "bedding",
      "Window Coverings": "window coverings",
      "FF&E": "FF&E",
      Hospitality: "hospitality",
      Healthcare: "healthcare",
      School: "school",
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

  const selectClass = "h-7 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring";

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Opportunities</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {loading ? "Loading…" : `${total.toLocaleString()} results`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleBusinessFocus}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium border transition-colors ${
              businessFocus ? "bg-primary text-primary-foreground border-primary" : "bg-background border-input text-muted-foreground hover:text-foreground"
            }`}
          >
            <Eye className="h-3 w-3" />
            Focus
          </button>
          <button onClick={handleExport} className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
            <Download className="h-3 w-3" />
            Export
          </button>
        </div>
      </div>

      {/* Search + horizontal filter toolbar */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            placeholder="Search blinds, curtains, shades, linen…"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-3 text-xs placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* Filter toolbar */}
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
            onClick={() => setShowFilters(!showFilters)}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-2xs font-medium transition-colors ${showFilters ? "bg-muted border-input text-foreground" : "border-input text-muted-foreground hover:text-foreground"}`}
          >
            <SlidersHorizontal className="h-3 w-3" />
            More
          </button>
          {activeFilterCount > 0 && (
            <button onClick={clearFilters} className="inline-flex items-center gap-1 text-2xs text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" /> Clear
            </button>
          )}
        </div>

        {/* Extended filters (date, relevance slider) */}
        {showFilters && (
          <div className="flex items-center gap-3 flex-wrap rounded-md border bg-muted/30 px-3 py-2">
            <div className="flex items-center gap-1.5">
              <label className="text-2xs text-muted-foreground whitespace-nowrap">Min Score: {minRelevance}</label>
              <input type="range" min={0} max={100} step={5} value={minRelevance} onChange={(e) => { setMinRelevance(Number(e.target.value)); setPage(1); }} className="w-20 accent-primary" />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-2xs text-muted-foreground">After</label>
              <input type="date" value={closingAfter} onChange={(e) => { setClosingAfter(e.target.value); setPage(1); }} className="h-6 rounded border border-input bg-background px-1.5 text-2xs" />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-2xs text-muted-foreground">Before</label>
              <input type="date" value={closingBefore} onChange={(e) => { setClosingBefore(e.target.value); setPage(1); }} className="h-6 rounded border border-input bg-background px-1.5 text-2xs" />
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
                className={`rounded-md border px-2 py-0.5 text-2xs font-medium transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-input hover:bg-accent hover:text-foreground"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="rounded-md border bg-destructive/5 p-4 text-center text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Dense table */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="overflow-x-auto relative">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="px-3 py-2 text-left text-2xs font-semibold uppercase tracking-wider text-muted-foreground">Opportunity</th>
                <th className="px-2 py-2 text-center text-2xs font-semibold uppercase tracking-wider text-muted-foreground w-12">Score</th>
                <th className="px-2 py-2 text-left text-2xs font-semibold uppercase tracking-wider text-muted-foreground">Bucket</th>
                <th className="px-2 py-2 text-left text-2xs font-semibold uppercase tracking-wider text-muted-foreground">Organization</th>
                <th className="px-2 py-2 text-left text-2xs font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Closing</th>
                <th className="px-2 py-2 text-left text-2xs font-semibold uppercase tracking-wider text-muted-foreground">Source</th>
                <th className="px-2 py-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground w-24">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {opportunities.map((opp, idx) => (
                <tr key={opp.id} className={`hover:bg-blue-50/50 transition-colors ${idx % 2 === 0 ? "" : "bg-muted/15"}`}>
                  <td className="px-3 py-2 max-w-[320px]">
                    <Link href={`/dashboard/opportunities/${opp.id}`} className="text-xs font-medium line-clamp-1 hover:text-primary transition-colors">
                      {opp.title}
                    </Link>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {opp.keywordsMatched.slice(0, 2).map((kw) => (
                        <span key={kw} className="inline-block rounded bg-emerald-50 px-1 py-px text-2xs text-emerald-700">{kw}</span>
                      ))}
                      {opp.industryTags.slice(0, 1).map((tag) => (
                        <span key={tag} className="inline-block rounded bg-accent px-1 py-px text-2xs text-accent-foreground">{tag}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-center">
                    <span className={`inline-flex items-center justify-center rounded w-7 h-5 text-2xs font-bold ${getRelevanceColor(opp.relevanceScore)}`}>
                      {opp.relevanceScore}
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    <span className={`inline-flex items-center rounded border px-1.5 py-px text-2xs font-medium ${getBucketColor(opp.relevanceBucket)}`}>
                      {getBucketLabel(opp.relevanceBucket)}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-xs text-muted-foreground max-w-[150px]">
                    <span className="line-clamp-1">{opp.organization || "—"}</span>
                  </td>
                  <td className="px-2 py-2 text-xs text-muted-foreground whitespace-nowrap text-tabular">
                    {formatDate(opp.closingDate)}
                  </td>
                  <td className="px-2 py-2 text-xs text-muted-foreground whitespace-nowrap">
                    {opp.sourceName}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-1">
                      {opp.hasIntelligence ? (
                        <Link href={`/dashboard/opportunities/${opp.id}`} className="inline-flex items-center gap-0.5 rounded bg-blue-50 border border-blue-200 px-1.5 py-px text-2xs font-semibold text-blue-700 hover:bg-blue-100 transition-colors" title={`AI: ${opp.recommendationStatus?.replace(/_/g, " ") || "analyzed"}`}>
                          <Sparkles className="h-2.5 w-2.5" /> AI
                        </Link>
                      ) : (
                        <Link href={`/dashboard/opportunities/${opp.id}#ai-intelligence`} className="inline-flex items-center gap-0.5 rounded border border-dashed border-muted-foreground/30 px-1.5 py-px text-2xs text-muted-foreground hover:bg-muted/50 transition-colors">
                          <Sparkles className="h-2.5 w-2.5" />
                        </Link>
                      )}
                      <Link href={`/dashboard/opportunities/${opp.id}`} className="inline-flex items-center gap-0.5 text-2xs font-medium text-primary hover:underline">
                        View <ExternalLink className="h-2.5 w-2.5" />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && opportunities.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-xs text-muted-foreground">
                    No opportunities match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {total > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground text-tabular">
            {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total.toLocaleString()}
          </p>
          <div className="flex items-center gap-1.5">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-md border px-2 py-1 text-xs disabled:opacity-30 hover:bg-muted transition-colors">
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="text-xs font-medium text-tabular px-2">{page}/{totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="rounded-md border px-2 py-1 text-xs disabled:opacity-30 hover:bg-muted transition-colors">
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
