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
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  formatDate,
  getRelevanceColor,
  getBucketLabel,
  getBucketColor,
  formatCurrency,
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

const statusVariant: Record<string, "success" | "warning" | "destructive" | "outline"> = {
  open: "success",
  closed: "outline",
  awarded: "warning",
  cancelled: "destructive",
};

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
  const [bucketFilter, setBucketFilter] = useState(initialBucket);
  const [workflowFilter, setWorkflowFilter] = useState(initialWorkflow);
  const [tagFilter, setTagFilter] = useState("");
  const [sortBy, setSortBy] = useState("relevance");
  const [minRelevance, setMinRelevance] = useState(0);
  const [closingAfter, setClosingAfter] = useState("");
  const [closingBefore, setClosingBefore] = useState("");
  const [showFilters, setShowFilters] = useState(true);
  const [page, setPage] = useState(1);
  const pageSize = 15;
  const [businessFocus, setBusinessFocus] = useState(false);

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
      tag: tagFilter,
      minRelevance,
      closingAfter,
      closingBefore,
    });
    window.open(`/api/exports?${qs}`, "_blank");
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Opportunities</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {loading ? "Loading…" : `${total} opportunities found`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={businessFocus ? "default" : "outline"}
            size="sm"
            onClick={() => { setBusinessFocus(!businessFocus); setPage(1); }}
          >
            <Eye className="mr-2 h-4 w-4" />
            Business Focus
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)}>
            <SlidersHorizontal className="mr-2 h-4 w-4" />
            Filters
            {activeFilterCount > 0 && (
              <span className="ml-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      {/* Quick-filter chips */}
      <div className="flex flex-wrap gap-2">
        {QUICK_FILTERS.map((label) => {
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
          const isActive = tagFilter === (tagMap[label] ?? label.toLowerCase());
          return (
            <button
              key={label}
              onClick={() => handleQuickFilter(label)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
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

      <div className="flex gap-6">
        {/* Filter sidebar */}
        {showFilters && (
          <Card className="w-72 shrink-0 self-start">
            <CardContent className="p-4 space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Filters</h3>
                {activeFilterCount > 0 && (
                  <button
                    onClick={clearFilters}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" /> Clear all
                  </button>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Relevance Bucket</label>
                <select
                  value={businessFocus ? "relevant" : bucketFilter}
                  onChange={(e) => { setBucketFilter(e.target.value); setBusinessFocus(false); setPage(1); }}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {BUCKET_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Sort By</label>
                <select
                  value={sortBy}
                  onChange={(e) => { setSortBy(e.target.value); setPage(1); }}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Status</label>
                <select
                  value={statusFilter}
                  onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Country</label>
                <select
                  value={countryFilter}
                  onChange={(e) => { setCountryFilter(e.target.value); setPage(1); }}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {COUNTRY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Pipeline Stage</label>
                <select
                  value={workflowFilter}
                  onChange={(e) => { setWorkflowFilter(e.target.value); setPage(1); }}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {WORKFLOW_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Min Relevance: {minRelevance}
                </label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={minRelevance}
                  onChange={(e) => { setMinRelevance(Number(e.target.value)); setPage(1); }}
                  className="w-full accent-primary"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>0</span>
                  <span>50</span>
                  <span>100</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Closing After</label>
                <Input
                  type="date"
                  value={closingAfter}
                  onChange={(e) => { setClosingAfter(e.target.value); setPage(1); }}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Closing Before</label>
                <Input
                  type="date"
                  value={closingBefore}
                  onChange={(e) => { setClosingBefore(e.target.value); setPage(1); }}
                  className="h-9 text-xs"
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Results */}
        <div className="flex-1 space-y-4">
          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search blinds, curtains, shades, linen…"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="pl-9"
            />
          </div>

          {error && (
            <Card>
              <CardContent className="p-6 text-center text-sm text-destructive">
                {error}
              </CardContent>
            </Card>
          )}

          {/* Table */}
          <Card>
            <div className="overflow-x-auto relative">
              {loading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              )}
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3">Title</th>
                    <th className="px-4 py-3 text-center">Score</th>
                    <th className="px-4 py-3">Bucket</th>
                    <th className="px-4 py-3">Stage</th>
                    <th className="px-4 py-3">Keywords</th>
                    <th className="px-4 py-3">Organization</th>
                    <th className="px-4 py-3">Region</th>
                    <th className="px-4 py-3 whitespace-nowrap">Closing</th>
                    <th className="px-4 py-3">Source</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {opportunities.map((opp) => (
                    <tr key={opp.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-3 font-medium max-w-[260px]">
                        <Link
                          href={`/dashboard/opportunities/${opp.id}`}
                          className="line-clamp-2 hover:text-primary transition-colors"
                        >
                          {opp.title}
                        </Link>
                        {opp.industryTags.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {opp.industryTags.slice(0, 3).map((tag) => (
                              <span
                                key={tag}
                                className="inline-block rounded-sm bg-accent px-1.5 py-0.5 text-[10px] text-accent-foreground"
                              >
                                {tag}
                              </span>
                            ))}
                            {opp.industryTags.length > 3 && (
                              <span className="text-[10px] text-muted-foreground">
                                +{opp.industryTags.length - 3}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold ${getRelevanceColor(opp.relevanceScore)}`}
                        >
                          {opp.relevanceScore}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium ${getBucketColor(opp.relevanceBucket)}`}
                        >
                          {getBucketLabel(opp.relevanceBucket)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium ${getWorkflowColor(opp.workflowStatus)}`}
                        >
                          {getWorkflowLabel(opp.workflowStatus)}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-[160px]">
                        <div className="flex flex-wrap gap-1">
                          {opp.keywordsMatched.slice(0, 3).map((kw) => (
                            <span
                              key={kw}
                              className="inline-block rounded-sm bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700"
                            >
                              {kw}
                            </span>
                          ))}
                          {opp.keywordsMatched.length > 3 && (
                            <span className="text-[10px] text-muted-foreground">
                              +{opp.keywordsMatched.length - 3}
                            </span>
                          )}
                          {opp.keywordsMatched.length === 0 && (
                            <span className="text-[10px] text-muted-foreground">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground max-w-[160px]">
                        <span className="line-clamp-1">{opp.organization || "—"}</span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {[opp.region, opp.country].filter(Boolean).join(", ") || "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {formatDate(opp.closingDate)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {opp.sourceName}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/dashboard/opportunities/${opp.id}`}
                          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline whitespace-nowrap"
                        >
                          View <ExternalLink className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {!loading && opportunities.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-4 py-12 text-center text-muted-foreground">
                        No opportunities match your filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Pagination */}
          {total > 0 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of{" "}
                {total}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm font-medium">
                  {page} / {totalPages}
                </span>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
