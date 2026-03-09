"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  FileSearch,
  FolderOpen,
  CalendarClock,
  TrendingUp,
  ArrowUpRight,
  ExternalLink,
  Play,
  Loader2,
  Sparkles,
  Flame,
  Eye,
  Bookmark,
  Radio,
  Globe,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Server,
  Shield,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  formatDate,
  getRelevanceColor,
  getBucketLabel,
  getBucketColor,
  getWorkflowLabel,
  getWorkflowColor,
} from "@/lib/utils";
import type { DashboardStats } from "@/types";

const statusVariant: Record<string, "success" | "warning" | "destructive" | "outline"> = {
  open: "success",
  closed: "outline",
  awarded: "warning",
  cancelled: "destructive",
};

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [crawlRunning, setCrawlRunning] = useState(false);
  const [crawlMessage, setCrawlMessage] = useState<string | null>(null);

  const fetchStats = useCallback(() => {
    fetch("/api/stats")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load dashboard stats");
        return res.json();
      })
      .then((data: DashboardStats) => {
        setStats(data);
        setError(null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const triggerCrawl = useCallback(async () => {
    setCrawlRunning(true);
    setCrawlMessage(null);
    try {
      const res = await fetch("/api/crawler/trigger", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setCrawlMessage(`Error: ${body.error || res.statusText}`);
      } else {
        setCrawlMessage("Crawler dispatched. Check Logs page to track progress.");
        // Auto-refresh stats after a delay so the last-run card updates
        setTimeout(fetchStats, 5000);
        setTimeout(fetchStats, 15000);
        setTimeout(fetchStats, 30000);
      }
    } catch {
      setCrawlMessage("Failed to connect to crawler service.");
    } finally {
      setCrawlRunning(false);
    }
  }, [fetchStats]);

  useEffect(() => {
    setLoading(true);
    fetchStats();
  }, [fetchStats]);

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Intelligence Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">Window covering &amp; textile opportunity intelligence</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="space-y-3">
                    <div className="h-4 w-32 animate-pulse rounded bg-muted" />
                    <div className="h-8 w-20 animate-pulse rounded bg-muted" />
                  </div>
                  <div className="h-10 w-10 animate-pulse rounded-lg bg-muted" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Intelligence Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">Window covering &amp; textile opportunity intelligence</p>
        </div>
        <Card>
          <CardContent className="p-6 text-center text-sm text-destructive">{error}</CardContent>
        </Card>
      </div>
    );
  }

  if (!stats) return null;

  const bd = stats.bucketDistribution;
  const wd: Record<string, number> = stats.workflowDistribution ?? {};
  const topSources = stats.topSources ?? [];
  const sn = stats.sourceNetwork;

  const STAT_CARDS = [
    { label: "Relevant Leads", value: stats.openOpportunities, icon: FolderOpen, color: "text-emerald-600 bg-emerald-50", href: "/dashboard/opportunities" },
    { label: "Highly Relevant", value: stats.highRelevanceLeads, icon: TrendingUp, color: "text-violet-600 bg-violet-50", href: "/dashboard/opportunities?bucket=highly_relevant" },
    { label: "New (24h)", value: stats.newLast24h, icon: Sparkles, color: "text-cyan-600 bg-cyan-50", href: "/dashboard/opportunities?sort=newest" },
    { label: "Closing This Week", value: stats.closingThisWeek, icon: CalendarClock, color: "text-amber-600 bg-amber-50", href: "/dashboard/opportunities?sort=closing_soon" },
    { label: "Total Collected", value: stats.totalOpportunities, icon: FileSearch, color: "text-slate-600 bg-slate-50", href: "/dashboard/opportunities?bucket=all" },
  ];

  const pipelineItems = [
    { key: "hot", icon: Flame, label: "Hot Leads" },
    { key: "review", icon: Eye, label: "In Review" },
    { key: "shortlisted", icon: Bookmark, label: "Shortlisted" },
    { key: "pursuing", icon: TrendingUp, label: "Pursuing" },
    { key: "monitor", icon: Radio, label: "Monitoring" },
  ] as const;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Intelligence Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Window covering &amp; textile opportunity intelligence
            {sn && <span className="ml-2 text-muted-foreground/60">·  {sn.activeSources} active sources</span>}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            onClick={triggerCrawl}
            disabled={crawlRunning}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {crawlRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Run Crawler
          </button>
          {crawlMessage && (
            <p className="text-xs text-muted-foreground max-w-xs text-right">{crawlMessage}</p>
          )}
        </div>
      </div>

      {/* ─── Last Crawl Run Status ─── */}
      {stats.lastCrawlRun && (
        <Card className={`border-l-4 ${
          stats.lastCrawlRun.status === "completed" ? "border-l-emerald-500" :
          stats.lastCrawlRun.status === "failed" ? "border-l-red-500" :
          stats.lastCrawlRun.status === "running" ? "border-l-blue-500" :
          "border-l-amber-400"
        }`}>
          <CardContent className="py-3 px-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Activity className={`h-4 w-4 ${
                  stats.lastCrawlRun.status === "completed" ? "text-emerald-600" :
                  stats.lastCrawlRun.status === "failed" ? "text-red-600" :
                  stats.lastCrawlRun.status === "running" ? "text-blue-600 animate-pulse" :
                  "text-amber-500"
                }`} />
                <div>
                  <p className="text-sm font-medium">
                    Last crawl: <span className="capitalize">{stats.lastCrawlRun.status}</span>
                    {" · "}
                    <span className="text-muted-foreground">{stats.lastCrawlRun.sourceName}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {stats.lastCrawlRun.opportunitiesFound} found, {stats.lastCrawlRun.opportunitiesCreated} new
                    {stats.lastCrawlRun.startedAt && (
                      <> · {new Date(stats.lastCrawlRun.startedAt).toLocaleString()}</>
                    )}
                    {stats.lastCrawlRun.errorMessage && (
                      <span className="text-red-600"> · {stats.lastCrawlRun.errorMessage.slice(0, 80)}</span>
                    )}
                  </p>
                </div>
              </div>
              <Link href="/dashboard/logs" className="text-xs font-medium text-primary hover:underline whitespace-nowrap">
                View logs →
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Primary Intelligence Cards ─── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {STAT_CARDS.map((stat) => (
          <Link key={stat.label} href={stat.href}>
            <Card className="hover:border-primary/30 transition-colors cursor-pointer">
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">{stat.label}</p>
                    <p className="mt-2 text-3xl font-bold tracking-tight">
                      {stat.value.toLocaleString()}
                    </p>
                  </div>
                  <div className={`rounded-lg p-2.5 ${stat.color}`}>
                    <stat.icon className="h-5 w-5" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* ─── Second Row: Distribution + Pipeline + Source Network ─── */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Relevance distribution */}
        {bd && (
          <Card className="lg:col-span-4">
            <CardHeader className="pb-4">
              <CardTitle className="text-base font-semibold">Relevance Distribution</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(["highly_relevant", "moderately_relevant", "low_relevance", "irrelevant"] as const).map((bucket) => {
                const count = bd[bucket];
                const total = stats.totalOpportunities || 1;
                const pct = Math.round((count / total) * 100);
                const barColor =
                  bucket === "highly_relevant" ? "bg-emerald-500"
                  : bucket === "moderately_relevant" ? "bg-blue-500"
                  : bucket === "low_relevance" ? "bg-amber-400"
                  : "bg-slate-300";
                return (
                  <div key={bucket} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className={`inline-block rounded-md border px-2 py-0.5 text-[10px] font-medium ${getBucketColor(bucket)}`}>
                        {getBucketLabel(bucket)}
                      </span>
                      <span className="text-sm font-bold tabular-nums">{count}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* Business Pipeline */}
        <Card className="lg:col-span-4">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">Business Pipeline</CardTitle>
              <Link href="/dashboard/opportunities?workflow=pursuing" className="text-xs font-medium text-primary hover:underline">
                Full pipeline →
              </Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {pipelineItems.map(({ key, icon: Icon, label }) => {
              const count = wd[key] ?? 0;
              return (
                <Link
                  key={key}
                  href={`/dashboard/opportunities?workflow=${key}`}
                  className="flex items-center justify-between rounded-lg border p-2.5 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <div className={`rounded-md p-1.5 ${getWorkflowColor(key)}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <span className="text-sm font-medium">{label}</span>
                  </div>
                  <span className="text-base font-bold tabular-nums">{count}</span>
                </Link>
              );
            })}
          </CardContent>
        </Card>

        {/* Source Network Health */}
        {sn && (
          <Card className="lg:col-span-4">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold">Source Network</CardTitle>
                <Link href="/dashboard/sources" className="text-xs font-medium text-primary hover:underline">
                  All sources →
                </Link>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold">{sn.activeSources}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Active Sources</p>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold">{sn.totalSources}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Total Registered</p>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold">{sn.crawlRunsLast24h}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Crawls (24h)</p>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold">{sn.totalCrawlRuns}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Total Runs</p>
                </div>
              </div>

              {/* Priority breakdown */}
              <div className="space-y-1.5">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Priority Breakdown</p>
                <div className="flex gap-1.5 flex-wrap">
                  {(["critical", "high", "medium", "low", "experimental"] as const).map((p) => {
                    const count = sn.priorityCounts[p] ?? 0;
                    if (count === 0) return null;
                    const colors: Record<string, string> = {
                      critical: "bg-red-50 text-red-700 border-red-200",
                      high: "bg-orange-50 text-orange-700 border-orange-200",
                      medium: "bg-blue-50 text-blue-700 border-blue-200",
                      low: "bg-slate-50 text-slate-500 border-slate-200",
                      experimental: "bg-purple-50 text-purple-600 border-purple-200",
                    };
                    return (
                      <span key={p} className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold capitalize ${colors[p]}`}>
                        {p} <span className="font-bold">{count}</span>
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* Health breakdown */}
              <div className="space-y-1.5">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Health Status</p>
                <div className="flex gap-1.5 flex-wrap">
                  {(["healthy", "degraded", "failing", "untested", "unsupported"] as const).map((h) => {
                    const count = sn.healthCounts[h] ?? 0;
                    if (count === 0) return null;
                    const icons: Record<string, typeof CheckCircle2> = {
                      healthy: CheckCircle2,
                      degraded: AlertTriangle,
                      failing: AlertTriangle,
                      untested: Server,
                      unsupported: Shield,
                    };
                    const colors: Record<string, string> = {
                      healthy: "text-emerald-600",
                      degraded: "text-amber-500",
                      failing: "text-red-500",
                      untested: "text-slate-400",
                      unsupported: "text-slate-400",
                    };
                    const HIcon = icons[h];
                    return (
                      <span key={h} className="inline-flex items-center gap-1 text-[11px]">
                        <HIcon className={`h-3 w-3 ${colors[h]}`} />
                        <span className="font-medium capitalize">{h}</span>
                        <span className="font-bold">{count}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ─── AI Intelligence Summary ─── */}
      {stats.intelligence && stats.intelligence.analyzedCount > 0 && (
        <Card className="border-blue-200 bg-blue-50/20">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-blue-600" />
                <CardTitle className="text-base font-semibold">AI Tender Intelligence</CardTitle>
              </div>
              <Link
                href="/dashboard/intelligence"
                className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                View all reports <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-5">
              <Link href="/dashboard/intelligence">
                <div className="rounded-lg border bg-white p-3 text-center hover:border-blue-400 hover:shadow-sm transition-all cursor-pointer">
                  <p className="text-2xl font-bold text-blue-600">{stats.intelligence.analyzedCount}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Analyzed</p>
                </div>
              </Link>
              <Link href="/dashboard/intelligence?filter=pursue">
                <div className="rounded-lg border bg-white p-3 text-center hover:border-emerald-400 hover:shadow-sm transition-all cursor-pointer">
                  <p className="text-2xl font-bold text-emerald-600">{stats.intelligence.pursueCount}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Pursue</p>
                </div>
              </Link>
              <Link href="/dashboard/intelligence?filter=review">
                <div className="rounded-lg border bg-white p-3 text-center hover:border-amber-400 hover:shadow-sm transition-all cursor-pointer">
                  <p className="text-2xl font-bold text-amber-600">{stats.intelligence.reviewCount}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Review</p>
                </div>
              </Link>
              <Link href="/dashboard/intelligence?filter=skip">
                <div className="rounded-lg border bg-white p-3 text-center hover:border-slate-400 hover:shadow-sm transition-all cursor-pointer">
                  <p className="text-2xl font-bold text-slate-500">{stats.intelligence.skipCount}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Skip</p>
                </div>
              </Link>
              <Link href="/dashboard/intelligence">
                <div className="rounded-lg border bg-white p-3 text-center hover:border-blue-400 hover:shadow-sm transition-all cursor-pointer">
                  <p className="text-2xl font-bold">{stats.intelligence.avgFeasibility}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Avg Feasibility</p>
                </div>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Top Sources by Yield ─── */}
      {topSources.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-4">
            <CardTitle className="text-base font-semibold">Top Sources by Relevant Yield</CardTitle>
            <Link
              href="/dashboard/sources"
              className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              All Sources <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </CardHeader>
          <CardContent>
            <div className="space-y-2.5">
              {topSources.slice(0, 6).map((s) => {
                const pct = s.total > 0 ? Math.round((s.relevant / s.total) * 100) : 0;
                return (
                  <div key={s.name} className="flex items-center gap-4">
                    <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium truncate min-w-0 flex-1 max-w-[220px]">{s.name}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-emerald-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap tabular-nums w-16 text-right">
                      {s.relevant}/{s.total}
                    </span>
                    <span className="text-xs font-medium tabular-nums w-10 text-right">
                      {pct}%
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Top Relevant Opportunities ─── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-4">
          <CardTitle className="text-base font-semibold">Top Relevant Opportunities</CardTitle>
          <Link
            href="/dashboard/opportunities"
            className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            View all <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="pb-3 pr-4">Opportunity</th>
                  <th className="pb-3 pr-4 text-center">Score</th>
                  <th className="pb-3 pr-4">Bucket</th>
                  <th className="pb-3 pr-4">Stage</th>
                  <th className="pb-3 pr-4">Organization</th>
                  <th className="pb-3 pr-4">Closing</th>
                  <th className="pb-3 pr-4">Source</th>
                  <th className="pb-3" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {stats.recentOpportunities.map((opp) => (
                  <tr key={opp.id} className="hover:bg-muted/50 transition-colors">
                    <td className="py-3 pr-4 font-medium max-w-xs">
                      <Link
                        href={`/dashboard/opportunities/${opp.id}`}
                        className="line-clamp-1 hover:text-primary transition-colors"
                      >
                        {opp.title}
                      </Link>
                      {opp.industryTags.length > 0 && (
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {opp.industryTags.slice(0, 3).map((tag) => (
                            <span key={tag} className="inline-block rounded-sm bg-accent px-1.5 py-0.5 text-[10px] text-accent-foreground">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-center">
                      <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold ${getRelevanceColor(opp.relevanceScore)}`}>
                        {opp.relevanceScore}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium ${getBucketColor(opp.relevanceBucket)}`}>
                        {getBucketLabel(opp.relevanceBucket)}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium ${getWorkflowColor(opp.workflowStatus)}`}>
                        {getWorkflowLabel(opp.workflowStatus)}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">
                      {opp.organization || "—"}
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground whitespace-nowrap">
                      {formatDate(opp.closingDate)}
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">{opp.sourceName}</td>
                    <td className="py-3">
                      <Link
                        href={`/dashboard/opportunities/${opp.id}`}
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        View <ExternalLink className="h-3 w-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
                {stats.recentOpportunities.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-muted-foreground">
                      No relevant opportunities found yet. Run the crawler to discover opportunities matching your industry.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
