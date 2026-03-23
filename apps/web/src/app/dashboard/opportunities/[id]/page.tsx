"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft,
  Calendar,
  MapPin,
  Building2,
  Globe,
  FileText,
  Hash,
  Phone,
  Mail,
  User,
  Clock,
  DollarSign,
  Tag,
  ExternalLink,
  Plus,
  Download,
  Loader2,
  Flame,
  Eye,
  Bookmark,
  ArrowRight,
  XCircle,
  Radio,
  Sparkles,
  MessageSquare,
  LayoutDashboard,
  Upload,
  AlertCircle,
  CheckCircle,
  X,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatDate,
  formatCurrency,
  getRelevanceColor,
  getBucketLabel,
  getBucketColor,
} from "@/lib/utils";
import type { OpportunityDetail, QingyanSyncInfo, WorkflowStatus } from "@/types";
import { QingyanPushButton } from "@/components/qingyan/qingyan-push-button";
import { QingyanSyncCard } from "@/components/qingyan/qingyan-sync-card";

const statusMap: Record<string, { label: string; variant: "success" | "warning" | "destructive" | "outline" }> = {
  open: { label: "开放", variant: "success" },
  closed: { label: "已关闭", variant: "outline" },
  awarded: { label: "已授标", variant: "warning" },
  cancelled: { label: "已取消", variant: "destructive" },
};

const WORKFLOW_ACTIONS: { value: WorkflowStatus; icon: typeof Flame; label: string }[] = [
  { value: "hot", icon: Flame, label: "紧急" },
  { value: "review", icon: Eye, label: "待审" },
  { value: "shortlisted", icon: Bookmark, label: "候选" },
  { value: "pursuing", icon: ArrowRight, label: "跟进" },
  { value: "monitor", icon: Radio, label: "监控" },
  { value: "passed", icon: XCircle, label: "跳过" },
];

type TabId = "summary" | "analysis" | "documents" | "notes";

export default function OpportunityDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [opp, setOpp] = useState<OpportunityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newNote, setNewNote] = useState("");
  const [submittingNote, setSubmittingNote] = useState(false);
  const [updatingWorkflow, setUpdatingWorkflow] = useState(false);
  const [intel, setIntel] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<TabId>("summary");
  const [qingyanSync, setQingyanSync] = useState<QingyanSyncInfo | null>(null);
  const [retryingQingyan, setRetryingQingyan] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [analysisPhase, setAnalysisPhase] = useState<string | null>(null);

  const [miniSummary, setMiniSummary] = useState<string | null>(null);
  const [miniLoading, setMiniLoading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchDetail = useCallback(() => {
    setLoading(true);
    fetch(`/api/opportunities/${id}`)
      .then((res) => {
        if (res.status === 404) throw new Error("not_found");
        if (!res.ok) throw new Error("加载失败");
        return res.json();
      })
      .then((data: OpportunityDetail) => {
        setOpp(data);
        setError(null);
        if (data.businessFitExplanation) setMiniSummary(data.businessFitExplanation);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  const fetchIntelligence = useCallback(() => {
    fetch(`/api/intelligence/${id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setIntel(data))
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    fetchDetail();
    fetchIntelligence();
  }, [fetchDetail, fetchIntelligence]);

  async function handleGenerateMiniSummary() {
    setMiniLoading(true);
    try {
      const res = await fetch("/api/intelligence/mini-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunityId: id }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.summary) setMiniSummary(data.summary);
      }
    } catch { /* silent */ }
    finally { setMiniLoading(false); }
  }

  async function handleUploadAnalyze() {
    if (uploadFiles.length === 0) {
      setUploadError("请先选择要上传的招标文件");
      return;
    }

    const validTypes = [".pdf", ".docx", ".doc", ".txt", ".xlsx", ".xls", ".csv"];
    const invalidFiles = uploadFiles.filter(f => !validTypes.some(ext => f.name.toLowerCase().endsWith(ext)));
    if (invalidFiles.length > 0) {
      setUploadError(`不支持的文件类型: ${invalidFiles.map(f => f.name).join(", ")}`);
      return;
    }

    setUploading(true);
    setUploadError(null);
    setAnalysisPhase("正在上传文档...");
    try {
      const formData = new FormData();
      for (const f of uploadFiles) formData.append("files", f);
      formData.append("opportunity_id", id);

      const timer = setTimeout(() => setAnalysisPhase("AI 正在深度分析文档内容..."), 3000);
      const res = await fetch("/api/intelligence/upload-analyze", {
        method: "POST",
        body: formData,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "上传分析失败" }));
        throw new Error(err.detail || err.error || "上传分析失败");
      }
      const result = await res.json();
      if (result.status === "error") throw new Error(result.message || "分析失败");
      if (result.status === "budget_exceeded") throw new Error(result.message || "AI 预算已用完，请联系管理员");

      setAnalysisPhase("加载结果...");
      await new Promise((r) => setTimeout(r, 500));
      fetchIntelligence();
      fetchDetail();
      setActiveTab("analysis");
      setUploadFiles([]);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "上传分析失败");
    } finally {
      setUploading(false);
      setAnalysisPhase(null);
    }
  }

  async function handleWorkflowChange(status: WorkflowStatus) {
    setUpdatingWorkflow(true);
    try {
      const res = await fetch(`/api/opportunities/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowStatus: status }),
      });
      if (!res.ok) throw new Error();
      fetchDetail();
    } catch { setActionError("操作失败"); setTimeout(() => setActionError(null), 4000); }
    finally { setUpdatingWorkflow(false); }
  }

  async function handleAddNote() {
    if (!newNote.trim()) return;
    setSubmittingNote(true);
    try {
      const res = await fetch(`/api/opportunities/${id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newNote.trim() }),
      });
      if (!res.ok) throw new Error();
      setNewNote("");
      fetchDetail();
    } catch { setActionError("备注保存失败"); setTimeout(() => setActionError(null), 4000); }
    finally { setSubmittingNote(false); }
  }

  function removeFile(index: number) {
    setUploadFiles(prev => prev.filter((_, i) => i !== index));
    setUploadError(null);
  }

  // Extract Markdown report from new v4 format only
  const reportMarkdown: string | null = (() => {
    if (!intel?.intelligence) return null;
    const summary = intel.intelligence.intelligenceSummary || intel.intelligence.intelligence_summary;
    if (!summary) return null;
    const parsed = typeof summary === "string"
      ? (() => { try { return JSON.parse(summary); } catch { return null; } })()
      : summary;
    return parsed?.report_markdown || null;
  })();

  const hasReport = !!reportMarkdown;
  const analyzedAt = intel?.intelligence?.analyzedAt || intel?.intelligence?.analyzed_at;

  const backLink = (
    <Link href="/dashboard/opportunities" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
      <ArrowLeft className="h-4 w-4" /> 返回列表
    </Link>
  );

  if (loading) {
    return (
      <div className="space-y-4">
        {backLink}
        <Skeleton className="h-16 w-full rounded-xl" />
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-4">
            <Skeleton className="h-32 rounded-lg" />
            <Skeleton className="h-48 rounded-lg" />
          </div>
          <Skeleton className="h-48 rounded-lg" />
        </div>
      </div>
    );
  }

  if (error === "not_found") {
    return (
      <div className="space-y-4">
        {backLink}
        <div className="rounded-lg border p-10 text-center">
          <h2 className="text-base font-semibold">机会未找到</h2>
          <p className="mt-1 text-xs text-muted-foreground">该机会不存在或已被删除。</p>
        </div>
      </div>
    );
  }

  if (error || !opp) {
    return (
      <div className="space-y-4">{backLink}
        <div className="rounded-lg border p-6 text-center text-sm text-destructive">{error}</div>
      </div>
    );
  }

  const docs = intel?.documents?.length ? intel.documents : opp.documents;
  const statusInfo = statusMap[opp.status] || { label: opp.status, variant: "outline" as const };

  const tabs: { id: TabId; label: string; icon: typeof LayoutDashboard; count?: number }[] = [
    { id: "summary", label: "摘要", icon: LayoutDashboard },
    { id: "analysis", label: "分析", icon: Sparkles },
    { id: "documents", label: "文件", icon: FileText, count: docs?.length || 0 },
    { id: "notes", label: "备注", icon: MessageSquare, count: opp.notes.length },
  ];

  return (
    <div className="space-y-3">
      {backLink}

      {/* ══════ HEADER ══════ */}
      <div className="sticky top-0 z-30 -mx-1 px-1">
        <div className="rounded-xl border bg-card/95 p-3 shadow-sm backdrop-blur-sm">
          <div className="flex items-center gap-3 flex-wrap">
            {/* Score ring */}
            <div className="relative h-12 w-12 shrink-0">
              <svg className="h-12 w-12 -rotate-90" viewBox="0 0 48 48">
                <circle cx="24" cy="24" r="20" fill="none" strokeWidth="3" className="stroke-muted" />
                <circle cx="24" cy="24" r="20" fill="none" strokeWidth="3" strokeLinecap="round"
                  className={opp.relevanceScore >= 80 ? "stroke-emerald-500" : opp.relevanceScore >= 50 ? "stroke-amber-500" : "stroke-red-400"}
                  strokeDasharray={`${(opp.relevanceScore / 100) * 125.6} 125.6`} />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-sm font-bold">{opp.relevanceScore}</span>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-sm font-bold truncate max-w-[500px]">{opp.title}</h1>
                <Badge variant={statusInfo.variant} className="text-[10px]">{statusInfo.label}</Badge>
                {hasReport && (
                  <Badge className="bg-emerald-600 text-white text-[10px] hover:bg-emerald-700">
                    <CheckCircle className="h-3 w-3 mr-1" />已分析
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                {opp.organization && `${opp.organization} · `}
                {[opp.city, opp.region].filter(Boolean).join(", ")}
                {opp.closingDate && ` · 截止 ${formatDate(opp.closingDate)}`}
              </p>
            </div>

            <div className="flex items-center gap-1 shrink-0 flex-wrap">
              {WORKFLOW_ACTIONS.map((a) => {
                const active = opp.workflowStatus === a.value;
                return (
                  <button key={a.value} onClick={() => handleWorkflowChange(a.value)}
                    disabled={updatingWorkflow || active}
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-medium transition-all disabled:opacity-50 ${
                      active ? "bg-primary/10 ring-1 ring-primary/30 text-primary"
                        : "border text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}>
                    <a.icon className="h-3 w-3" />{a.label}
                  </button>
                );
              })}
              <div className="ml-1 pl-1.5 border-l">
                <QingyanPushButton opportunity={opp} recommendation={undefined}
                  feasibilityScore={opp.relevanceScore} darkMode={false}
                  onSyncUpdate={(sync) => setQingyanSync(sync)} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {actionError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{actionError}</div>
      )}

      {/* ══════ TABS ══════ */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)}>
        <TabsList className="w-full justify-start h-10 bg-muted/50 rounded-lg p-1">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id} className="gap-1.5 data-[state=active]:shadow-sm text-xs">
              <tab.icon className="h-3.5 w-3.5" />{tab.label}
              {tab.count != null && tab.count > 0 && (
                <span className="rounded-full bg-background px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">{tab.count}</span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="grid gap-4 lg:grid-cols-3 mt-4">
          <div className="lg:col-span-2 space-y-4">

            {/* ══════ SUMMARY TAB ══════ */}
            {activeTab === "summary" && (
              <>
                {/* AI 初步评估 */}
                <Card className="border-blue-200/50 bg-gradient-to-br from-blue-50/30 to-transparent">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-blue-500" />
                        AI 初步评估
                      </CardTitle>
                      {!miniSummary && !miniLoading && (
                        <button onClick={handleGenerateMiniSummary}
                          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1 text-[10px] font-medium text-white hover:bg-blue-700 transition-colors">
                          <Sparkles className="h-3 w-3" />生成评估
                        </button>
                      )}
                      {miniSummary && (
                        <button onClick={handleGenerateMiniSummary} disabled={miniLoading}
                          className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground">
                          <RefreshCw className={`h-3 w-3 ${miniLoading ? "animate-spin" : ""}`} />重新生成
                        </button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    {miniSummary ? (
                      <p className="text-sm leading-relaxed text-foreground/90">{miniSummary}</p>
                    ) : miniLoading ? (
                      <div className="flex items-center gap-2 py-2">
                        <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                        <span className="text-sm text-muted-foreground">AI 正在生成初步评估...</span>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground py-1">
                        基于招标描述，AI 可生成 2-3 句话的初步匹配评估，帮助快速判断是否值得深入了解。
                      </p>
                    )}
                  </CardContent>
                </Card>

                {/* Metadata */}
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-semibold">招标详情</CardTitle>
                      {opp.sourceUrl && (
                        <a href={opp.sourceUrl} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium">
                          <ExternalLink className="h-3 w-3" /> 查看原文
                        </a>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                      <MetaRow icon={Building2} label="采购机构" value={opp.organization} />
                      <MetaRow icon={MapPin} label="地点" value={[opp.city, opp.region, opp.country].filter(Boolean).join(", ")} />
                      <MetaRow icon={Hash} label="招标编号" value={opp.solicitationNumber} />
                      <MetaRow icon={DollarSign} label="预估价值" value={formatCurrency(opp.estimatedValue, opp.currency)} />
                      <MetaRow icon={Calendar} label="发布日期" value={formatDate(opp.postedDate)} />
                      <MetaRow icon={Clock} label="截止日期" value={formatDate(opp.closingDate, "MMM d, yyyy h:mm a")} />
                      <MetaRow icon={Tag} label="类别" value={opp.category} />
                      <MetaRow icon={Globe} label="来源" value={opp.sourceName} />
                    </div>
                  </CardContent>
                </Card>

                {/* Description */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold">招标描述</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {(() => {
                      const desc = opp.descriptionFull || opp.descriptionSummary || "";
                      if (!desc || desc.startsWith("http://") || desc.startsWith("https://")) {
                        return <p className="text-sm text-muted-foreground italic py-2">暂无描述 — 请查看原始招标文件。</p>;
                      }
                      return (
                        <div className="prose prose-sm max-w-none text-foreground/90">
                          {desc.split("\n").map((line, i) => (
                            <p key={i} className={line.startsWith("-") ? "ml-4" : ""}>{line || <br />}</p>
                          ))}
                        </div>
                      );
                    })()}
                  </CardContent>
                </Card>
              </>
            )}

            {/* ══════ ANALYSIS TAB ══════ */}
            {activeTab === "analysis" && (
              <>
                {/* Upload Card */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Upload className="h-4 w-4 text-emerald-600" />
                      上传招标文档 · AI 深度分析
                    </CardTitle>
                    <p className="text-xs text-muted-foreground mt-1">
                      从原网页下载招标文件后上传至此，AI 将使用 GPT-4o 生成完整的中文投标策略分析报告。
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* Drop zone */}
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="cursor-pointer border-2 border-dashed rounded-lg p-6 text-center transition-all hover:border-emerald-400 hover:bg-emerald-50/30 active:scale-[0.99]"
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept=".pdf,.docx,.doc,.txt,.xlsx,.xls,.csv"
                        className="hidden"
                        onChange={(e) => {
                          const files = Array.from(e.target.files || []);
                          if (files.length > 10) {
                            setUploadError("最多上传 10 个文件");
                            setUploadFiles(files.slice(0, 10));
                          } else {
                            setUploadFiles(files);
                            setUploadError(null);
                          }
                          e.target.value = "";
                        }}
                      />
                      {uploadFiles.length === 0 ? (
                        <div className="space-y-2">
                          <div className="mx-auto h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center">
                            <Upload className="h-5 w-5 text-muted-foreground" />
                          </div>
                          <p className="text-sm font-medium">点击选择文件</p>
                          <p className="text-xs text-muted-foreground">
                            支持 PDF、DOCX、TXT、XLSX · 最多 10 个文件 · 单文件最大 25MB
                          </p>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">点击添加更多文件</p>
                      )}
                    </div>

                    {/* File list */}
                    {uploadFiles.length > 0 && (
                      <div className="space-y-1.5">
                        {uploadFiles.map((f, i) => (
                          <div key={i} className="flex items-center gap-2.5 rounded-md border bg-muted/20 px-3 py-2">
                            <FileText className="h-4 w-4 shrink-0 text-red-500" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium truncate">{f.name}</p>
                              <p className="text-[10px] text-muted-foreground">{(f.size / 1024).toFixed(0)} KB</p>
                            </div>
                            <button onClick={() => removeFile(i)}
                              className="shrink-0 rounded-full p-1 hover:bg-muted transition-colors">
                              <X className="h-3 w-3 text-muted-foreground" />
                            </button>
                          </div>
                        ))}
                        <p className="text-[10px] text-muted-foreground text-right">
                          共 {uploadFiles.length} 个文件 · {(uploadFiles.reduce((s, f) => s + f.size, 0) / 1024 / 1024).toFixed(1)} MB
                        </p>
                      </div>
                    )}

                    {/* Error */}
                    {uploadError && (
                      <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2">
                        <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                        <p className="text-xs text-red-700">{uploadError}</p>
                      </div>
                    )}

                    {/* Progress */}
                    {analysisPhase && (
                      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                          <span className="text-xs font-medium text-blue-800">{analysisPhase}</span>
                        </div>
                        <div className="h-1.5 bg-blue-200 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-600 rounded-full animate-pulse" style={{ width: "65%" }} />
                        </div>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      <button onClick={handleUploadAnalyze}
                        disabled={uploading || uploadFiles.length === 0}
                        className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                        {uploading ? "分析中..." : "上传并分析"}
                      </button>
                      {uploadFiles.length > 0 && !uploading && (
                        <button onClick={() => { setUploadFiles([]); setUploadError(null); }}
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                          清除全部
                        </button>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Report display */}
                {hasReport ? (
                  <Card className="overflow-hidden">
                    <div className="px-5 py-3 bg-gradient-to-r from-emerald-50 to-blue-50 border-b flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-emerald-600" />
                        <span className="text-sm font-semibold text-emerald-900">AI 深度分析报告</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        {analyzedAt && `${formatDate(analyzedAt)}`} · GPT-4o · BidToGo AI
                      </span>
                    </div>
                    <CardContent className="pt-6 pb-8 px-6">
                      <article className="prose prose-sm max-w-none
                        prose-headings:text-foreground prose-headings:font-bold
                        prose-h2:text-base prose-h2:mt-8 prose-h2:mb-3 prose-h2:pb-2 prose-h2:border-b
                        prose-h3:text-sm prose-h3:mt-6 prose-h3:mb-2
                        prose-p:text-foreground/85 prose-p:leading-relaxed
                        prose-li:text-foreground/85 prose-li:leading-relaxed
                        prose-strong:text-foreground
                        prose-blockquote:text-foreground/70 prose-blockquote:border-l-emerald-400 prose-blockquote:bg-emerald-50/30 prose-blockquote:rounded-r-md prose-blockquote:py-1 prose-blockquote:px-4
                        prose-table:text-sm prose-th:bg-muted/50 prose-th:px-3 prose-th:py-2 prose-td:px-3 prose-td:py-2
                        prose-hr:my-6">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {reportMarkdown}
                        </ReactMarkdown>
                      </article>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="rounded-xl border-2 border-dashed border-muted-foreground/15 p-12 text-center">
                    <div className="mx-auto h-16 w-16 rounded-full bg-muted/30 flex items-center justify-center mb-4">
                      <Sparkles className="h-7 w-7 text-muted-foreground/40" />
                    </div>
                    <p className="text-sm font-medium text-muted-foreground">暂无深度分析报告</p>
                    <p className="text-xs text-muted-foreground/70 mt-1.5 max-w-sm mx-auto">
                      请从原网页下载招标文件，然后上传至上方区域。AI 将自动生成完整的投标策略分析报告。
                    </p>
                  </div>
                )}
              </>
            )}

            {/* ══════ DOCUMENTS TAB ══════ */}
            {activeTab === "documents" && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">附件文件 ({docs?.length || 0})</CardTitle>
                </CardHeader>
                <CardContent>
                  {(!docs || docs.length === 0) ? (
                    <div className="text-center py-8">
                      <FileText className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground">暂无附件</p>
                      <p className="text-xs text-muted-foreground/70 mt-1">上传文件后将在此处显示</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {docs.map((doc: any) => {
                        const ft = (doc.fileType || doc.file_type || "").toLowerCase();
                        const clr = ft === "pdf" ? "text-red-500" : ft.includes("doc") ? "text-blue-500" : "text-muted-foreground";
                        return (
                          <div key={doc.id} className="flex items-center gap-2.5 rounded-md border px-3 py-2 hover:bg-muted/30 transition-colors">
                            <FileText className={`h-4 w-4 shrink-0 ${clr}`} />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium truncate">{doc.title || "未命名"}</p>
                              <p className="text-[10px] text-muted-foreground">
                                {ft.toUpperCase() || "文件"}
                                {doc.fileSizeBytes ? ` · ${doc.fileSizeBytes < 1048576 ? `${(doc.fileSizeBytes/1024).toFixed(0)} KB` : `${(doc.fileSizeBytes/1048576).toFixed(1)} MB`}` : ""}
                              </p>
                            </div>
                            {(doc.textExtracted || doc.text_extracted) ? (
                              <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-200">已提取</Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-200">待处理</Badge>
                            )}
                            {doc.url && !doc.url.startsWith("upload://") && !doc.url.startsWith("agent-upload://") && (
                              <a href={doc.url} target="_blank" rel="noopener noreferrer">
                                <Download className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground transition-colors" />
                              </a>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* ══════ NOTES TAB ══════ */}
            {activeTab === "notes" && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">备注 ({opp.notes.length})</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {opp.notes.length === 0 && (
                    <p className="text-sm text-muted-foreground py-4 text-center">暂无备注</p>
                  )}
                  {opp.notes.map((note) => (
                    <div key={note.id} className="rounded-md border p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-medium">{note.userName}</span>
                        <span className="text-[10px] text-muted-foreground">{formatDate(note.createdAt, "MMM d, yyyy h:mm a")}</span>
                      </div>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{note.content}</p>
                    </div>
                  ))}
                  <div className="space-y-2 pt-2 border-t">
                    <textarea value={newNote} onChange={(e) => setNewNote(e.target.value)}
                      placeholder="添加备注…" rows={3}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none" />
                    <Button size="sm" onClick={handleAddNote} disabled={!newNote.trim() || submittingNote}>
                      {submittingNote ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                      添加备注
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* ══════ SIDEBAR ══════ */}
          <div className="space-y-4">
            {(opp.contactName || opp.contactEmail || opp.contactPhone) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">联系方式</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {opp.contactName && <MetaRow icon={User} label="姓名" value={opp.contactName} />}
                  {opp.contactEmail && <MetaRow icon={Mail} label="邮箱" value={opp.contactEmail} />}
                  {opp.contactPhone && <MetaRow icon={Phone} label="电话" value={opp.contactPhone} />}
                </CardContent>
              </Card>
            )}

            {(qingyanSync || opp.qingyanSync) && (
              <QingyanSyncCard syncInfo={qingyanSync || opp.qingyanSync!} retrying={retryingQingyan}
                onRetry={async () => {
                  const sync = qingyanSync || opp.qingyanSync;
                  if (!sync) return;
                  setRetryingQingyan(true);
                  try {
                    const res = await fetch(`/api/qingyan/retry/${sync.id}`, { method: "POST" });
                    const data = await res.json();
                    if (data.status === "synced") setQingyanSync({ ...sync, ...data, syncStatus: "synced" });
                  } catch {} finally { setRetryingQingyan(false); }
                }} />
            )}

            <MatchingPanel opp={opp} />

            {opp.industryTags.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">行业标签</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-1.5">
                    {opp.industryTags.map((tag) => (
                      <Badge key={tag} variant="default" className="text-xs">{tag}</Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </Tabs>
    </div>
  );
}

function MetaRow({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value?: string | null }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
        <p className="text-sm font-medium break-words">{value || "—"}</p>
      </div>
    </div>
  );
}

function MatchingPanel({ opp }: { opp: OpportunityDetail }) {
  const bd = opp.relevanceBreakdown ?? {};
  const primary: string[] = (bd.primary_matches as string[]) ?? [];
  const secondary: string[] = (bd.secondary_matches as string[]) ?? [];
  const contextual: string[] = (bd.contextual_matches as string[]) ?? [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">匹配分析</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">关联度</span>
          <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${getRelevanceColor(opp.relevanceScore)}`}>
            {opp.relevanceScore}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">分类</span>
          <span className={`rounded-md border px-2 py-0.5 text-[10px] font-medium ${getBucketColor(opp.relevanceBucket)}`}>
            {getBucketLabel(opp.relevanceBucket)}
          </span>
        </div>
        {primary.length > 0 && <KWGroup label="核心匹配" kw={primary} cls="bg-emerald-50 text-emerald-700" />}
        {secondary.length > 0 && <KWGroup label="次要匹配" kw={secondary} cls="bg-blue-50 text-blue-700" />}
        {contextual.length > 0 && <KWGroup label="上下文" kw={contextual} cls="bg-amber-50 text-amber-700" />}
        {opp.negativeKeywords.length > 0 && <KWGroup label="负面信号" kw={opp.negativeKeywords} cls="bg-red-50 text-red-700" />}
      </CardContent>
    </Card>
  );
}

function KWGroup({ label, kw, cls }: { label: string; kw: string[]; cls: string }) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground font-medium mb-1">{label}</p>
      <div className="flex flex-wrap gap-1">
        {kw.map((k) => <span key={k} className={`rounded px-1.5 py-0.5 text-[10px] ${cls}`}>{k}</span>)}
      </div>
    </div>
  );
}
