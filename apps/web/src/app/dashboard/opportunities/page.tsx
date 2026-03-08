"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatDate, getRelevanceColor, formatCurrency } from "@/lib/utils";
import type { OpportunitySummary, OpportunityStatus, PaginatedResponse } from "@/types";

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

const SOURCE_OPTIONS = [
  { label: "All Sources", value: "" },
  { label: "MERX", value: "MERX" },
  { label: "SAM.gov", value: "SAM.gov" },
  { label: "BidNet Direct", value: "BidNet Direct" },
];

const CATEGORY_OPTIONS = [
  { label: "All Categories", value: "" },
  { label: "Window Coverings", value: "Window Coverings" },
  { label: "FF&E", value: "FF&E" },
  { label: "Healthcare Furnishings", value: "Healthcare Furnishings" },
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

export default function OpportunitiesPage() {
  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [countryFilter, setCountryFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [minRelevance, setMinRelevance] = useState(0);
  const [postedAfter, setPostedAfter] = useState("");
  const [postedBefore, setPostedBefore] = useState("");
  const [closingAfter, setClosingAfter] = useState("");
  const [closingBefore, setClosingBefore] = useState("");
  const [showFilters, setShowFilters] = useState(true);
  const [page, setPage] = useState(1);
  const pageSize = 10;

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

  const fetchOpportunities = useCallback(() => {
    setLoading(true);
    const qs = buildQueryString({
      keyword: debouncedKeyword,
      status: statusFilter,
      country: countryFilter,
      sourceId: sourceFilter,
      category: categoryFilter,
      minRelevance,
      postedAfter,
      postedBefore,
      closingAfter,
      closingBefore,
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
    countryFilter,
    sourceFilter,
    categoryFilter,
    minRelevance,
    postedAfter,
    postedBefore,
    closingAfter,
    closingBefore,
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
    countryFilter,
    sourceFilter,
    categoryFilter,
    postedAfter,
    postedBefore,
    closingAfter,
    closingBefore,
    minRelevance > 0 ? String(minRelevance) : "",
  ].filter(Boolean).length;

  function clearFilters() {
    setStatusFilter("");
    setCountryFilter("");
    setSourceFilter("");
    setCategoryFilter("");
    setMinRelevance(0);
    setPostedAfter("");
    setPostedBefore("");
    setClosingAfter("");
    setClosingBefore("");
    setPage(1);
  }

  function handleExport() {
    const qs = buildQueryString({
      format: "xlsx",
      keyword: debouncedKeyword,
      status: statusFilter,
      country: countryFilter,
      sourceId: sourceFilter,
      category: categoryFilter,
      minRelevance,
      postedAfter,
      postedBefore,
      closingAfter,
      closingBefore,
    });
    window.open(`/api/exports?${qs}`, "_blank");
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Opportunities</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {loading ? "Loading…" : `${total} opportunities found`}
          </p>
        </div>
        <div className="flex items-center gap-2">
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
                <label className="text-xs font-medium text-muted-foreground">Source</label>
                <select
                  value={sourceFilter}
                  onChange={(e) => { setSourceFilter(e.target.value); setPage(1); }}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {SOURCE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Category</label>
                <select
                  value={categoryFilter}
                  onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {CATEGORY_OPTIONS.map((o) => (
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
                <label className="text-xs font-medium text-muted-foreground">Posted After</label>
                <Input
                  type="date"
                  value={postedAfter}
                  onChange={(e) => { setPostedAfter(e.target.value); setPage(1); }}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Posted Before</label>
                <Input
                  type="date"
                  value={postedBefore}
                  onChange={(e) => { setPostedBefore(e.target.value); setPage(1); }}
                  className="h-9 text-xs"
                />
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
              placeholder="Search by title, organization, solicitation number…"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Error */}
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
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 whitespace-nowrap">Posted</th>
                    <th className="px-4 py-3 whitespace-nowrap">Closing</th>
                    <th className="px-4 py-3">Organization</th>
                    <th className="px-4 py-3">Region</th>
                    <th className="px-4 py-3 whitespace-nowrap">Est. Value</th>
                    <th className="px-4 py-3 text-center">Relevance</th>
                    <th className="px-4 py-3">Source</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {opportunities.map((opp) => (
                    <tr key={opp.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-3 font-medium max-w-[280px]">
                        <Link
                          href={`/dashboard/opportunities/${opp.id}`}
                          className="line-clamp-2 hover:text-primary transition-colors"
                        >
                          {opp.title}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={statusVariant[opp.status] ?? "outline"}>
                          {opp.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {formatDate(opp.postedDate)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {formatDate(opp.closingDate)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground max-w-[180px]">
                        <span className="line-clamp-1">{opp.organization}</span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {[opp.region, opp.country].filter(Boolean).join(", ")}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {formatCurrency(opp.estimatedValue, opp.currency)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold ${getRelevanceColor(opp.relevanceScore)}`}
                        >
                          {opp.relevanceScore}
                        </span>
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
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm font-medium">
                  {page} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage(page + 1)}
                >
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
