"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  FileSearch,
  FolderOpen,
  CalendarClock,
  TrendingUp,
  ArrowUpRight,
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
  RefreshCw,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  formatDate,
  getRelevanceColor,
  getBucketLabel,
  getBucketColor,
  getWorkflowLabel,
  getWorkflowColor,
} from "@/lib/utils";
import type { DashboardStats } from "@/types";

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [crawlRunning, setCrawlRunning] = useState(false);
  const [crawlMessage, setCrawlMessage] = useState<string | null>(null);

  const fetchStats = useCallback(() => {
    fetch("/api/stats")
      .then((res) => {
        if (!res.ok) throw new Error("加载仪表板统计失败");
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
        setCrawlMessage(`错误：${body.error || res.statusText}`);
      } else {
        setCrawlMessage("抓取器已启动，请查看日志了解进度。");
        setTimeout(fetchStats, 5000);
        setTimeout(fetchStats, 15000);
        setTimeout(fetchStats, 30000);
      }
    } catch {
      setCrawlMessage("无法连接抓取服务。");
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
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-6 w-32 mb-1" />
            <Skeleton className="h-4 w-48" />
          </div>
          <Skeleton className="h-8 w-28" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-64 rounded-lg lg:col-span-2" />
          <Skeleton className="h-64 rounded-lg" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold tracking-tight">概览</h1>
        <div className="rounded-lg border bg-card p-8 text-center space-y-3">
          <AlertTriangle className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-destructive">{error}</p>
          <button
            onClick={() => { setError(null); setLoading(true); fetchStats(); }}
            className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            重试
          </button>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const bd = stats.bucketDistribution;
  const wd: Record<string, number> = stats.workflowDistribution ?? {};
  const topSources = stats.topSources ?? [];
  const sn = stats.sourceNetwork;
  const intel = stats.intelligence;

  const METRICS = [
    { label: "相关线索", value: stats.openOpportunities, icon: FolderOpen, color: "text-emerald-600 bg-emerald-50", href: "/dashboard/opportunities" },
    { label: "高关联", value: stats.highRelevanceLeads, icon: TrendingUp, color: "text-blue-600 bg-blue-50", href: "/dashboard/opportunities?bucket=highly_relevant" },
    { label: "新增 (24h)", value: stats.newLast24h, icon: Sparkles, color: "text-violet-600 bg-violet-50", href: "/dashboard/opportunities?sort=newest" },
    { label: "即将截止", value: stats.closingThisWeek, icon: CalendarClock, color: "text-amber-600 bg-amber-50", href: "/dashboard/opportunities?sort=closing_soon" },
  ];

  const pipelineStages = [
    { key: "hot", icon: Flame, label: "紧急" },
    { key: "review", icon: Eye, label: "待审" },
    { key: "shortlisted", icon: Bookmark, label: "候选" },
    { key: "pursuing", icon: TrendingUp, label: "跟进中" },
    { key: "monitor", icon: Radio, label: "监控" },
  ] as const;

  const healthLabels = {
    healthy: "健康",
    degraded: "降级",
    failing: "故障",
    untested: "未测试",
  } as const;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">指挥中心</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {sn ? `${sn.activeSources} 个活跃源` : "采购智能平台"}
            {stats.totalOpportunities > 0 && ` · ${stats.totalOpportunities.toLocaleString()} 个招标机会`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {crawlMessage && (
            <span className="rounded-md border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground max-w-[240px] truncate">{crawlMessage}</span>
          )}
          <button
            onClick={triggerCrawl}
            disabled={crawlRunning}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors shadow-sm"
          >
            {crawlRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            运行抓取
          </button>
        </div>
      </div>

      {/* Last crawl status */}
      {stats.lastCrawlRun && (
        <div className={`flex items-center justify-between rounded-lg border px-4 py-2.5 text-sm ${
          stats.lastCrawlRun.status === "completed" ? "border-emerald-200 bg-emerald-50/60" :
          stats.lastCrawlRun.status === "failed" ? "border-red-200 bg-red-50/60" :
          stats.lastCrawlRun.status === "running" ? "border-blue-200 bg-blue-50/60" :
          "border-amber-200 bg-amber-50/60"
        }`}>
          <div className="flex items-center gap-2.5">
            <Activity className={`h-4 w-4 ${
              stats.lastCrawlRun.status === "completed" ? "text-emerald-600" :
              stats.lastCrawlRun.status === "failed" ? "text-red-600" :
              stats.lastCrawlRun.status === "running" ? "text-blue-600 animate-pulse" :
              "text-amber-500"
            }`} />
            <span className="font-medium capitalize">{stats.lastCrawlRun.status}</span>
            <span className="text-muted-foreground">
              {stats.lastCrawlRun.sourceName} · {stats.lastCrawlRun.opportunitiesFound} found, {stats.lastCrawlRun.opportunitiesCreated} new
            </span>
          </div>
          <Link href="/dashboard/logs" className="text-sm font-medium text-primary hover:underline">查看日志</Link>
        </div>
      )}

      {/* Metric cards */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {METRICS.map((m) => (
          <Link key={m.label} href={m.href}>
            <div className="group rounded-lg border bg-card p-4 hover:shadow-md hover:border-primary/20 transition-all cursor-pointer">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{m.label}</span>
                <div className={`rounded-lg p-1.5 ${m.color}`}>
                  <m.icon className="h-4 w-4" />
                </div>
              </div>
              <span className="text-3xl font-bold tracking-tight text-tabular">{m.value.toLocaleString()}</span>
            </div>
          </Link>
        ))}
      </div>

      {/* Main grid */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left: Opportunities + Relevance */}
        <div className="lg:col-span-2 space-y-4">
          {/* Top Opportunities */}
          <div className="rounded-lg border bg-card">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="text-sm font-semibold">热门机会</h3>
              <Link href="/dashboard/opportunities" className="text-xs font-medium text-primary hover:underline flex items-center gap-0.5">
                查看全部 <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="divide-y">
              {stats.recentOpportunities.map((opp) => (
                <Link
                  key={opp.id}
                  href={`/dashboard/opportunities/${opp.id}`}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors group"
                >
                  <div className={`shrink-0 flex items-center justify-center rounded-md w-9 h-7 text-xs font-bold ${getRelevanceColor(opp.relevanceScore)}`}>
                    {opp.relevanceScore}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">{opp.title}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {opp.organization || "未知"} · {opp.sourceName}
                      {opp.closingDate && ` · 截止 ${formatDate(opp.closingDate)}`}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium ${getBucketColor(opp.relevanceBucket)}`}>
                    {getBucketLabel(opp.relevanceBucket)}
                  </span>
                </Link>
              ))}
              {stats.recentOpportunities.length === 0 && (
                <div className="px-4 py-10 text-center">
                  <FileSearch className="mx-auto h-8 w-8 text-muted-foreground/40 mb-2" />
                  <p className="text-sm text-muted-foreground">暂无招标机会，运行抓取器开始收集。</p>
                </div>
              )}
            </div>
          </div>

          {/* Relevance + Sources row */}
          <div className="grid gap-4 sm:grid-cols-2">
            {bd && (
              <div className="rounded-lg border bg-card p-4">
                <h3 className="text-sm font-semibold mb-3">关联度分布</h3>
                <div className="space-y-3">
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
                      <div key={bucket}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-muted-foreground">{getBucketLabel(bucket)}</span>
                          <span className="text-xs font-semibold text-tabular">{count} <span className="text-muted-foreground font-normal">({pct}%)</span></span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {topSources.length > 0 && (
              <div className="rounded-lg border bg-card p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold">数据源表现</h3>
                  <Link href="/dashboard/sources" className="text-xs font-medium text-primary hover:underline">全部</Link>
                </div>
                <div className="space-y-2.5">
                  {topSources.slice(0, 5).map((s) => {
                    const pct = s.total > 0 ? Math.round((s.relevant / s.total) * 100) : 0;
                    return (
                      <div key={s.name} className="flex items-center gap-2.5">
                        <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium truncate flex-1">{s.name}</span>
                        <span className="text-xs text-muted-foreground text-tabular">{s.relevant}/{s.total}</span>
                        <div className="w-12 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs font-semibold text-tabular w-9 text-right">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* AI Intelligence */}
          {intel && intel.analyzedCount > 0 && (
            <div className="rounded-lg border border-blue-200/60 bg-card p-4">
              <div className="flex items-center gap-1.5 mb-3">
                <Sparkles className="h-4 w-4 text-blue-600" />
                <h3 className="text-sm font-semibold">AI 分析</h3>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div className="rounded-md bg-blue-50 p-2.5 text-center">
                  <p className="text-xl font-bold text-blue-600 text-tabular">{intel.analyzedCount}</p>
                  <p className="text-[10px] text-blue-600/60 font-medium uppercase tracking-wide">已分析</p>
                </div>
                <div className="rounded-md bg-muted/50 p-2.5 text-center">
                  <p className="text-xl font-bold text-tabular">{intel.avgFeasibility}</p>
                  <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">平均分</p>
                </div>
              </div>
              <div className="flex items-center justify-between text-xs mb-3">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  推进 <span className="font-bold text-tabular">{intel.pursueCount}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  待审 <span className="font-bold text-tabular">{intel.reviewCount}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-slate-400" />
                  跳过 <span className="font-bold text-tabular">{intel.skipCount}</span>
                </span>
              </div>
              <Link href="/dashboard/intelligence" className="block text-center text-xs font-medium text-primary hover:underline py-1">
                查看所有报告 →
              </Link>
            </div>
          )}

          {/* Pipeline */}
          <div className="rounded-lg border bg-card p-4">
            <h3 className="text-sm font-semibold mb-3">工作流</h3>
            <div className="space-y-1">
              {pipelineStages.map(({ key, icon: Icon, label }) => {
                const count = wd[key] ?? 0;
                return (
                  <Link
                    key={key}
                    href={`/dashboard/opportunities?workflow=${key}`}
                    className="flex items-center justify-between rounded-md px-2.5 py-2 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className={`rounded-md p-1 ${getWorkflowColor(key)}`}>
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <span className="text-sm font-medium">{label}</span>
                    </div>
                    <span className="text-sm font-bold text-tabular">{count}</span>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Source Health */}
          {sn && (
            <div className="rounded-lg border bg-card p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">数据源健康</h3>
                <Link href="/dashboard/sources" className="text-xs font-medium text-primary hover:underline">详情</Link>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div className="rounded-md bg-muted/50 p-2.5 text-center">
                  <p className="text-xl font-bold text-tabular">{sn.activeSources}</p>
                  <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">活跃</p>
                </div>
                <div className="rounded-md bg-muted/50 p-2.5 text-center">
                  <p className="text-xl font-bold text-tabular">{sn.crawlRunsLast24h}</p>
                  <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">24h 抓取</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {(["healthy", "degraded", "failing", "untested"] as const).map((h) => {
                  const count = sn.healthCounts[h] ?? 0;
                  if (count === 0) return null;
                  const icons: Record<string, typeof CheckCircle2> = {
                    healthy: CheckCircle2, degraded: AlertTriangle, failing: AlertTriangle, untested: Server,
                  };
                  const colors: Record<string, string> = {
                    healthy: "text-emerald-600", degraded: "text-amber-500", failing: "text-red-500", untested: "text-slate-400",
                  };
                  const HIcon = icons[h];
                  return (
                    <span key={h} className="inline-flex items-center gap-1 rounded-md bg-muted/50 px-2 py-1 text-xs">
                      <HIcon className={`h-3.5 w-3.5 ${colors[h]}`} />
                      <span>{healthLabels[h]}</span>
                      <span className="font-bold">{count}</span>
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
