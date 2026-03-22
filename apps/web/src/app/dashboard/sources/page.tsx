"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Globe,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  Pause,
  Loader2,
  ArrowUpDown,
  Search,
  Activity,
  Target,
  Zap,
  BarChart3,
  RefreshCw,
  Shield,
  AlertTriangle,
  HelpCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/utils";
import type { SourceItem, RunStatus, SourcePriority, SourceHealthStatus, AccessMode } from "@/types";

const runStatusConfig: Record<
  RunStatus,
  { icon: typeof CheckCircle2; color: string; label: string }
> = {
  completed: { icon: CheckCircle2, color: "text-emerald-600", label: "完成" },
  failed: { icon: AlertCircle, color: "text-red-500", label: "失败" },
  running: { icon: Clock, color: "text-blue-500", label: "运行中" },
  pending: { icon: Clock, color: "text-amber-500", label: "等待" },
  cancelled: { icon: XCircle, color: "text-slate-400", label: "已取消" },
};

const healthConfig: Record<SourceHealthStatus, { icon: typeof CheckCircle2; color: string; label: string; dotColor: string }> = {
  healthy: { icon: CheckCircle2, color: "text-emerald-600", label: "健康", dotColor: "bg-emerald-500" },
  degraded: { icon: AlertTriangle, color: "text-amber-500", label: "降级", dotColor: "bg-amber-500" },
  failing: { icon: XCircle, color: "text-red-500", label: "故障", dotColor: "bg-red-500" },
  unsupported: { icon: AlertCircle, color: "text-slate-400", label: "不支持", dotColor: "bg-slate-400" },
  untested: { icon: HelpCircle, color: "text-slate-400", label: "未测试", dotColor: "bg-slate-400" },
};

const priorityBadge: Record<SourcePriority, string> = {
  critical: "bg-red-50 text-red-700 border-red-200",
  high: "bg-orange-50 text-orange-700 border-orange-200",
  medium: "bg-blue-50 text-blue-700 border-blue-200",
  low: "bg-slate-50 text-slate-500 border-slate-200",
  experimental: "bg-purple-50 text-purple-600 border-purple-200",
};

const accessModeConfig: Record<AccessMode, { label: string; color: string }> = {
  api: { label: "API", color: "bg-blue-50 text-blue-700 border-blue-200" },
  http_scrape: { label: "Web Scrape", color: "bg-slate-50 text-slate-600 border-slate-200" },
  authenticated_browser: { label: "Auth Browser", color: "bg-amber-50 text-amber-700 border-amber-200" },
  local_connector: { label: "本地代理", color: "bg-violet-50 text-violet-700 border-violet-200" },
};

function fitBadge(score: number) {
  if (score >= 60) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (score >= 30) return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-slate-50 text-slate-500 border-slate-200";
}

type SortKey = "name" | "priority" | "fit" | "total" | "relevant" | "yield" | "health";

const PRIORITY_LABELS: Record<SourcePriority, string> = {
  critical: "关键",
  high: "高",
  medium: "中",
  low: "低",
  experimental: "实验",
};

const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, experimental: 4 };
const HEALTH_ORDER: Record<string, number> = { failing: 0, degraded: 1, untested: 2, unsupported: 3, healthy: 4 };

export default function SourcesPage() {
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [recalculating, setRecalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("priority");
  const [sortAsc, setSortAsc] = useState(true);
  const [filterActive, setFilterActive] = useState<"all" | "active" | "inactive">("all");
  const [filterPriority, setFilterPriority] = useState<SourcePriority | "all">("all");
  const [filterHealth, setFilterHealth] = useState<SourceHealthStatus | "all">("all");

  function fetchSources() {
    setLoading(true);
    fetch("/api/sources")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load sources");
        return res.json();
      })
      .then((data: SourceItem[]) => {
        setSources(data);
        setError(null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchSources(); }, []);

  async function handleRecalculate() {
    setRecalculating(true);
    try {
      const res = await fetch("/api/sources/recalculate", { method: "POST" });
      if (!res.ok) throw new Error("Recalculate failed");
      fetchSources();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recalculate failed");
    } finally {
      setRecalculating(false);
    }
  }

  const filtered = useMemo(() => {
    let list = sources;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.region ?? "").toLowerCase().includes(q) ||
          s.country.toLowerCase().includes(q) ||
          s.sourceType.toLowerCase().includes(q)
      );
    }
    if (filterActive === "active") list = list.filter((s) => s.isActive);
    if (filterActive === "inactive") list = list.filter((s) => !s.isActive);
    if (filterPriority !== "all") list = list.filter((s) => s.sourcePriority === filterPriority);
    if (filterHealth !== "all") list = list.filter((s) => s.healthStatus === filterHealth);

    return [...list].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name": cmp = a.name.localeCompare(b.name); break;
        case "priority": cmp = (PRIORITY_ORDER[a.sourcePriority] ?? 3) - (PRIORITY_ORDER[b.sourcePriority] ?? 3); break;
        case "fit": cmp = a.industryFitScore - b.industryFitScore; break;
        case "total": cmp = a.totalOpportunities - b.totalOpportunities; break;
        case "relevant": cmp = a.relevantOpportunities - b.relevantOpportunities; break;
        case "yield": cmp = a.sourceYieldPct - b.sourceYieldPct; break;
        case "health": cmp = (HEALTH_ORDER[a.healthStatus] ?? 2) - (HEALTH_ORDER[b.healthStatus] ?? 2); break;
      }
      return sortAsc ? cmp : -cmp;
    });
  }, [sources, search, sortKey, sortAsc, filterActive, filterPriority, filterHealth]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((p) => !p);
    else { setSortKey(key); setSortAsc(key === "name"); }
  }

  const totalActive = sources.filter((s) => s.isActive).length;
  const totalOpps = sources.reduce((s, x) => s + x.totalOpportunities, 0);
  const totalRelevant = sources.reduce((s, x) => s + x.relevantOpportunities, 0);
  const avgFit = sources.length
    ? Math.round(sources.reduce((s, x) => s + x.industryFitScore, 0) / sources.length)
    : 0;

  const priorityCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of sources) c[s.sourcePriority] = (c[s.sourcePriority] || 0) + 1;
    return c;
  }, [sources]);

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">数据源</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {sources.length} 个已注册源 &middot;{" "}
            {priorityCounts["critical"] ?? 0} 关键 &middot;{" "}
            {priorityCounts["high"] ?? 0} 高 &middot;{" "}
            {priorityCounts["medium"] ?? 0} 中 &middot;{" "}
            {priorityCounts["low"] ?? 0} 低 &middot;{" "}
            {priorityCounts["experimental"] ?? 0} 实验
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRecalculate} disabled={recalculating}>
            <RefreshCw className={`mr-2 h-4 w-4 ${recalculating ? "animate-spin" : ""}`} />
            重新计算分析
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "活跃源", value: totalActive, icon: Activity, color: "text-blue-600 bg-blue-50" },
          { label: "总机会数", value: totalOpps, icon: BarChart3, color: "text-emerald-600 bg-emerald-50" },
          { label: "相关收集", value: totalRelevant, icon: Target, color: "text-violet-600 bg-violet-50" },
          { label: "平均匹配分", value: avgFit, icon: Zap, color: "text-amber-600 bg-amber-50" },
        ].map((c) => (
          <Card key={c.label}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{c.label}</p>
                  <p className="mt-2 text-2xl font-bold tracking-tight">{c.value.toLocaleString()}</p>
                </div>
                <div className={`rounded-lg p-2.5 ${c.color}`}>
                  <c.icon className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            className="h-9 rounded-md border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring w-64"
            placeholder="搜索数据源…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {(["all", "active", "inactive"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setFilterActive(v)}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
              filterActive === v
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground hover:bg-muted border-input"
            }`}
          >
            {v === "all" ? "全部" : v === "active" ? "活跃" : "未激活"}
          </button>
        ))}

        <span className="text-xs text-muted-foreground">|</span>

        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-xs"
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value as SourcePriority | "all")}
        >
          <option value="all">全部优先级</option>
          <option value="critical">关键</option>
          <option value="high">高</option>
          <option value="medium">中</option>
          <option value="low">低</option>
          <option value="experimental">实验</option>
        </select>

        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-xs"
          value={filterHealth}
          onChange={(e) => setFilterHealth(e.target.value as SourceHealthStatus | "all")}
        >
          <option value="all">全部健康</option>
          <option value="healthy">健康</option>
          <option value="degraded">降级</option>
          <option value="failing">故障</option>
          <option value="untested">未测试</option>
          <option value="unsupported">不支持</option>
        </select>

        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length} / {sources.length} 个源
        </span>
      </div>

      {error && (
        <Card>
          <CardContent className="p-6 text-center text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <Card>
        <div className="overflow-x-auto relative">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
          <Table className="w-full text-sm">
            <TableHeader>
              <TableRow className="border-b text-left text-xs font-medium uppercase tracking-wider text-muted-foreground hover:bg-transparent">
                <TableHead className="px-4 py-3">
                  <button className="inline-flex items-center gap-1" onClick={() => toggleSort("name")}>
                    数据源 <ArrowUpDown className="h-3 w-3" />
                  </button>
                </TableHead>
                <TableHead className="px-4 py-3 text-center">
                  <button className="inline-flex items-center gap-1" onClick={() => toggleSort("priority")}>
                    优先级 <ArrowUpDown className="h-3 w-3" />
                  </button>
                </TableHead>
                <TableHead className="px-4 py-3">类型</TableHead>
                <TableHead className="px-4 py-3">接入</TableHead>
                <TableHead className="px-4 py-3">地区</TableHead>
                <TableHead className="px-4 py-3 text-center">
                  <button className="inline-flex items-center gap-1" onClick={() => toggleSort("fit")}>
                    匹配 <ArrowUpDown className="h-3 w-3" />
                  </button>
                </TableHead>
                <TableHead className="px-4 py-3 text-right">
                  <button className="inline-flex items-center gap-1 ml-auto" onClick={() => toggleSort("total")}>
                    机会 <ArrowUpDown className="h-3 w-3" />
                  </button>
                </TableHead>
                <TableHead className="px-4 py-3 text-right">
                  <button className="inline-flex items-center gap-1 ml-auto" onClick={() => toggleSort("relevant")}>
                    相关 <ArrowUpDown className="h-3 w-3" />
                  </button>
                </TableHead>
                <TableHead className="px-4 py-3 text-right">
                  <button className="inline-flex items-center gap-1 ml-auto" onClick={() => toggleSort("yield")}>
                    转化% <ArrowUpDown className="h-3 w-3" />
                  </button>
                </TableHead>
                <TableHead className="px-4 py-3 text-center">运行</TableHead>
                <TableHead className="px-4 py-3">
                  <button className="inline-flex items-center gap-1" onClick={() => toggleSort("health")}>
                    健康 <ArrowUpDown className="h-3 w-3" />
                  </button>
                </TableHead>
                <TableHead className="px-4 py-3 whitespace-nowrap">上次抓取</TableHead>
                <TableHead className="px-4 py-3 text-center">活跃</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y">
              {filtered.map((source) => {
                const hi = healthConfig[source.healthStatus] ?? healthConfig.untested;
                const HealthIcon = hi.icon;
                return (
                  <TableRow key={source.id}>
                    <TableCell className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                          <Globe className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium truncate max-w-[200px]">{source.name}</p>
                          <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                            {source.baseUrl}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold capitalize ${priorityBadge[source.sourcePriority] ?? priorityBadge.medium}`}>
                        {PRIORITY_LABELS[source.sourcePriority] ?? source.sourcePriority}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <Badge variant="outline" className="text-xs capitalize whitespace-nowrap">
                        {source.sourceType.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      {(() => {
                        const am = accessModeConfig[source.accessMode] ?? accessModeConfig.http_scrape;
                        return (
                          <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold ${am.color}`}>
                            {am.label}
                          </span>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {source.region ?? source.country}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${fitBadge(source.industryFitScore)}`}>
                        {source.industryFitScore}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right font-medium tabular-nums">
                      {source.totalOpportunities}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right font-medium tabular-nums text-emerald-600">
                      {source.relevantOpportunities}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right tabular-nums">
                      {source.totalOpportunities > 0 ? (
                        <span className={source.sourceYieldPct >= 20 ? "text-emerald-600 font-medium" : "text-muted-foreground"}>
                          {source.sourceYieldPct}%
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-center tabular-nums">
                      <span className="text-xs text-muted-foreground">
                        {source.successfulCrawlRuns}/{source.totalCrawlRuns}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${hi.color}`}>
                        <span className={`h-2 w-2 rounded-full shrink-0 ${hi.dotColor}`} />
                        <HealthIcon className="h-3.5 w-3.5" />
                        {hi.label}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {formatDate(source.lastCrawledAt, "MMM d, h:mm a")}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-center">
                      {source.isActive ? (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        </span>
                      ) : (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-100">
                          <Pause className="h-3.5 w-3.5 text-slate-400" />
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {!loading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={13} className="px-4 py-12 text-center text-muted-foreground">
                    {search ? "没有匹配的数据源。" : "尚未配置数据源。"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
