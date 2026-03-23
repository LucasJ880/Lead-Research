"use client";

import { useState, useEffect, useCallback } from "react";
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

const statusVariant: Record<string, "success" | "warning" | "destructive" | "outline"> = {
  open: "success",
  closed: "outline",
  awarded: "warning",
  cancelled: "destructive",
};

const WORKFLOW_ACTIONS: { value: WorkflowStatus; label: string; icon: typeof Flame; shortLabel: string }[] = [
  { value: "hot", label: "标记紧急", icon: Flame, shortLabel: "紧急" },
  { value: "review", label: "稍后审核", icon: Eye, shortLabel: "待审" },
  { value: "shortlisted", label: "列入候选", icon: Bookmark, shortLabel: "候选" },
  { value: "pursuing", label: "跟进中", icon: ArrowRight, shortLabel: "跟进" },
  { value: "monitor", label: "监控", icon: Radio, shortLabel: "监控" },
  { value: "passed", label: "跳过", icon: XCircle, shortLabel: "跳过" },
  { value: "not_relevant", label: "不相关", icon: XCircle, shortLabel: "不相关" },
];

type TabId = "summary" | "analysis" | "documents" | "notes";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

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

  // Upload & analysis state
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [analysisPhase, setAnalysisPhase] = useState<string | null>(null);

  // Mini summary state
  const [miniSummary, setMiniSummary] = useState<string | null>(null);
  const [miniLoading, setMiniLoading] = useState(false);

  const fetchDetail = useCallback(() => {
    setLoading(true);
    fetch(`/api/opportunities/${id}`)
      .then((res) => {
        if (res.status === 404) throw new Error("not_found");
        if (!res.ok) throw new Error("Failed to load opportunity");
        return res.json();
      })
      .then((data: OpportunityDetail) => {
        setOpp(data);
        setError(null);
        if (data.businessFitExplanation) {
          setMiniSummary(data.businessFitExplanation);
        }
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
      if (!res.ok) throw new Error("生成失败");
      const data = await res.json();
      if (data.summary) {
        setMiniSummary(data.summary);
      }
    } catch {
      // silently fail
    } finally {
      setMiniLoading(false);
    }
  }

  async function handleUploadAnalyze() {
    if (uploadFiles.length === 0) return;
    setUploading(true);
    setUploadError(null);
    setAnalysisPhase("正在上传文档...");
    try {
      const formData = new FormData();
      for (const f of uploadFiles) {
        formData.append("files", f);
      }
      formData.append("opportunity_id", id);

      setTimeout(() => setAnalysisPhase("正在进行 AI 深度分析..."), 2000);
      const res = await fetch("/api/intelligence/upload-analyze", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "上传分析失败" }));
        throw new Error(err.detail || err.error || "上传分析失败");
      }
      const result = await res.json();
      if (result.status === "error") throw new Error(result.message || "分析失败");
      if (result.status === "budget_exceeded") throw new Error(result.message || "AI预算已用完");

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
      if (!res.ok) throw new Error("Failed to update");
      fetchDetail();
    } catch {
      setActionError("操作失败，请重试。");
      setTimeout(() => setActionError(null), 5000);
    } finally {
      setUpdatingWorkflow(false);
    }
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
      if (!res.ok) throw new Error("Failed to save note");
      setNewNote("");
      fetchDetail();
    } catch {
      setActionError("备注保存失败，请重试。");
      setTimeout(() => setActionError(null), 5000);
    } finally {
      setSubmittingNote(false);
    }
  }

  // Extract Markdown report from intelligence data
  const reportMarkdown: string | null = (() => {
    if (!intel?.intelligence) return null;
    const summary = intel.intelligence.intelligenceSummary || intel.intelligence.intelligence_summary;
    if (!summary) return null;
    const parsed = typeof summary === "string" ? (() => { try { return JSON.parse(summary); } catch { return null; } })() : summary;
    if (parsed?.report_markdown) return parsed.report_markdown;
    return null;
  })();

  const hasReport = !!reportMarkdown;

  const backLink = (
    <Link href="/dashboard/opportunities" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
      <ArrowLeft className="h-4 w-4" /> 返回机会列表
    </Link>
  );

  if (loading) {
    return (
      <div className="space-y-4">
        {backLink}
        <Skeleton className="h-20 w-full rounded-xl" />
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-4">
            <Skeleton className="h-40 rounded-lg" />
            <Skeleton className="h-64 rounded-lg" />
          </div>
          <Skeleton className="h-60 rounded-lg" />
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
      <div className="space-y-4">
        {backLink}
        <div className="rounded-lg border p-6 text-center text-sm text-destructive">{error}</div>
      </div>
    );
  }

  const docs = intel?.documents?.length ? intel.documents : opp.documents;

  const tabs: { id: TabId; label: string; icon: typeof LayoutDashboard; count?: number }[] = [
    { id: "summary", label: "摘要", icon: LayoutDashboard },
    { id: "analysis", label: "分析", icon: Sparkles },
    { id: "documents", label: "文件", icon: FileText, count: docs?.length || 0 },
    { id: "notes", label: "备注", icon: MessageSquare, count: opp.notes.length },
  ];

  return (
    <div className="space-y-3">
      {backLink}

      {/* ══════ HEADER BAR ══════ */}
      <div className="sticky top-0 z-30 -mx-1 px-1">
        <div className="rounded-xl border bg-card/95 border-border text-foreground p-4 shadow-sm backdrop-blur-sm">
          <div className="flex items-center gap-4 flex-wrap">
            {/* Relevance Score */}
            <div className="relative h-14 w-14 shrink-0">
              <svg className="h-14 w-14 -rotate-90" viewBox="0 0 56 56">
                <circle cx="28" cy="28" r="24" fill="none" strokeWidth="4" className="stroke-muted" />
                <circle cx="28" cy="28" r="24" fill="none" strokeWidth="4" strokeLinecap="round"
                  className={
                    opp.relevanceScore >= 80 ? "stroke-emerald-500" : opp.relevanceScore >= 50 ? "stroke-amber-500" : "stroke-red-500"
                  }
                  strokeDasharray={`${(opp.relevanceScore / 100) * 150.8} 150.8`} />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-base font-bold">{opp.relevanceScore}</span>
              </div>
            </div>

            {/* Title */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-sm font-bold truncate max-w-[500px]">{opp.title}</h1>
                <Badge variant={statusVariant[opp.status] ?? "outline"} className="text-[10px] shrink-0">
                  {opp.status === "open" ? "开放" : opp.status === "closed" ? "已关闭" : opp.status.toUpperCase()}
                </Badge>
                {hasReport && (
                  <span className="rounded-md bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white">
                    已分析
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {opp.organization && `${opp.organization} · `}
                {[opp.city, opp.region].filter(Boolean).join(", ")}
                {opp.closingDate && ` · 截止 ${formatDate(opp.closingDate)}`}
              </p>
            </div>

            {/* Workflow actions */}
            <div className="flex items-center gap-1 shrink-0 flex-wrap">
              {WORKFLOW_ACTIONS.slice(0, 5).map((action) => {
                const isActive = opp.workflowStatus === action.value;
                return (
                  <button
                    key={action.value}
                    onClick={() => handleWorkflowChange(action.value)}
                    disabled={updatingWorkflow || isActive}
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-medium transition-all disabled:opacity-50 ${
                      isActive
                        ? "bg-primary/10 ring-1 ring-primary/30 text-primary"
                        : "border text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <action.icon className="h-3 w-3" />
                    {action.shortLabel}
                  </button>
                );
              })}

              <div className="ml-1 pl-1.5 border-l">
                <QingyanPushButton
                  opportunity={opp}
                  recommendation={undefined}
                  feasibilityScore={opp.relevanceScore}
                  darkMode={false}
                  onSyncUpdate={(sync) => setQingyanSync(sync)}
                />
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
              <tab.icon className="h-3.5 w-3.5" />
              {tab.label}
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
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-blue-500" />
                        AI 初步评估
                      </CardTitle>
                      {!miniSummary && (
                        <button
                          onClick={handleGenerateMiniSummary}
                          disabled={miniLoading}
                          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1 text-[10px] font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
                        >
                          {miniLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                          生成评估
                        </button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    {miniSummary ? (
                      <p className="text-sm leading-relaxed">{miniSummary}</p>
                    ) : miniLoading ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        正在生成 AI 初步评估...
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        点击&ldquo;生成评估&rdquo;按钮，AI 将根据招标描述给出 2-3 句话的初步匹配评估。
                      </p>
                    )}
                  </CardContent>
                </Card>

                {/* Metadata */}
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-semibold">机会详情</CardTitle>
                      <a href={opp.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                        <ExternalLink className="h-3 w-3" /> 查看原文
                      </a>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                      <MetaRow icon={Building2} label="机构" value={opp.organization} />
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
                    <CardTitle className="text-sm font-semibold">描述</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="prose prose-sm max-w-none text-foreground">
                      {(() => {
                        const desc = opp.descriptionFull || opp.descriptionSummary || "";
                        if (!desc || desc.startsWith("http://") || desc.startsWith("https://")) {
                          return <p className="text-xs text-muted-foreground italic">暂无描述 — 请查看原始招标文件。</p>;
                        }
                        return desc.split("\n").map((line, i) => (
                          <p key={i} className={line.startsWith("-") ? "ml-4" : ""}>
                            {line || <br />}
                          </p>
                        ));
                      })()}
                    </div>
                  </CardContent>
                </Card>
              </>
            )}

            {/* ══════ ANALYSIS TAB ══════ */}
            {activeTab === "analysis" && (
              <>
                {/* Upload Zone */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Upload className="h-4 w-4" />
                      上传招标文档进行 AI 深度分析
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-xs text-muted-foreground">
                      上传招标文件（最多 10 个 PDF/DOCX），AI 将使用 GPT-4o 进行全面分析并生成中文投标策略报告。
                    </p>
                    <label className="block cursor-pointer">
                      <input
                        type="file"
                        multiple
                        accept=".pdf,.docx,.doc,.txt,.xlsx,.xls,.csv"
                        className="hidden"
                        onChange={(e) => {
                          const files = Array.from(e.target.files || []);
                          setUploadFiles(files.slice(0, 10));
                          setUploadError(null);
                        }}
                      />
                      <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-6 text-center hover:border-blue-400 transition-colors">
                        {uploadFiles.length > 0 ? (
                          <div className="space-y-1">
                            {uploadFiles.map((f, i) => (
                              <p key={i} className="text-xs text-foreground">
                                📄 {f.name} ({(f.size / 1024).toFixed(0)} KB)
                              </p>
                            ))}
                            <p className="text-[10px] text-muted-foreground mt-2">
                              共 {uploadFiles.length} 个文件，点击可重新选择
                            </p>
                          </div>
                        ) : (
                          <div>
                            <Upload className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                            <p className="text-xs text-muted-foreground">
                              点击选择或拖拽文件（最多 10 个，支持 PDF/DOCX/TXT/XLSX）
                            </p>
                          </div>
                        )}
                      </div>
                    </label>
                    {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
                    {analysisPhase && (
                      <div className="rounded-lg border border-blue-300 bg-blue-50 px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                          <p className="text-xs font-medium text-blue-800">{analysisPhase}</p>
                        </div>
                        <div className="mt-2 h-1 bg-blue-200 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-600 rounded-full animate-pulse" style={{ width: "60%" }} />
                        </div>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleUploadAnalyze}
                        disabled={uploading || uploadFiles.length === 0}
                        className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
                      >
                        {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                        {uploading ? "分析中..." : "上传并分析"}
                      </button>
                      {uploadFiles.length > 0 && !uploading && (
                        <button
                          onClick={() => { setUploadFiles([]); setUploadError(null); }}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          清除文件
                        </button>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Markdown Report */}
                {hasReport ? (
                  <Card>
                    <CardHeader className="pb-2 border-b bg-slate-50">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm font-semibold flex items-center gap-2">
                          <Sparkles className="h-4 w-4 text-blue-600" />
                          AI 深度分析报告
                        </CardTitle>
                        <span className="text-[10px] text-muted-foreground">
                          {intel?.intelligence?.analyzedAt && `分析于 ${formatDate(intel.intelligence.analyzedAt)}`}
                          {" · GPT-4o · BidToGo AI"}
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-4">
                      <article className="prose prose-sm max-w-none prose-headings:text-foreground prose-p:text-foreground prose-li:text-foreground prose-strong:text-foreground prose-blockquote:text-muted-foreground prose-blockquote:border-l-blue-400">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {reportMarkdown}
                        </ReactMarkdown>
                      </article>
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <CardContent className="p-8 text-center">
                      <Sparkles className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
                      <p className="text-sm font-medium">暂无分析报告</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        上传招标文档后，AI 将生成完整的投标策略分析报告。
                      </p>
                    </CardContent>
                  </Card>
                )}
              </>
            )}

            {/* ══════ DOCUMENTS TAB ══════ */}
            {activeTab === "documents" && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">
                    文件 ({docs?.length || 0})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {(!docs || docs.length === 0) ? (
                    <div className="text-center py-6">
                      <FileText className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">此机会无附件文件。</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {docs.map((doc: any) => {
                        const ft = (doc.fileType || doc.file_type || "").toLowerCase();
                        const typeColor = ft === "pdf" ? "text-red-500" : ft === "doc" || ft === "docx" ? "text-blue-500" : ft === "link" ? "text-violet-500" : "text-muted-foreground";
                        const extracted = doc.textExtracted || doc.text_extracted;

                        return (
                          <div key={doc.id} className="flex items-center gap-2.5 rounded-md border px-3 py-2 hover:bg-muted/30 transition-colors">
                            <FileText className={`h-4 w-4 shrink-0 ${typeColor}`} />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium truncate">{doc.title || "未命名"}</p>
                              <p className="text-[10px] text-muted-foreground">
                                {ft.toUpperCase() || "文件"}
                                {doc.fileSizeBytes ? ` · ${formatBytes(doc.fileSizeBytes)}` : ""}
                              </p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {extracted ? (
                                <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">已提取</span>
                              ) : (
                                <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">待处理</span>
                              )}
                              {doc.url && (
                                <a href={doc.url} target="_blank" rel="noopener noreferrer">
                                  <Download className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                                </a>
                              )}
                            </div>
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
                  <CardTitle className="text-sm font-semibold">备注</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {opp.notes.length === 0 && (
                    <p className="text-sm text-muted-foreground">暂无备注。</p>
                  )}
                  {opp.notes.map((note) => (
                    <div key={note.id} className="rounded-md border p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium">{note.userName}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(note.createdAt, "MMM d, yyyy h:mm a")}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{note.content}</p>
                    </div>
                  ))}
                  <div className="space-y-2 pt-2 border-t">
                    <textarea
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      placeholder="添加备注…"
                      rows={3}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                    />
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
            {/* Contact */}
            {(opp.contactName || opp.contactEmail || opp.contactPhone) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">联系方式</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <MetaRow icon={User} label="姓名" value={opp.contactName} />
                  <MetaRow icon={Mail} label="邮箱" value={opp.contactEmail} />
                  <MetaRow icon={Phone} label="电话" value={opp.contactPhone} />
                </CardContent>
              </Card>
            )}

            {/* Qingyan Integration */}
            {(qingyanSync || opp.qingyanSync) && (
              <QingyanSyncCard
                syncInfo={qingyanSync || opp.qingyanSync!}
                retrying={retryingQingyan}
                onRetry={async () => {
                  const sync = qingyanSync || opp.qingyanSync;
                  if (!sync) return;
                  setRetryingQingyan(true);
                  try {
                    const res = await fetch(`/api/qingyan/retry/${sync.id}`, { method: "POST" });
                    const data = await res.json();
                    if (data.status === "synced") {
                      setQingyanSync({ ...sync, ...data, syncStatus: "synced" });
                    }
                  } catch { /* retry silently */ }
                  finally { setRetryingQingyan(false); }
                }}
              />
            )}

            {/* Matching Info */}
            <MatchingPanel opp={opp} />

            {/* Industry Tags */}
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

/* ══════ MetaRow ══════ */
function MetaRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value?: string | null;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium break-words">{value || "—"}</p>
      </div>
    </div>
  );
}

/* ══════ MatchingPanel ══════ */
function MatchingPanel({ opp }: { opp: OpportunityDetail }) {
  const breakdown = opp.relevanceBreakdown ?? {};
  const primaryMatches: string[] = (breakdown.primary_matches as string[]) ?? [];
  const secondaryMatches: string[] = (breakdown.secondary_matches as string[]) ?? [];
  const contextualMatches: string[] = (breakdown.contextual_matches as string[]) ?? [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">匹配原因</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">关联度</span>
          <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${getRelevanceColor(opp.relevanceScore)}`}>
            {opp.relevanceScore} / 100
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">分类</span>
          <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${getBucketColor(opp.relevanceBucket)}`}>
            {getBucketLabel(opp.relevanceBucket)}
          </span>
        </div>

        {primaryMatches.length > 0 && <KWGroup label="主要匹配" keywords={primaryMatches} color="bg-emerald-50 text-emerald-700" />}
        {secondaryMatches.length > 0 && <KWGroup label="次要匹配" keywords={secondaryMatches} color="bg-blue-50 text-blue-700" />}
        {contextualMatches.length > 0 && <KWGroup label="上下文匹配" keywords={contextualMatches} color="bg-amber-50 text-amber-700" />}
        {opp.negativeKeywords.length > 0 && <KWGroup label="负面匹配" keywords={opp.negativeKeywords} color="bg-red-50 text-red-700" />}
      </CardContent>
    </Card>
  );
}

function KWGroup({ label, keywords, color }: { label: string; keywords: string[]; color: string }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1">
        {keywords.map((kw) => (
          <span key={kw} className={`inline-block rounded-sm px-1.5 py-0.5 text-[10px] ${color}`}>{kw}</span>
        ))}
      </div>
    </div>
  );
}
