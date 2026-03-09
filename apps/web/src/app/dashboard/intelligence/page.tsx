"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams as useNextSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Sparkles,
  FileText,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Loader2,
  ArrowRight,
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Filter,
  Globe,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate, getRelevanceColor, getBucketLabel, getBucketColor } from "@/lib/utils";

interface IntelItem {
  id: string;
  intelId: string;
  title: string;
  organization: string | null;
  sourceName: string;
  sourceUrl: string;
  status: string;
  relevanceScore: number;
  relevanceBucket: string;
  keywordsMatched: string[];
  industryTags: string[];
  closingDate: string | null;
  feasibilityScore: number | null;
  recommendationStatus: string | null;
  projectOverview: string | null;
  scopeType: string | null;
  businessFitExplanation: string | null;
  analysisModel: string | null;
  analyzedAt: string | null;
  docCount: number;
  chinaViable: boolean | null;
}

const FILTER_TABS = [
  { label: "All Reports", value: "all", icon: Sparkles },
  { label: "Pursue", value: "pursue", icon: CheckCircle2 },
  { label: "Review", value: "review", icon: AlertTriangle },
  { label: "Skip", value: "skip", icon: XCircle },
] as const;

const recStyles: Record<string, { bg: string; text: string; icon: typeof CheckCircle2 }> = {
  strongly_pursue: { bg: "bg-emerald-100 border-emerald-300", text: "text-emerald-800", icon: CheckCircle2 },
  pursue: { bg: "bg-green-100 border-green-300", text: "text-green-800", icon: CheckCircle2 },
  review_carefully: { bg: "bg-amber-100 border-amber-300", text: "text-amber-800", icon: AlertTriangle },
  low_probability: { bg: "bg-orange-100 border-orange-300", text: "text-orange-800", icon: AlertTriangle },
  skip: { bg: "bg-red-100 border-red-300", text: "text-red-800", icon: XCircle },
};

export default function IntelligencePageWrapper() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Loading…</div>}>
      <IntelligencePage />
    </Suspense>
  );
}

function IntelligencePage() {
  const searchParams = useNextSearchParams();
  const initialFilter = searchParams.get("filter") || "all";

  const [items, setItems] = useState<IntelItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState(initialFilter);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    setLoading(true);
    fetch(`/api/intelligence?filter=${filter}&page=${page}&pageSize=20`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load intelligence reports");
        return res.json();
      })
      .then((data) => {
        setItems(data.data);
        setTotal(data.total);
        setTotalPages(data.totalPages);
        setError(null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [filter, page]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function handleFilterChange(value: string) {
    setFilter(value);
    setPage(1);
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-blue-600" />
          <h1 className="text-2xl font-bold tracking-tight">AI Intelligence Reports</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          AI-powered tender analysis with feasibility scoring, scope extraction, and business recommendations.
          {!loading && <span className="ml-1 font-medium">{total} reports available.</span>}
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => handleFilterChange(tab.value)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
              filter === tab.value
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-input hover:bg-accent hover:text-foreground"
            }`}
          >
            <tab.icon className="h-3.5 w-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <Card>
          <CardContent className="p-6 text-center text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {/* Report cards */}
      <div className="relative">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 rounded-lg">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {items.length === 0 && !loading && (
          <Card>
            <CardContent className="p-12 text-center">
              <Sparkles className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
              <h3 className="text-lg font-semibold">No Intelligence Reports Yet</h3>
              <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
                Run the AI analysis pipeline on MERX opportunities to generate detailed tender intelligence reports
                with feasibility scoring and business recommendations.
              </p>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4">
          {items.map((item) => {
            const rec = item.recommendationStatus || "review_carefully";
            const style = recStyles[rec] || recStyles.review_carefully;
            const RecIcon = style.icon;

            return (
              <Link key={item.id} href={`/dashboard/opportunities/${item.id}`}>
                <Card className="hover:border-primary/40 hover:shadow-md transition-all cursor-pointer">
                  <CardContent className="p-5">
                    <div className="flex items-start gap-4">
                      {/* Feasibility Score Circle */}
                      <div className="shrink-0 flex flex-col items-center gap-1">
                        <div
                          className={`flex h-14 w-14 items-center justify-center rounded-full border-2 text-lg font-bold ${
                            (item.feasibilityScore ?? 0) >= 70
                              ? "border-emerald-400 text-emerald-600 bg-emerald-50"
                              : (item.feasibilityScore ?? 0) >= 40
                              ? "border-amber-400 text-amber-600 bg-amber-50"
                              : "border-red-400 text-red-600 bg-red-50"
                          }`}
                        >
                          {item.feasibilityScore ?? "—"}
                        </div>
                        <span className="text-[10px] text-muted-foreground">Feasibility</span>
                      </div>

                      {/* Main content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            {/* Recommendation badge */}
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold ${style.bg} ${style.text}`}>
                                <RecIcon className="h-3 w-3" />
                                {rec.replace(/_/g, " ").toUpperCase()}
                              </span>
                              <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold ${getRelevanceColor(item.relevanceScore)}`}>
                                Score {item.relevanceScore}
                              </span>
                              <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium ${getBucketColor(item.relevanceBucket)}`}>
                                {getBucketLabel(item.relevanceBucket)}
                              </span>
                              {item.analysisModel && item.analysisModel !== "fallback_rule_based" && (
                                <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 border border-blue-200 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                                  <Sparkles className="h-2.5 w-2.5" />
                                  GPT
                                </span>
                              )}
                            </div>

                            {/* Title */}
                            <h3 className="text-base font-semibold truncate pr-4">{item.title}</h3>

                            {/* Meta row */}
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs text-muted-foreground">
                              {item.organization && (
                                <span className="flex items-center gap-1">
                                  <Globe className="h-3 w-3" /> {item.organization}
                                </span>
                              )}
                              <span>{item.sourceName}</span>
                              {item.closingDate && (
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  Closes {formatDate(item.closingDate)}
                                </span>
                              )}
                              {item.docCount > 0 && (
                                <span className="flex items-center gap-1">
                                  <FileText className="h-3 w-3" />
                                  {item.docCount} doc{item.docCount > 1 ? "s" : ""}
                                </span>
                              )}
                              {item.scopeType && (
                                <Badge variant="outline" className="text-[10px] py-0">
                                  {item.scopeType.replace(/_/g, " ")}
                                </Badge>
                              )}
                              {item.chinaViable != null && (
                                <span className={`flex items-center gap-1 ${item.chinaViable ? "text-green-600" : "text-red-500"}`}>
                                  {item.chinaViable ? "CN Sourcing Viable" : "CN Sourcing Limited"}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* View report arrow */}
                          <div className="shrink-0 mt-1">
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                              View Report <ArrowRight className="h-3.5 w-3.5" />
                            </span>
                          </div>
                        </div>

                        {/* Overview excerpt */}
                        {item.projectOverview && (
                          <p className="mt-2 text-sm text-muted-foreground line-clamp-2">{item.projectOverview}</p>
                        )}

                        {/* Business fit */}
                        {item.businessFitExplanation && (
                          <div className="mt-2 rounded-md bg-blue-50 border border-blue-100 px-3 py-2">
                            <p className="text-xs text-blue-800 line-clamp-2">
                              <span className="font-semibold">Business Fit:</span> {item.businessFitExplanation}
                            </p>
                          </div>
                        )}

                        {/* Tags */}
                        {item.industryTags.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {item.industryTags.slice(0, 5).map((tag) => (
                              <span key={tag} className="inline-block rounded-sm bg-accent px-1.5 py-0.5 text-[10px] text-accent-foreground">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Analyzed date */}
                        {item.analyzedAt && (
                          <p className="mt-2 text-[10px] text-muted-foreground">
                            Analyzed {new Date(item.analyzedAt).toLocaleDateString()} via {item.analysisModel || "rule-based"}
                          </p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Pagination */}
      {total > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(page - 1) * 20 + 1}–{Math.min(page * 20, total)} of {total} reports
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
  );
}
