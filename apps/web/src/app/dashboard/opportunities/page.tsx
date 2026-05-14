"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams as useNextSearchParams } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
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
  Play,
  Archive,
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
  BusinessStatus,
  OpportunityLifecycleState,
  OpportunitySummary,
  OpportunityStatus,
  PaginatedResponse,
  ProcurementType,
} from "@/types";

const QUICK_FILTERS = [
  "Blinds", "Shades", "Curtains", "Fabric", "Linen", "Bedding",
  "Window Coverings", "FF&E", "Hospitality", "Healthcare", "School",
] as const;

const BUCKET_OPTIONS: { label: string; value: string }[] = [
  { label: "仅相关", value: "relevant" },
  { label: "高关联", value: "highly_relevant" },
  { label: "中关联", value: "moderately_relevant" },
  { label: "低关联", value: "low_relevance" },
  { label: "无关联", value: "irrelevant" },
  { label: "全部分类", value: "all" },
];

const SORT_OPTIONS = [
  { label: "最高关联度", value: "relevance" },
  { label: "最新", value: "newest" },
  { label: "即将截止", value: "closing_soon" },
];

const LIFECYCLE_TABS: { label: string; value: OpportunityLifecycleState | "actionable" | "watch"; description: string }[] = [
  { label: "可投标", value: "actionable", description: "开放且高/中关联" },
  { label: "即将截止", value: "closing_soon", description: "7 天内截止" },
  { label: "观察", value: "watch", description: "低关联但未过期" },
  { label: "已过期", value: "expired", description: "过期 14 天内" },
];

const STATUS_OPTIONS: { label: string; value: OpportunityStatus | "" }[] = [
  { label: "全部状态", value: "" },
  { label: "开放", value: "open" },
  { label: "已关闭", value: "closed" },
  { label: "已授标", value: "awarded" },
  { label: "已取消", value: "cancelled" },
];

const COUNTRY_OPTIONS = [
  { label: "全部国家", value: "" },
  { label: "加拿大", value: "CA" },
  { label: "美国", value: "US" },
];

const WORKFLOW_OPTIONS: { label: string; value: string }[] = [
  { label: "全部阶段", value: "" },
  { label: "新建", value: "new" },
  { label: "紧急", value: "hot" },
  { label: "待审", value: "review" },
  { label: "候选", value: "shortlisted" },
  { label: "跟进中", value: "pursuing" },
  { label: "监控", value: "monitor" },
  { label: "已跳过", value: "passed" },
  { label: "不相关", value: "not_relevant" },
];

const BUSINESS_STATUS_OPTIONS: { label: string; value: BusinessStatus | "" }[] = [
  // 注意：这里的"默认列表"对应 API 的「未传 businessStatus 参数」，
  // 此时 SQL 会主动排除 archived / not_fit / lost。所以它不是字面意义上的
  // "全部"，避免之前"全部业务状态却看不到归档"的歧义。
  { label: "默认列表（不含归档/不符合/未中标）", value: "" },
  { label: "新发现", value: "new_discovered" },
  { label: "候选", value: "candidate" },
  { label: "审核中", value: "under_review" },
  { label: "符合", value: "fit" },
  { label: "不符合", value: "not_fit" },
  { label: "已归档（待回看）", value: "archived" },
  { label: "投标中", value: "bidding" },
  { label: "已提交", value: "submitted" },
  { label: "中标", value: "won" },
  { label: "未中标", value: "lost" },
];

// 业务状态快捷标签：归档/不符合默认会被列表过滤，所以单独提供入口。
// 把"归档"语义统一为"暂存待回看"，与团队实际使用习惯（save-for-later）对齐。
const BUSINESS_STATUS_QUICK_TABS: { label: string; value: "" | "archived" | "not_fit"; hint: string }[] = [
  { label: "进行中", value: "", hint: "默认列表，不含归档/不符合/未中标" },
  { label: "已归档（待回看）", value: "archived", hint: "暂存以后再处理的标的，不会被爬虫覆盖" },
  { label: "已不符合", value: "not_fit", hint: "已判定不参与的标的" },
];

const PROCUREMENT_TYPE_OPTIONS: { label: string; value: ProcurementType | "" }[] = [
  { label: "全部类型", value: "" },
  { label: "RFQ", value: "RFQ" },
  { label: "RFP", value: "RFP" },
  { label: "RFI", value: "RFI" },
  { label: "RFN", value: "RFN" },
  { label: "IFB", value: "IFB" },
  { label: "ITB", value: "ITB" },
  { label: "Tender", value: "tender" },
  { label: "Notice", value: "notice" },
  { label: "Unknown", value: "unknown" },
];

function buildQueryString(params: Record<string, string | number | boolean>): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== "" && value !== 0 && value !== false) {
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
        <Sparkles className="h-3 w-3" /> 无
      </span>
    );
  }
  if (opp.analysisMode === "deep") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-xs font-medium text-emerald-700">
        <Sparkles className="h-3 w-3" /> 深度
      </span>
    );
  }
  if (opp.analysisModel === "fallback_rule_based") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-slate-50 border border-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
        <Sparkles className="h-3 w-3" /> 规则
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 border border-blue-200 px-2 py-0.5 text-xs font-medium text-blue-700">
      <Sparkles className="h-3 w-3" /> 快速
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
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const canWrite = ["owner", "super_admin", "admin", "manager", "sales"].includes(role ?? "");

  const nextSearchParams = useNextSearchParams();
  const initialWorkflow = nextSearchParams.get("workflow") || "";

  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [businessStatusFilter, setBusinessStatusFilter] = useState("");
  const [countryFilter, setCountryFilter] = useState("");
  const [stateProvinceFilter, setStateProvinceFilter] = useState("");
  const [northAmericaOnly, setNorthAmericaOnly] = useState(false);
  const [unknownLocationOnly, setUnknownLocationOnly] = useState(false);
  const [procurementTypeFilter, setProcurementTypeFilter] = useState("");
  const initialBucket = nextSearchParams.get("bucket") || "relevant";
  const initialSort = nextSearchParams.get("sort") || "relevance";
  const [bucketFilter, setBucketFilter] = useState(initialBucket);
  const [workflowFilter, setWorkflowFilter] = useState(initialWorkflow);
  const [tagFilter, setTagFilter] = useState("");
  const [sortBy, setSortBy] = useState(initialSort);
  const [lifecycle, setLifecycle] = useState<OpportunityLifecycleState | "actionable" | "watch">(
    (nextSearchParams.get("lifecycle") as OpportunityLifecycleState | "actionable" | "watch" | null) || "actionable"
  );
  const [lifecycleCounts, setLifecycleCounts] = useState<Record<string, number>>({});
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

  const [crawlRunning, setCrawlRunning] = useState(false);
  const [crawlMessage, setCrawlMessage] = useState<string | null>(null);

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

  const effectiveBucket = lifecycle === "watch" ? "all" : businessFocus ? "relevant" : bucketFilter;

  const fetchOpportunities = useCallback(() => {
    setLoading(true);
    const qs = buildQueryString({
      keyword: debouncedKeyword,
      status: statusFilter,
      businessStatus: businessStatusFilter,
      workflow: workflowFilter,
      country: countryFilter,
      stateProvince: stateProvinceFilter,
      northAmericaOnly,
      unknownLocation: unknownLocationOnly,
      procurementType: procurementTypeFilter,
      bucket: effectiveBucket,
      lifecycle,
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
        if (!res.ok) throw new Error("加载招标机会失败");
        return res.json();
      })
      .then((result: PaginatedResponse<OpportunitySummary>) => {
        setData(result);
        setError(null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [debouncedKeyword, statusFilter, businessStatusFilter, workflowFilter, countryFilter, stateProvinceFilter, northAmericaOnly, unknownLocationOnly, procurementTypeFilter, effectiveBucket, lifecycle, tagFilter, minRelevance, closingAfter, closingBefore, sortBy, page, pageSize]);

  useEffect(() => {
    fetchOpportunities();
  }, [fetchOpportunities]);

  useEffect(() => {
    fetch("/api/opportunities/counts")
      .then((res) => res.ok ? res.json() : null)
      .then((counts) => {
        if (counts) setLifecycleCounts(counts);
      })
      .catch(() => {});
  }, []);

  const opportunities = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const activeFilterCount = [
    statusFilter,
    businessStatusFilter,
    workflowFilter,
    countryFilter,
    stateProvinceFilter,
    procurementTypeFilter,
    northAmericaOnly ? "northAmericaOnly" : "",
    unknownLocationOnly ? "unknownLocationOnly" : "",
    bucketFilter !== "relevant" ? bucketFilter : "",
    tagFilter,
    closingAfter,
    closingBefore,
    minRelevance > 0 ? String(minRelevance) : "",
  ].filter(Boolean).length;

  function clearFilters() {
    setStatusFilter("");
    setBusinessStatusFilter("");
    setWorkflowFilter("");
    setCountryFilter("");
    setStateProvinceFilter("");
    setNorthAmericaOnly(false);
    setUnknownLocationOnly(false);
    setProcurementTypeFilter("");
    setBucketFilter("relevant");
    setTagFilter("");
    setMinRelevance(0);
    setClosingAfter("");
    setClosingBefore("");
    setLifecycle("actionable");
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
      businessStatus: businessStatusFilter,
      country: countryFilter,
      stateProvince: stateProvinceFilter,
      northAmericaOnly,
      unknownLocation: unknownLocationOnly,
      procurementType: procurementTypeFilter,
      bucket: effectiveBucket,
      lifecycle,
      workflow: workflowFilter,
      tag: tagFilter,
      minRelevance,
      closingAfter,
      closingBefore,
    });
    window.open(`/api/exports?${qs}`, "_blank");
  }

  const triggerCrawl = useCallback(async () => {
    if (crawlRunning) return;
    setCrawlRunning(true);
    setCrawlMessage(null);
    try {
      const res = await fetch("/api/crawler/trigger", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        // 服务端可能返回 status="already_running"（已有抓取在进行中，未派发新任务）
        // 或 status="dispatched"（成功派发新任务）。前端用不同文案告知用户。
        const masterTaskId =
          (body?.task_ids?.[0]?.master_task_id as string | undefined) ||
          (body?.task_id as string | undefined) ||
          null;
        const isAlreadyRunning = body?.status === "already_running";
        const userMessage = isAlreadyRunning
          ? "已有抓取正在进行中，无需重复触发。可以在「抓取日志」页查看进度。"
          : "已开始抓取。完成通常需要数分钟，可以在「抓取日志」页查看进度，结果出来后此列表会自动刷新。";
        setCrawlMessage(
          masterTaskId ? `${userMessage}（任务 ID: ${masterTaskId.slice(0, 8)}…）` : userMessage
        );
      } else {
        setCrawlMessage(body?.error || body?.detail || "派发失败，请稍后重试");
      }
    } catch {
      setCrawlMessage("无法连接抓取服务，请稍后重试");
    } finally {
      // 前端 30 秒按钮锁是 UX 保护；服务端 60 秒 Redis 锁是真正的防重复保障
      window.setTimeout(() => setCrawlRunning(false), 30_000);
    }
  }, [crawlRunning]);

  async function handleBusinessStatusChange(opp: OpportunitySummary, nextStatus: string) {
    if (!nextStatus || opp.businessStatus === nextStatus) return;
    let reason = "";
    if (nextStatus === "not_fit" || nextStatus === "archived") {
      const promptMessage = nextStatus === "archived"
        ? "归档原因（方便以后回顾，例如：等审批 / 资料不全 / 暂时无人跟进）"
        : "原因（必填）";
      reason = window.prompt(promptMessage, "")?.trim() ?? "";
      if (!reason) return;
    }
    try {
      const res = await fetch(`/api/opportunities/${opp.id}/business-status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newStatus: nextStatus, reason }),
      });
      if (!res.ok) {
        throw new Error("状态更新失败");
      }
      fetchOpportunities();
    } catch {
      setError("业务状态更新失败");
    }
  }

  const selectClass = "h-8 rounded-md border border-input bg-card px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring appearance-none cursor-pointer";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">招标机会</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {loading ? "加载中…" : `${total.toLocaleString()} 条结果`}
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
            聚焦模式
          </button>
          {canWrite && (
            <button
              onClick={triggerCrawl}
              disabled={crawlRunning}
              title="立即触发一次全量抓取（已归档/已标注的标的不会被覆盖）"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              {crawlRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {crawlRunning ? "抓取中…" : "运行抓取"}
            </button>
          )}
          <button onClick={handleExport} className="inline-flex items-center gap-1.5 rounded-md border bg-card px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            <Download className="h-3.5 w-3.5" />
            导出
          </button>
        </div>
      </div>

      {crawlMessage && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800 flex items-start justify-between gap-2">
          <span>{crawlMessage}</span>
          <button onClick={() => setCrawlMessage(null)} className="text-blue-600 hover:text-blue-800 shrink-0">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          placeholder="搜索百叶窗、窗帘、遮光帘、床品…"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="h-10 w-full rounded-lg border bg-card pl-10 pr-4 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Lifecycle tabs */}
      <div className="grid gap-2 sm:grid-cols-4">
        {LIFECYCLE_TABS.map((tab) => {
          const active = lifecycle === tab.value;
          const count = lifecycleCounts[tab.value] ?? 0;
          return (
            <button
              key={tab.value}
              onClick={() => {
                setLifecycle(tab.value);
                setPage(1);
                if (tab.value === "closing_soon") setSortBy("closing_soon");
              }}
              className={`rounded-lg border p-3 text-left transition-colors ${
                active ? "border-primary bg-primary/5 shadow-sm" : "bg-card hover:bg-muted/40"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{tab.label}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                  {count.toLocaleString()}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{tab.description}</p>
            </button>
          );
        })}
      </div>

      {/* Business-status quick tabs (Active / Archived / Not Fit) */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {BUSINESS_STATUS_QUICK_TABS.map((tab) => {
          const active = businessStatusFilter === tab.value;
          const isArchived = tab.value === "archived";
          return (
            <button
              key={tab.value || "active"}
              onClick={() => { setBusinessStatusFilter(tab.value); setPage(1); }}
              title={tab.hint}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-card text-muted-foreground border-input hover:bg-accent hover:text-foreground"
              }`}
            >
              {isArchived && <Archive className="h-3 w-3" />}
              {tab.label}
            </button>
          );
        })}
        {businessStatusFilter === "archived" && (
          <span className="text-xs text-muted-foreground ml-1">
            归档的标的可以随时切回「进行中」继续跟进；爬虫不会覆盖你在这里的标注。
          </span>
        )}
      </div>

      {/* Primary filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <select value={lifecycle === "watch" ? "low_relevance" : businessFocus ? "relevant" : bucketFilter} onChange={(e) => { setBucketFilter(e.target.value); setBusinessFocus(false); setPage(1); }} className={selectClass} disabled={lifecycle === "watch"}>
          {BUCKET_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={sortBy} onChange={(e) => { setSortBy(e.target.value); setPage(1); }} className={selectClass}>
          {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className={selectClass}>
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={businessStatusFilter} onChange={(e) => { setBusinessStatusFilter(e.target.value); setPage(1); }} className={selectClass}>
          {BUSINESS_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={countryFilter} onChange={(e) => { setCountryFilter(e.target.value); setPage(1); }} className={selectClass}>
          {COUNTRY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={procurementTypeFilter} onChange={(e) => { setProcurementTypeFilter(e.target.value); setPage(1); }} className={selectClass}>
          {PROCUREMENT_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={workflowFilter} onChange={(e) => { setWorkflowFilter(e.target.value); setPage(1); }} className={selectClass}>
          {WORKFLOW_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-sm font-medium transition-colors ${showAdvanced ? "bg-muted text-foreground" : "bg-card text-muted-foreground hover:text-foreground"}`}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          更多
          <ChevronDown className={`h-3 w-3 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
        </button>
        {activeFilterCount > 0 && (
          <button onClick={clearFilters} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-3.5 w-3.5" /> 清除 ({activeFilterCount})
          </button>
        )}
      </div>

      {/* Advanced filters */}
      {showAdvanced && (
        <div className="flex items-center gap-4 flex-wrap rounded-lg border bg-muted/30 px-4 py-3">
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground whitespace-nowrap">最低评分:</label>
            <input type="range" min={0} max={100} step={5} value={minRelevance} onChange={(e) => { setMinRelevance(Number(e.target.value)); setPage(1); }} className="w-24 accent-primary" />
            <span className="text-sm font-medium text-tabular w-6">{minRelevance}</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground">之后</label>
            <input type="date" value={closingAfter} onChange={(e) => { setClosingAfter(e.target.value); setPage(1); }} className="h-8 rounded-md border bg-card px-2 text-sm" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground">之前</label>
            <input type="date" value={closingBefore} onChange={(e) => { setClosingBefore(e.target.value); setPage(1); }} className="h-8 rounded-md border bg-card px-2 text-sm" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground">省/州</label>
            <input
              value={stateProvinceFilter}
              onChange={(e) => {
                setStateProvinceFilter(e.target.value.toUpperCase());
                setPage(1);
              }}
              placeholder="ON / BC / TX"
              className="h-8 w-28 rounded-md border bg-card px-2 text-sm"
            />
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={northAmericaOnly}
              onChange={(e) => {
                setNorthAmericaOnly(e.target.checked);
                setPage(1);
              }}
            />
            仅北美
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={unknownLocationOnly}
              onChange={(e) => {
                setUnknownLocationOnly(e.target.checked);
                setPage(1);
              }}
            />
            未知地址
          </label>
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
                <TableHead className="font-semibold">招标机会</TableHead>
                <TableHead className="font-semibold w-28">评分</TableHead>
                <TableHead className="font-semibold">关联度</TableHead>
                <TableHead className="font-semibold">发标机构</TableHead>
                <TableHead className="font-semibold whitespace-nowrap">截止日期</TableHead>
                <TableHead className="font-semibold">分析</TableHead>
                <TableHead className="font-semibold">业务状态</TableHead>
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
                    <div className="flex flex-col gap-1">
                      <span>{formatDate(opp.closingDate)}</span>
                      {opp.lifecycleState === "closing_soon" && (
                        <span className="w-fit rounded bg-amber-100 px-1.5 py-px text-[10px] font-medium text-amber-700">即将截止</span>
                      )}
                      {opp.lifecycleState === "expired" && (
                        <span className="w-fit rounded bg-slate-100 px-1.5 py-px text-[10px] font-medium text-slate-600">已过期</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <AnalysisBadge opp={opp} />
                  </TableCell>
                  <TableCell>
                    <select
                      value={opp.businessStatus ?? "new_discovered"}
                      onChange={(e) => handleBusinessStatusChange(opp, e.target.value)}
                      disabled={!canWrite}
                      className="h-8 rounded-md border border-input bg-card px-2 text-xs"
                    >
                      {BUSINESS_STATUS_OPTIONS.filter((o) => o.value).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/dashboard/opportunities/${opp.id}`}
                      className="invisible group-hover:visible inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
                    >
                      查看
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && opportunities.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-16 text-center">
                    <FileSearch className="mx-auto h-10 w-10 text-muted-foreground/30 mb-3" />
                    <p className="text-sm font-medium text-muted-foreground">没有匹配筛选条件的机会</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">请调整搜索或筛选条件</p>
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
            显示 {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)}，共 {total.toLocaleString()} 条
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
