"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
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
  CheckCircle2,
  Sparkles,
  AlertTriangle,
  ChevronDown,
  Shield,
  Package,
  ListChecks,
  MessageSquare,
  LayoutDashboard,
  Zap,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatDate,
  formatCurrency,
  getRelevanceColor,
  getBucketLabel,
  getBucketColor,
  getWorkflowLabel,
  getWorkflowColor,
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
  { value: "hot", label: "Mark Hot", icon: Flame, shortLabel: "Hot" },
  { value: "review", label: "Review Later", icon: Eye, shortLabel: "Review" },
  { value: "shortlisted", label: "Shortlist", icon: Bookmark, shortLabel: "Shortlisted" },
  { value: "pursuing", label: "Pursuing", icon: ArrowRight, shortLabel: "Pursuing" },
  { value: "monitor", label: "Monitor", icon: Radio, shortLabel: "Monitor" },
  { value: "passed", label: "Pass", icon: XCircle, shortLabel: "Passed" },
  { value: "not_relevant", label: "Not Relevant", icon: XCircle, shortLabel: "Not Relevant" },
];

type TabId = "summary" | "analysis" | "documents" | "evidence" | "notes";

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
  const [intelLoading, setIntelLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisPhase, setAnalysisPhase] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [intelError, setIntelError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("summary");
  const [qingyanSync, setQingyanSync] = useState<QingyanSyncInfo | null>(null);
  const [retryingQingyan, setRetryingQingyan] = useState(false);

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
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  const fetchIntelligence = useCallback(() => {
    setIntelLoading(true);
    setIntelError(false);
    fetch(`/api/intelligence/${id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setIntel(data))
      .catch(() => setIntelError(true))
      .finally(() => setIntelLoading(false));
  }, [id]);

  useEffect(() => {
    fetchDetail();
    fetchIntelligence();
  }, [fetchDetail, fetchIntelligence]);

  async function handleAnalyze(mode: "quick" | "deep" = "quick") {
    setAnalyzing(true);
    setAnalysisError(null);
    setAnalysisPhase("Extracting documents...");
    try {
      setTimeout(() => setAnalysisPhase("Analyzing with AI..."), 3000);
      const res = await fetch("/api/intelligence/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunityId: id, mode }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Analysis failed" }));
        throw new Error(err.detail || err.error || "Analysis failed");
      }
      const result = await res.json().catch(() => ({}));
      if (result.status === "failed") {
        throw new Error(result.message || "Analysis failed — model or API error");
      }
      if (result.status === "budget_exceeded") {
        throw new Error(result.message || "AI budget limit reached. Try again later or contact admin.");
      }
      setAnalysisPhase("Loading results...");
      await new Promise((r) => setTimeout(r, 800));
      fetchIntelligence();
      setActiveTab("analysis");
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
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
      setActionError("Failed to update workflow status.");
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
      setActionError("Failed to save note. Please try again.");
      setTimeout(() => setActionError(null), 5000);
    } finally {
      setSubmittingNote(false);
    }
  }

  const backLink = (
    <Link href="/dashboard/opportunities" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
      <ArrowLeft className="h-4 w-4" /> Back to Opportunities
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
          <h2 className="text-base font-semibold">Opportunity Not Found</h2>
          <p className="mt-1 text-xs text-muted-foreground">This opportunity doesn&apos;t exist or has been removed.</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        {backLink}
        <div className="rounded-lg border p-6 text-center text-sm text-destructive">{error}</div>
      </div>
    );
  }

  if (!opp) return null;


  const rpt: any = intel?.intelligence?.intelligenceSummary || intel?.intelligence?.intelligence_summary || {};
  const isV2 = rpt.report_version === "2.0";
  const verdict = rpt.verdict || {};
  const scores = rpt.feasibility_scores || {};
  const compliance = rpt.compliance_risks || {};
  const overallScore: number | undefined = isV2 ? scores.overall_score : intel?.intelligence?.feasibilityScore;
  const recommendation: string | undefined = isV2 ? verdict.recommendation : intel?.intelligence?.recommendationStatus;
  const confidence: string | undefined = verdict.confidence;
  const isFallback: boolean = (intel?.intelligence?.analysisModel || rpt.analysis_model) === "fallback_rule_based" || rpt.fallback_used === true;
  const hasIntel = !!intel?.intelligence;

  const fatalBlockers = (compliance.red_flags || []).filter(
  
    (rf: any) => rf.severity === "fatal_blocker"
  );

  const recColors: Record<string, string> = {
    strongly_pursue: "bg-emerald-600 text-white",
    pursue: "bg-emerald-600 text-white",
    review_carefully: "bg-amber-500 text-white",
    low_probability: "bg-orange-500 text-white",
    skip: "bg-red-600 text-white",
  };

  const tabs: { id: TabId; label: string; icon: typeof LayoutDashboard; count?: number }[] = [
    { id: "summary", label: "Summary", icon: LayoutDashboard },
    { id: "analysis", label: "Analysis", icon: Sparkles },
    { id: "documents", label: "Documents", icon: FileText, count: intel?.documents?.length || opp.documents.length },
    { id: "evidence", label: "Evidence", icon: ListChecks },
    { id: "notes", label: "Notes", icon: MessageSquare, count: opp.notes.length },
  ];

  return (
    <div className="space-y-3">
      {backLink}

      {/* ════════════════════ DECISION BAR — sticky ════════════════════ */}
      <div className="sticky top-0 z-30 -mx-1 px-1">
        <div className={`rounded-xl border p-4 shadow-sm backdrop-blur-sm ${
          hasIntel && !isFallback
            ? "bg-slate-900/95 border-slate-700 text-white"
            : "bg-card/95 border-border text-foreground"
        }`}>
          <div className="flex items-center gap-4 flex-wrap">
            {/* Circular Score Gauge */}
            {overallScore != null && (
              <div className="relative h-14 w-14 shrink-0">
                <svg className="h-14 w-14 -rotate-90" viewBox="0 0 56 56">
                  <circle cx="28" cy="28" r="24" fill="none" strokeWidth="4"
                    className={hasIntel && !isFallback ? "stroke-slate-700" : "stroke-muted"} />
                  <circle cx="28" cy="28" r="24" fill="none" strokeWidth="4" strokeLinecap="round"
                    className={
                      overallScore >= 65 ? "stroke-emerald-500" : overallScore >= 40 ? "stroke-amber-500" : "stroke-red-500"
                    }
                    strokeDasharray={`${(overallScore / 100) * 150.8} 150.8`} />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-base font-bold">{overallScore}</span>
                </div>
              </div>
            )}

            {/* Title + Verdict */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-sm font-bold truncate max-w-[400px]">{opp.title}</h1>
                <Badge variant={statusVariant[opp.status] ?? "outline"} className="text-[10px] shrink-0">
                  {opp.status.toUpperCase()}
                </Badge>
                {recommendation && (
                  <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold tracking-wide shrink-0 ${recColors[recommendation] || "bg-gray-600 text-white"}`}>
                    {recommendation.replace(/_/g, " ").toUpperCase()}
                  </span>
                )}
                {confidence && (
                  <span className={`text-[10px] font-medium shrink-0 ${
                    hasIntel && !isFallback
                      ? confidence === "high" ? "text-emerald-300" : confidence === "medium" ? "text-blue-300" : "text-amber-300"
                      : confidence === "high" ? "text-emerald-700" : confidence === "medium" ? "text-blue-700" : "text-amber-700"
                  }`}>
                    {confidence.replace(/_/g, " ")} confidence
                  </span>
                )}
              </div>
              {verdict.one_line && (
                <p className={`text-xs mt-0.5 truncate ${hasIntel && !isFallback ? "text-white/70" : "text-muted-foreground"}`}>
                  {verdict.one_line}
                </p>
              )}

              {/* Feasibility sub-scores inline */}
              {isV2 && !isFallback && (scores.technical_feasibility != null || scores.compliance_feasibility != null || scores.commercial_feasibility != null) && (
                <div className="flex items-center gap-4 mt-2">
                  {[
                    { label: "Tech", val: scores.technical_feasibility },
                    { label: "Compliance", val: scores.compliance_feasibility },
                    { label: "Commercial", val: scores.commercial_feasibility },
                  ].map((s) => (
                    <div key={s.label} className="flex items-center gap-1.5">
                      <span className={`text-[10px] ${hasIntel && !isFallback ? "text-slate-400" : "text-muted-foreground"}`}>{s.label}</span>
                      <div className={`w-12 h-1.5 rounded-full overflow-hidden ${hasIntel && !isFallback ? "bg-slate-700" : "bg-muted"}`}>
                        <div
                          className={`h-full rounded-full ${
                            (s.val ?? 0) >= 65 ? "bg-emerald-500" : (s.val ?? 0) >= 40 ? "bg-amber-500" : "bg-red-500"
                          }`}
                          style={{ width: `${Math.min(s.val ?? 0, 100)}%` }}
                        />
                      </div>
                      <span className={`text-[10px] font-bold ${
                        (s.val ?? 0) >= 65 ? "text-emerald-500" : (s.val ?? 0) >= 40 ? "text-amber-500" : "text-red-500"
                      }`}>{s.val ?? "—"}</span>
                    </div>
                  ))}
                </div>
              )}
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
                        ? hasIntel && !isFallback
                          ? "bg-white/15 ring-1 ring-white/30 text-white"
                          : "bg-primary/10 ring-1 ring-primary/30 text-primary"
                        : hasIntel && !isFallback
                          ? "border border-slate-600 text-slate-300 hover:bg-slate-700"
                          : "border text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <action.icon className="h-3 w-3" />
                    {action.shortLabel}
                  </button>
                );
              })}

              <div className={`ml-1 pl-1.5 ${hasIntel && !isFallback ? "border-l border-slate-600" : "border-l"}`}>
                <QingyanPushButton
                  opportunity={opp}
                  recommendation={recommendation}
                  feasibilityScore={overallScore}
                  darkMode={hasIntel && !isFallback}
                  onSyncUpdate={(sync) => setQingyanSync(sync)}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Fatal blockers — persistent red banners */}
      {fatalBlockers.length > 0 && (
        <div className="space-y-2">

          {fatalBlockers.map((rf: any, i: number) => (
            <div key={i} className="flex items-start gap-3 rounded-lg border-2 border-red-300 bg-red-50 px-4 py-3">
              <Shield className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
              <div>
                <span className="text-xs font-bold text-red-800 uppercase tracking-wide">FATAL BLOCKER</span>
                <p className="text-sm font-medium text-red-800">{rf.requirement}</p>
                {rf.explanation && <p className="text-xs text-red-600 mt-0.5">{rf.explanation}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Analysis Level Indicator ── */}
      <AnalysisLevelBanner
        hasIntel={hasIntel}
        isFallback={isFallback}
        analysisMode={intel?.intelligence?.analysisMode || intel?.intelligence?.analysis_mode}
        analysisModel={intel?.intelligence?.analysisModel || rpt.analysis_model}
        analyzing={analyzing}
        analysisPhase={analysisPhase}
        docCount={(intel?.documents?.length || 0) || opp.documents.length}
        onQuickAnalyze={() => handleAnalyze("quick")}
        onDeepAnalyze={() => handleAnalyze("deep")}
      />

      {analysisError && (
        <div className={`rounded-md px-3 py-2 text-xs flex items-center gap-2 ${
          analysisError.includes("budget") || analysisError.includes("Budget")
            ? "border border-amber-300 bg-amber-50 text-amber-800"
            : "border border-destructive/30 bg-destructive/10 text-destructive"
        }`}>
          {(analysisError.includes("budget") || analysisError.includes("Budget")) && <DollarSign className="h-3.5 w-3.5 shrink-0" />}
          {analysisError}
        </div>
      )}
      {actionError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{actionError}</div>
      )}

      {/* ════════════════════ TABS ════════════════════ */}
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

      {/* ════════════════════ TAB CONTENT ════════════════════ */}
      <div className="grid gap-4 lg:grid-cols-3 mt-4">
        <div className="lg:col-span-2 space-y-4">
          {/* ── SUMMARY TAB ── */}
          {activeTab === "summary" && (
            <>
              {/* Metadata grid */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold">Opportunity Details</CardTitle>
                    <a href={opp.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                      <ExternalLink className="h-3 w-3" /> View Original
                    </a>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                    <MetaRow icon={Building2} label="Organization" value={opp.organization} />
                    <MetaRow icon={MapPin} label="Location" value={[opp.city, opp.region, opp.country].filter(Boolean).join(", ")} />
                    <MetaRow icon={Hash} label="Solicitation #" value={opp.solicitationNumber} />
                    <MetaRow icon={DollarSign} label="Est. Value" value={formatCurrency(opp.estimatedValue, opp.currency)} />
                    <MetaRow icon={Calendar} label="Posted" value={formatDate(opp.postedDate)} />
                    <MetaRow icon={Clock} label="Closing" value={formatDate(opp.closingDate, "MMM d, yyyy h:mm a")} />
                    <MetaRow icon={Tag} label="Category" value={opp.category} />
                    <MetaRow icon={Globe} label="Source" value={opp.sourceName} />
                    {opp.naicsName && <MetaRow icon={Tag} label="NAICS" value={opp.naicsName} />}
                    {opp.setAside && <MetaRow icon={Tag} label="Set-Aside" value={opp.setAside} />}
                    {opp.placeOfPerformance && <MetaRow icon={MapPin} label="Place of Performance" value={opp.placeOfPerformance} />}
                    {opp.mandatorySiteVisit && <MetaRow icon={MapPin} label="Site Visit" value={opp.mandatorySiteVisit} />}
                  </div>
                </CardContent>
              </Card>

              {/* Description */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">Description</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="prose prose-sm max-w-none text-foreground">
                    {(() => {
                      const desc = opp.descriptionFull || opp.descriptionSummary || "";
                      if (!desc || desc.startsWith("http://") || desc.startsWith("https://")) {
                        return <p className="text-xs text-muted-foreground italic">Description not available — see the original listing for details.</p>;
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

          {/* ── ANALYSIS TAB ── */}
          {activeTab === "analysis" && (
            <>
              {hasIntel ? (
                <IntelligencePanel
                  data={intel.intelligence}
                  onReanalyze={() => handleAnalyze("quick")}
                  onDeepAnalyze={() => handleAnalyze("deep")}
                  reanalyzing={analyzing}
                />
              ) : (
                <Card>
                  <CardContent className="p-8 text-center">
                    <Sparkles className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                    <p className="text-sm font-medium">No analysis available</p>
                    <p className="text-xs text-muted-foreground mt-1 mb-4">Run AI analysis to get a full Tender Intelligence Report</p>
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => handleAnalyze("quick")}
                        disabled={analyzing}
                        className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
                      >
                        {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                        Quick Analysis
                      </button>
                      <button
                        onClick={() => handleAnalyze("deep")}
                        disabled={analyzing}
                        className="inline-flex items-center gap-1.5 rounded-md border border-blue-300 bg-blue-50 px-4 py-2 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        Deep Analysis
                      </button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}

          {/* ── DOCUMENTS TAB ── */}
          {activeTab === "documents" && (
            <DocumentsPanel
              intel={intel}
              opp={opp}
            />
          )}

          {/* ── EVIDENCE TAB ── */}
          {activeTab === "evidence" && (
            <EvidencePanel rpt={rpt} isV2={isV2} />
          )}

          {/* ── NOTES TAB ── */}
          {activeTab === "notes" && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Notes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {opp.notes.length === 0 && (
                  <p className="text-sm text-muted-foreground">No notes yet.</p>
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
                    placeholder="Add a note…"
                    rows={3}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                  />
                  <Button size="sm" onClick={handleAddNote} disabled={!newNote.trim() || submittingNote}>
                    {submittingNote ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                    Add Note
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* ════════════════════ SIDEBAR ════════════════════ */}
        <div className="space-y-4">
          {/* Contact */}
          {(opp.contactName || opp.contactEmail || opp.contactPhone || opp.officeAddress) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Contact</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <MetaRow icon={User} label="Name" value={opp.contactName} />
                <MetaRow icon={Mail} label="Email" value={opp.contactEmail} />
                <MetaRow icon={Phone} label="Phone" value={opp.contactPhone} />
                {opp.officeAddress && <MetaRow icon={MapPin} label="Office" value={opp.officeAddress} />}
                {opp.department && <MetaRow icon={Building2} label="Department" value={opp.department} />}
                {opp.office && <MetaRow icon={Building2} label="Office Name" value={opp.office} />}
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

          {/* Why this matched */}
          <MatchingPanel opp={opp} />

          {/* Industry Tags */}
          {opp.industryTags.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Industry Tags</CardTitle>
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

          {/* Re-analyze controls */}
          {hasIntel && !isFallback && (
            <Card>
              <CardContent className="p-4 space-y-2">
                <p className="text-xs font-semibold">Upgrade / Re-analyze</p>
                {(intel?.intelligence?.analysisMode || intel?.intelligence?.analysis_mode) !== "deep" && (
                  <button
                    onClick={() => handleAnalyze("deep")}
                    disabled={analyzing}
                    className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50 w-full justify-center"
                  >
                    {analyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    Upgrade to Deep Analysis
                  </button>
                )}
                <button
                  onClick={() => handleAnalyze((intel?.intelligence?.analysisMode || intel?.intelligence?.analysis_mode) === "deep" ? "deep" : "quick")}
                  disabled={analyzing}
                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50 w-full justify-center"
                >
                  {analyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                  Re-analyze (uses AI tokens)
                </button>
                <p className="text-[10px] text-muted-foreground">
                  Analyzed {formatDate(intel?.intelligence?.analyzedAt || intel?.intelligence?.analyzed_at)} · {intel?.intelligence?.analysisModel || rpt.analysis_model}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      </Tabs>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
 * AnalysisLevelBanner — shows free vs paid analysis state
 * ════════════════════════════════════════════════════════════ */
function AnalysisLevelBanner({
  hasIntel,
  isFallback,
  analysisMode,
  analysisModel,
  analyzing,
  analysisPhase,
  docCount,
  onQuickAnalyze,
  onDeepAnalyze,
}: {
  hasIntel: boolean;
  isFallback: boolean;
  analysisMode?: string;
  analysisModel?: string;
  analyzing: boolean;
  analysisPhase?: string | null;
  docCount?: number;
  onQuickAnalyze: () => void;
  onDeepAnalyze: () => void;
}) {
  if (analyzing) {
    return (
      <div className="rounded-lg border border-blue-300 bg-blue-50 px-4 py-3">
        <div className="flex items-center gap-3">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
          <div>
            <p className="text-xs font-medium text-blue-800">Running AI analysis...</p>
            {analysisPhase && (
              <p className="text-[11px] text-blue-600 mt-0.5">{analysisPhase}</p>
            )}
          </div>
        </div>
        <div className="mt-2 flex items-center gap-4">
          <div className="flex-1 h-1 bg-blue-200 rounded-full overflow-hidden">
            <div className="h-full bg-blue-600 rounded-full animate-pulse" style={{ width: "60%" }} />
          </div>
        </div>
      </div>
    );
  }

  // Level 1: No analysis at all
  if (!hasIntel) {
    return (
      <div className="rounded-lg border-2 border-dashed border-muted-foreground/20 bg-muted/10 px-4 py-4 space-y-3">
        <div className="flex items-center gap-2.5">
          <Shield className="h-4 w-4 text-emerald-600" />
          <div>
            <span className="text-xs font-semibold">Free Rule-Based Screening Active</span>
            <p className="text-2xs text-muted-foreground">
              Relevance scoring, keyword matching, and basic industry fit — at zero cost.
            </p>
          </div>
        </div>
          <div className="flex items-center gap-6 border-t border-dashed pt-3">
          <div className="flex-1 space-y-1">
            <p className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">Upgrade to AI Analysis</p>
            <p className="text-2xs text-muted-foreground">
              AI will extract and read all {docCount || 0} document{(docCount || 0) !== 1 ? "s" : ""}, then generate a professional bid report with feasibility scores, cited evidence, and actionable recommendations.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onQuickAnalyze}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
            >
              <Zap className="h-3.5 w-3.5" />
              Quick Analysis
              <span className="text-[9px] opacity-75 ml-0.5">~$0.01</span>
            </button>
            <button
              onClick={onDeepAnalyze}
              className="inline-flex items-center gap-1.5 rounded-md border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Deep Analysis
              <span className="text-[9px] opacity-60 ml-0.5">~$0.05</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Level 2: Fallback / rule-based only
  if (isFallback) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-amber-800">Rule-Based Estimate Only</span>
              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700 uppercase">Free</span>
            </div>
            <p className="text-[11px] text-amber-600">AI was unavailable. Showing keyword-only scoring. Run paid AI analysis for a full report.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onQuickAnalyze}
            className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 transition-colors"
          >
            <Zap className="h-3 w-3" />
            Quick ~$0.01
          </button>
          <button
            onClick={onDeepAnalyze}
            className="inline-flex items-center gap-1.5 rounded-md border border-amber-400 px-2.5 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 transition-colors"
          >
            <Sparkles className="h-3 w-3" />
            Deep ~$0.05
          </button>
        </div>
      </div>
    );
  }

  // Level 3: Quick analysis done
  const isDeep = analysisMode === "deep";
  const isQuick = !isDeep;

  if (isQuick) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50/50 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-blue-600" />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-blue-800">Quick AI Analysis</span>
              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-medium text-blue-700">{analysisModel || "gpt-4o-mini"}</span>
            </div>
            <p className="text-[11px] text-blue-600">Based on title + description + extracted documents. Upgrade to Deep for deeper document analysis with citations.</p>
          </div>
        </div>
        <button
          onClick={onDeepAnalyze}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors shrink-0"
        >
          <Sparkles className="h-3 w-3" />
          Upgrade to Deep ~$0.05
        </button>
      </div>
    );
  }

  // Level 4: Deep analysis done
  return (
    <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/50 px-4 py-2.5">
      <Sparkles className="h-4 w-4 text-emerald-600" />
      <div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-emerald-800">Deep AI Analysis</span>
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700">{analysisModel || "gpt-4o"}</span>
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700">Document-Aware</span>
        </div>
        <p className="text-[11px] text-emerald-600">Full document-level analysis with citations and detailed specifications.</p>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
 * MetaRow — key/value display
 * ════════════════════════════════════════════════════════════ */
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

/* ════════════════════════════════════════════════════════════
 * MatchingPanel — why this opportunity matched
 * ════════════════════════════════════════════════════════════ */
function MatchingPanel({ opp }: { opp: OpportunityDetail }) {
  const breakdown = opp.relevanceBreakdown ?? {};
  const primaryMatches: string[] = (breakdown.primary_matches as string[]) ?? [];
  const secondaryMatches: string[] = (breakdown.secondary_matches as string[]) ?? [];
  const contextualMatches: string[] = (breakdown.contextual_matches as string[]) ?? [];
  const semanticMatches: string[] = (breakdown.semantic_matches as string[]) ?? [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Why This Matched</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Score</span>
          <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${getRelevanceColor(opp.relevanceScore)}`}>
            {opp.relevanceScore} / 100
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Bucket</span>
          <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${getBucketColor(opp.relevanceBucket)}`}>
            {getBucketLabel(opp.relevanceBucket)}
          </span>
        </div>

        {opp.businessFitExplanation && (
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs font-medium text-muted-foreground mb-1">Business Fit</p>
            <p className="text-sm leading-relaxed">{opp.businessFitExplanation}</p>
          </div>
        )}

        {breakdown.positive_score != null && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Positive signal</span>
            <span className="font-medium text-emerald-600">+{String(breakdown.positive_score)}</span>
          </div>
        )}
        {breakdown.negative_penalty != null && Number(breakdown.negative_penalty) > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Negative penalty</span>
            <span className="font-medium text-red-600">−{String(breakdown.negative_penalty)}</span>
          </div>
        )}

        {primaryMatches.length > 0 && (
          <KeywordGroup label="Primary matches" keywords={primaryMatches} color="bg-emerald-50 text-emerald-700" />
        )}
        {secondaryMatches.length > 0 && (
          <KeywordGroup label="Secondary matches" keywords={secondaryMatches} color="bg-blue-50 text-blue-700" />
        )}
        {contextualMatches.length > 0 && (
          <KeywordGroup label="Contextual matches" keywords={contextualMatches} color="bg-amber-50 text-amber-700" />
        )}
        {semanticMatches.length > 0 && (
          <KeywordGroup label="Semantic matches" keywords={semanticMatches} color="bg-violet-50 text-violet-700" />
        )}
        {opp.negativeKeywords.length > 0 && (
          <KeywordGroup label="Negative matches" keywords={opp.negativeKeywords} color="bg-red-50 text-red-700" />
        )}
      </CardContent>
    </Card>
  );
}

function KeywordGroup({ label, keywords, color }: { label: string; keywords: string[]; color: string }) {
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

/* ════════════════════════════════════════════════════════════
 * EvidencePanel — interactive checklist from report
 * ════════════════════════════════════════════════════════════ */

function EvidencePanel({ rpt, isV2 }: { rpt: any; isV2: boolean }) {
  const evidence = rpt.required_evidence || {};
  const beforeBidding: string[] = evidence.before_bidding || [];
  const withSubmission: string[] = evidence.with_submission || [];
  const [checked, setChecked] = useState<Set<string>>(new Set());

  function toggle(item: string) {
    setChecked(prev => {
      const next = new Set(prev);
      next.has(item) ? next.delete(item) : next.add(item);
      return next;
    });
  }

  if (!isV2 || (beforeBidding.length === 0 && withSubmission.length === 0)) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <ListChecks className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium">No evidence checklist available</p>
          <p className="text-xs text-muted-foreground mt-1">Run AI analysis to generate required evidence items</p>
        </CardContent>
      </Card>
    );
  }

  const totalItems = beforeBidding.length + withSubmission.length;
  const checkedCount = checked.size;
  const progress = totalItems > 0 ? Math.round((checkedCount / totalItems) * 100) : 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">Evidence Checklist</CardTitle>
          <span className="text-xs text-muted-foreground">{checkedCount}/{totalItems} completed · {progress}%</span>
        </div>
        <div className="w-full bg-muted rounded-full h-1.5 mt-2">
          <div
            className="h-1.5 rounded-full bg-emerald-500 transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {beforeBidding.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Before Bidding</p>
            <div className="space-y-1.5">
              {beforeBidding.map((item, i) => {
                const key = `before_${i}`;
                const isChecked = checked.has(key);
                return (
                  <button
                    key={key}
                    onClick={() => toggle(key)}
                    className={`flex items-start gap-2.5 w-full text-left rounded-md border px-3 py-2 transition-colors ${
                      isChecked ? "bg-emerald-50 border-emerald-200" : "hover:bg-muted/40"
                    }`}
                  >
                    <div className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      isChecked ? "bg-emerald-600 border-emerald-600" : "border-input"
                    }`}>
                      {isChecked && <CheckCircle2 className="h-3 w-3 text-white" />}
                    </div>
                    <span className={`text-xs ${isChecked ? "text-emerald-800 line-through" : ""}`}>{item}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {withSubmission.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">With Submission</p>
            <div className="space-y-1.5">
              {withSubmission.map((item, i) => {
                const key = `with_${i}`;
                const isChecked = checked.has(key);
                return (
                  <button
                    key={key}
                    onClick={() => toggle(key)}
                    className={`flex items-start gap-2.5 w-full text-left rounded-md border px-3 py-2 transition-colors ${
                      isChecked ? "bg-emerald-50 border-emerald-200" : "hover:bg-muted/40"
                    }`}
                  >
                    <div className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      isChecked ? "bg-emerald-600 border-emerald-600" : "border-input"
                    }`}>
                      {isChecked && <CheckCircle2 className="h-3 w-3 text-white" />}
                    </div>
                    <span className={`text-xs ${isChecked ? "text-emerald-800 line-through" : ""}`}>{item}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ════════════════════════════════════════════════════════════
 * DocumentsPanel — Documents tab with extraction status, preview
 * ════════════════════════════════════════════════════════════ */

function DocumentsPanel({ intel, opp }: { intel: any; opp: OpportunityDetail }) {
  const [previewDoc, setPreviewDoc] = useState<any>(null);
  const docs = intel?.documents?.length ? intel.documents : opp.documents;
  const analysisMetadata = intel?.analysisMetadata?._analysis_metadata || intel?.analysisMetadata || null;
  const docsUsedIds = new Set(
    (analysisMetadata?.documents_used || []).map((d: any) => d.id)
  );

  const extractedCount = docs?.filter((d: any) => d.textExtracted || d.text_extracted).length || 0;
  const totalCount = docs?.length || 0;

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">
              Documents ({totalCount})
            </CardTitle>
            {totalCount > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">
                  {extractedCount}/{totalCount} extracted
                </span>
                <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${totalCount > 0 ? (extractedCount / totalCount) * 100 : 0}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {(!docs || docs.length === 0) ? (
            <div className="text-center py-6">
              <FileText className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No documents attached to this opportunity.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {docs.map((doc: any) => {
                const ft = (doc.fileType || "").toLowerCase();
                const typeColor = ft === "pdf" ? "text-red-500" : ft === "doc" || ft === "docx" ? "text-blue-500" : ft === "xls" || ft === "xlsx" ? "text-green-600" : ft === "link" ? "text-violet-500" : "text-muted-foreground";
                const extracted = doc.textExtracted || doc.text_extracted;
                const hasPreview = doc.extractedTextPreview || doc.extracted_text_preview;
                const usedInAnalysis = docsUsedIds.has(doc.id);
                const textLen = doc.extractedTextLength || doc.extracted_text_length || 0;
                const isLink = ft === "link" || ft === "html" || ft === "htm" || ft === "";

                return (
                  <div key={doc.id} className="rounded-md border hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-2.5 px-3 py-2">
                      {isLink ? (
                        <Globe className={`h-4 w-4 shrink-0 ${typeColor}`} />
                      ) : (
                        <FileText className={`h-4 w-4 shrink-0 ${typeColor}`} />
                      )}
                      <div className="flex-1 min-w-0">
                        <a href={doc.url} target="_blank" rel="noopener noreferrer"
                          className="text-xs font-medium truncate block hover:text-primary transition-colors"
                        >
                          {doc.title || "Untitled"}
                        </a>
                        <p className="text-[10px] text-muted-foreground">
                          {isLink ? "WEB LINK" : doc.fileType?.toUpperCase() || "FILE"}
                          {doc.fileSizeBytes ? ` · ${formatBytes(doc.fileSizeBytes)}` : ""}
                          {doc.pageCount ? ` · ${doc.pageCount}p` : ""}
                          {textLen > 0 ? ` · ${(textLen / 1000).toFixed(0)}K chars` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {usedInAnalysis && (
                          <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold text-blue-700">ANALYZED</span>
                        )}
                        {extracted ? (
                          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">Extracted</span>
                        ) : (
                          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">Pending</span>
                        )}
                        {hasPreview && (
                          <button
                            onClick={() => setPreviewDoc(previewDoc?.id === doc.id ? null : doc)}
                            className="rounded border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                          >
                            {previewDoc?.id === doc.id ? "Hide" : "Preview"}
                          </button>
                        )}
                        <a href={doc.url} target="_blank" rel="noopener noreferrer">
                          <Download className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                        </a>
                      </div>
                    </div>
                    {previewDoc?.id === doc.id && hasPreview && (
                      <div className="border-t bg-slate-50 px-3 py-2.5">
                        <p className="text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">Extracted Text Preview</p>
                        <pre className="text-[11px] leading-relaxed text-foreground whitespace-pre-wrap font-mono max-h-60 overflow-y-auto">
                          {doc.extractedTextPreview || doc.extracted_text_preview}
                        </pre>
                        {textLen > 800 && (
                          <p className="text-[10px] text-muted-foreground mt-1.5 italic">
                            Showing first 800 of {(textLen / 1000).toFixed(0)}K characters
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

/* ════════════════════════════════════════════════════════════
 * IntelligencePanel — Full report inside Analysis tab
 * ════════════════════════════════════════════════════════════ */

function IntelligencePanel({ data, onReanalyze, onDeepAnalyze, reanalyzing }: { data: any; onReanalyze?: () => void; onDeepAnalyze?: () => void; reanalyzing?: boolean }) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(["summary", "scope", "tech", "timeline", "fit", "compliance", "supply", "strategy", "evidence", "quotes"])
  );

  if (!data) return null;


  const rpt: any = data.intelligenceSummary || data.intelligence_summary || {};
  const isV2 = rpt.report_version === "2.0";

  const verdict = rpt.verdict || {};
  const projSummary = rpt.project_summary || {};
  const scope = rpt.scope_breakdown || {};
  const techReqs = rpt.technical_requirements || {};
  const timeline = rpt.timeline_milestones || {};
  const evalStrategy = rpt.evaluation_strategy || {};
  const bizFit = rpt.business_fit || {};
  const compliance = rpt.compliance_risks || {};
  const compat = rpt.compatibility_analysis || {};
  const supplyChain = rpt.supply_chain_feasibility || {};
  const participation = rpt.participation_strategy || {};
  const evidence = rpt.required_evidence || {};
  const scores = rpt.feasibility_scores || {};
  const docsAnalyzed = rpt.documents_analyzed || {};
  const evidenceQuotes: any[] = rpt.evidence_quotes || [];
  const analysisMeta = rpt._analysis_metadata || {};

  const overview: string | undefined = isV2
    ? projSummary.overview
    : (data.projectOverview || data.project_overview || rpt.project_overview);
  const analyzedAt: string | undefined = data.analyzedAt || data.analyzed_at || rpt.analyzed_at;
  const model: string | undefined = data.analysisModel || data.analysis_model || rpt.analysis_model;
  const isFallback: boolean = model === "fallback_rule_based" || rpt.fallback_used === true;

  const severityColors: Record<string, string> = {
    fatal_blocker: "bg-red-100 text-red-800 border-red-300",
    serious_risk: "bg-orange-100 text-orange-800 border-orange-300",
    normal_requirement: "bg-slate-100 text-slate-700 border-slate-300",
  };

  function toggleSection(key: string) {
    setExpandedSections(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  const SectionHeader = ({ id, title }: { id: string; title: string }) => (
    <button
      onClick={() => toggleSection(id)}
      className="flex items-center justify-between w-full py-2.5 text-left group"
    >
      <span className="text-xs font-semibold uppercase tracking-wider text-slate-600 group-hover:text-foreground transition-colors">{title}</span>
      <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${expandedSections.has(id) ? "rotate-180" : ""}`} />
    </button>
  );

  return (
    <Card className="overflow-hidden">
      {/* Header with re-analyze controls */}
      <div className="px-5 py-3 bg-slate-50 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-blue-600" />
          <span className="text-xs font-semibold">Tender Intelligence Report</span>
          {isV2 && <span className="text-[10px] text-muted-foreground">v2.0</span>}
          {isFallback && <span className="text-[10px] text-amber-600 font-medium">(Fallback)</span>}
        </div>
        <div className="flex items-center gap-1.5">
          {onReanalyze && (
            <button
              onClick={onReanalyze}
              disabled={reanalyzing}
              className="inline-flex items-center gap-1 rounded border px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
            >
              {reanalyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
              Quick
            </button>
          )}
          {onDeepAnalyze && (
            <button
              onClick={onDeepAnalyze}
              disabled={reanalyzing}
              className="inline-flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {reanalyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              Deep
            </button>
          )}
        </div>
      </div>

      <div className="divide-y">
        {/* Documents Analyzed Banner */}
        {(analysisMeta.documents_used_count > 0 || docsAnalyzed.count > 0) && (
          <div className="px-5 py-3 bg-blue-50/50 border-b">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center h-8 w-8 rounded-full bg-blue-100">
                <FileText className="h-4 w-4 text-blue-600" />
              </div>
              <div className="flex-1">
                <p className="text-xs font-semibold text-blue-900">
                  {analysisMeta.documents_used_count || docsAnalyzed.count || 0} of {analysisMeta.total_documents || "?"} documents analyzed
                </p>
                <p className="text-[10px] text-blue-600">
                  {docsAnalyzed.coverage_note || (analysisMeta.total_doc_chars
                    ? `${(analysisMeta.total_doc_chars / 1000).toFixed(0)}K characters of document text processed`
                    : "Document content included in analysis")}
                </p>
              </div>
              {(docsAnalyzed.names?.length > 0 || analysisMeta.documents_used?.length > 0) && (
                <div className="flex flex-wrap gap-1 max-w-[50%]">
                  {(docsAnalyzed.names || analysisMeta.documents_used?.map((d: any) => d.title) || []).slice(0, 4).map((name: string, i: number) => (
                    <span key={i} className="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-medium text-blue-700 truncate max-w-[120px]">
                      {name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 1. Project Summary */}
        <div className="px-5">
          <SectionHeader id="summary" title="Project Summary" />
          {expandedSections.has("summary") && (
            <div className="pb-4 space-y-3">
              {overview && <p className="text-sm leading-relaxed">{overview}</p>}
              {isV2 && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {projSummary.issuing_body && <span>Issuing: <strong className="text-foreground">{projSummary.issuing_body}</strong></span>}
                  {projSummary.project_type && projSummary.project_type !== "other" && (
                    <span>Type: <strong className="text-foreground">{projSummary.project_type.replace(/_/g, " ")}</strong></span>
                  )}
                  {scope.scope_type && scope.scope_type !== "unclear" && (
                    <span>Scope: <strong className="text-foreground">{scope.scope_type.replace(/_/g, " ")}</strong></span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 2. Scope Breakdown */}
        {isV2 && (scope.main_deliverables?.length > 0 || scope.quantities || scope.intended_use) && (
          <div className="px-5">
            <SectionHeader id="scope" title="Scope Breakdown" />
            {expandedSections.has("scope") && (
              <div className="pb-4 space-y-2 text-sm">
                {scope.main_deliverables?.length > 0 && (
                  <div>
                    <span className="text-xs text-muted-foreground font-medium">Deliverables:</span>
                    <ul className="mt-1 space-y-0.5">
                      {scope.main_deliverables.map((d: string, i: number) => (
                        <li key={i} className="flex items-start gap-2"><span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-blue-400 shrink-0" />{d}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {scope.quantities && scope.quantities !== "Not specified" && <p><span className="text-muted-foreground">Quantities:</span> {scope.quantities}</p>}
                {scope.intended_use && scope.intended_use !== "Not specified" && <p><span className="text-muted-foreground">Intended use:</span> {scope.intended_use}</p>}
                {scope.service_scope && scope.service_scope !== "Not specified" && <p><span className="text-muted-foreground">Service scope:</span> {scope.service_scope}</p>}
              </div>
            )}
          </div>
        )}

        {/* 3. Technical Requirements */}
        {isV2 && (techReqs.product_requirements?.length > 0 || techReqs.standards_certifications?.length > 0 || techReqs.environmental_requirements?.length > 0) && (
          <div className="px-5">
            <SectionHeader id="tech" title="Technical Requirements" />
            {expandedSections.has("tech") && (
              <div className="pb-4 space-y-3 text-sm">
                {techReqs.product_requirements?.length > 0 && (
                  <div>
                    <span className="text-xs text-muted-foreground font-medium">Product specs:</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {techReqs.product_requirements.map((r: string, i: number) => (
                        <Badge key={i} variant="outline" className="text-xs">{r}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {techReqs.standards_certifications?.length > 0 && (
                  <div>
                    <span className="text-xs text-muted-foreground font-medium">Standards / certifications:</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {techReqs.standards_certifications.map((s: string, i: number) => (
                        <Badge key={i} variant="outline" className="text-xs bg-violet-50 text-violet-700 border-violet-200">{s}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {techReqs.environmental_requirements?.length > 0 && (
                  <div>
                    <span className="text-xs text-muted-foreground font-medium">Environmental:</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {techReqs.environmental_requirements.map((e: string, i: number) => (
                        <Badge key={i} variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">{e}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {techReqs.control_systems && techReqs.control_systems !== "Not specified" && (
                  <p><span className="text-muted-foreground">Controls:</span> {techReqs.control_systems}</p>
                )}
                {techReqs.installation_requirements?.length > 0 && (
                  <div>
                    <span className="text-xs text-muted-foreground font-medium">Installation:</span>
                    <ul className="mt-1 space-y-0.5">{techReqs.installation_requirements.map((r: string, i: number) => (
                      <li key={i} className="flex items-start gap-2"><span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-slate-400 shrink-0" />{r}</li>
                    ))}</ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 4. Timeline */}
        {isV2 && (timeline.bid_closing || timeline.project_start || timeline.delivery_deadline || timeline.schedule_notes) && (
          <div className="px-5">
            <SectionHeader id="timeline" title="Timeline & Milestones" />
            {expandedSections.has("timeline") && (
              <div className="pb-4 space-y-2 text-sm">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  {timeline.bid_closing && <p><span className="text-muted-foreground">Closing:</span> {timeline.bid_closing}</p>}
                  {timeline.response_due && <p><span className="text-muted-foreground">Response due:</span> {timeline.response_due}</p>}
                  {timeline.site_visit && <p><span className="text-muted-foreground">Site visit:</span> {timeline.site_visit}</p>}
                  {timeline.pre_bid_meeting && <p><span className="text-muted-foreground">Pre-bid:</span> {timeline.pre_bid_meeting}</p>}
                  {timeline.project_start && <p><span className="text-muted-foreground">Start:</span> {timeline.project_start}</p>}
                  {timeline.delivery_deadline && <p><span className="text-muted-foreground">Delivery:</span> {timeline.delivery_deadline}</p>}
                </div>
                {timeline.schedule_pressure && timeline.schedule_pressure !== "realistic" && (
                  <div className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium ${
                    timeline.schedule_pressure === "very_tight" ? "bg-red-100 text-red-700" :
                    timeline.schedule_pressure === "tight" ? "bg-orange-100 text-orange-700" :
                    "bg-amber-100 text-amber-700"
                  }`}>
                    <Clock className="h-3 w-3" />
                    {timeline.schedule_pressure.replace(/_/g, " ")} schedule
                  </div>
                )}
                {timeline.schedule_notes && <p className="text-xs text-muted-foreground">{timeline.schedule_notes}</p>}
              </div>
            )}
          </div>
        )}

        {/* 5. Evaluation Strategy */}
        {isV2 && (evalStrategy.pricing_weight || evalStrategy.likely_evaluator_focus) && evalStrategy.pricing_weight !== "Not specified" && (
          <div className="px-5">
            <SectionHeader id="eval" title="Evaluation Strategy" />
            {expandedSections.has("eval") && (
              <div className="pb-4 space-y-2 text-sm">
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {evalStrategy.pricing_weight && evalStrategy.pricing_weight !== "Not specified" && <p><span className="text-muted-foreground">Price:</span> {evalStrategy.pricing_weight}</p>}
                  {evalStrategy.technical_weight && evalStrategy.technical_weight !== "Not specified" && <p><span className="text-muted-foreground">Technical:</span> {evalStrategy.technical_weight}</p>}
                  {evalStrategy.experience_weight && evalStrategy.experience_weight !== "Not specified" && <p><span className="text-muted-foreground">Experience:</span> {evalStrategy.experience_weight}</p>}
                </div>
                {evalStrategy.likely_evaluator_focus && evalStrategy.likely_evaluator_focus !== "Not specified" && (
                  <p className="text-xs text-blue-700 bg-blue-50 rounded p-2">{evalStrategy.likely_evaluator_focus}</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* 6. Business Fit */}
        <div className="px-5">
          <SectionHeader id="fit" title="Fit for Our Business" />
          {expandedSections.has("fit") && (
            <div className="pb-4 space-y-2">
              {isV2 && bizFit.fit_assessment && (
                <div className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium ${
                  bizFit.fit_assessment === "strong_fit" ? "bg-emerald-100 text-emerald-700" :
                  bizFit.fit_assessment === "moderate_fit" ? "bg-blue-100 text-blue-700" :
                  bizFit.fit_assessment === "weak_fit" ? "bg-amber-100 text-amber-700" :
                  "bg-red-100 text-red-700"
                }`}>
                  {bizFit.fit_assessment.replace(/_/g, " ")}
                </div>
              )}
              {bizFit.fit_explanation && (
                <p className="text-sm">{bizFit.fit_explanation}</p>
              )}
              {isV2 && bizFit.recommended_role && bizFit.recommended_role !== "not_recommended" && (
                <p className="text-xs text-muted-foreground">Recommended role: <strong className="text-foreground">{bizFit.recommended_role.replace(/_/g, " ")}</strong></p>
              )}
              {isV2 && bizFit.capability_gaps?.length > 0 && (
                <div>
                  <span className="text-xs text-muted-foreground font-medium">Capability gaps:</span>
                  <ul className="mt-1 space-y-0.5 text-sm">
                    {bizFit.capability_gaps.map((g: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-amber-700"><AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />{g}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 7. Compliance Red Flags */}
        {isV2 && (compliance.red_flags?.length > 0 || compliance.mandatory_certifications?.length > 0 || (compliance.bonding_insurance && compliance.bonding_insurance !== "Not specified")) && (
          <div className="px-5">
            <SectionHeader id="compliance" title="Compliance Red Flags" />
            {expandedSections.has("compliance") && (
              <div className="pb-4 space-y-3">
                {compliance.red_flags?.length > 0 && (
                  <div className="space-y-2">
          
                    {compliance.red_flags.map((rf: any, i: number) => (
                      <div key={i} className={`rounded-md border px-3 py-2 ${severityColors[rf.severity] || "bg-slate-50 border-slate-200"}`}>
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-[10px] font-bold uppercase tracking-wide">{(rf.severity || "").replace(/_/g, " ")}</span>
                        </div>
                        <p className="text-sm font-medium">{rf.requirement}</p>
                        {rf.explanation && <p className="text-xs mt-0.5 opacity-80">{rf.explanation}</p>}
                      </div>
                    ))}
                  </div>
                )}
                {compliance.mandatory_certifications?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {compliance.mandatory_certifications.map((c: string, i: number) => (
                      <Badge key={i} variant="outline" className="text-xs bg-red-50 text-red-700 border-red-200">{c}</Badge>
                    ))}
                  </div>
                )}
                <div className="text-sm space-y-1">
                  {compliance.experience_thresholds && compliance.experience_thresholds !== "Not specified" && <p><span className="text-muted-foreground">Experience:</span> {compliance.experience_thresholds}</p>}
                  {compliance.bonding_insurance && compliance.bonding_insurance !== "Not specified" && <p><span className="text-muted-foreground">Bonding/Insurance:</span> {compliance.bonding_insurance}</p>}
                  {compliance.local_requirements && compliance.local_requirements !== "Not specified" && <p><span className="text-muted-foreground">Local reqs:</span> {compliance.local_requirements}</p>}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 8. Compatibility Analysis */}
        {isV2 && compat.compatibility_risk && compat.compatibility_risk !== "none" && (
          <div className="px-5">
            <SectionHeader id="compat" title="Compatibility Analysis" />
            {expandedSections.has("compat") && (
              <div className="pb-4 space-y-2 text-sm">
                <div className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium ${
                  compat.compatibility_risk === "high" ? "bg-red-100 text-red-700" :
                  compat.compatibility_risk === "medium" ? "bg-amber-100 text-amber-700" :
                  "bg-blue-100 text-blue-700"
                }`}>
                  {compat.compatibility_risk} risk
                </div>
                {compat.existing_system && compat.existing_system !== "Not specified" && <p><span className="text-muted-foreground">Existing system:</span> {compat.existing_system}</p>}
                {compat.brand_compatibility && compat.brand_compatibility !== "Not specified" && <p><span className="text-muted-foreground">Brand compat:</span> {compat.brand_compatibility}</p>}
                {compat.compatibility_notes && <p className="text-xs text-muted-foreground">{compat.compatibility_notes}</p>}
              </div>
            )}
          </div>
        )}

        {/* 9. Supply Chain */}
        <div className="px-5">
          <SectionHeader id="supply" title="Supply Chain & China Sourcing" />
          {expandedSections.has("supply") && (
            <div className="pb-4 space-y-2 text-sm">
              {isV2 ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className={`inline-block h-2.5 w-2.5 rounded-full ${supplyChain.china_sourcing_viable ? "bg-green-500" : "bg-red-500"}`} />
                    <span className="font-medium">{supplyChain.china_sourcing_viable ? "China Sourcing Viable" : "China Sourcing Not Viable"}</span>
                  </div>
                  {supplyChain.sourcing_explanation && <p>{supplyChain.sourcing_explanation}</p>}
                  {supplyChain.buy_domestic_restrictions?.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {supplyChain.buy_domestic_restrictions.map((r: string, i: number) => (
                        <Badge key={i} variant="outline" className="text-xs bg-red-50 text-red-700 border-red-200">{r}</Badge>
                      ))}
                    </div>
                  )}
                  {supplyChain.shipping_lead_time && supplyChain.shipping_lead_time !== "Not assessed" && <p><span className="text-muted-foreground">Lead time:</span> {supplyChain.shipping_lead_time}</p>}
                  {supplyChain.local_installation && supplyChain.local_installation !== "Not specified" && <p><span className="text-muted-foreground">Local install:</span> {supplyChain.local_installation}</p>}
                </>
              ) : (
                <p className="text-muted-foreground">Not assessed.</p>
              )}
            </div>
          )}
        </div>

        {/* 10. Participation Strategy */}
        {isV2 && participation.recommended_approach && (
          <div className="px-5">
            <SectionHeader id="strategy" title="Participation Strategy" />
            {expandedSections.has("strategy") && (
              <div className="pb-4 space-y-2 text-sm">
                <div className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium ${
                  participation.recommended_approach.includes("prime") ? "bg-emerald-100 text-emerald-700" :
                  participation.recommended_approach === "skip" ? "bg-red-100 text-red-700" :
                  "bg-blue-100 text-blue-700"
                }`}>
                  {participation.recommended_approach.replace(/_/g, " ")}
                </div>
                {participation.strategy_rationale && <p>{participation.strategy_rationale}</p>}
                {participation.potential_partners && participation.potential_partners !== "Not assessed" && <p><span className="text-muted-foreground">Partners:</span> {participation.potential_partners}</p>}
                {participation.competitive_positioning && participation.competitive_positioning !== "Not assessed" && <p><span className="text-muted-foreground">Positioning:</span> {participation.competitive_positioning}</p>}
              </div>
            )}
          </div>
        )}

        {/* 11. Required Evidence */}
        {isV2 && (evidence.before_bidding?.length > 0 || evidence.with_submission?.length > 0) && (
          <div className="px-5">
            <SectionHeader id="evidence" title="Required Evidence & Next Actions" />
            {expandedSections.has("evidence") && (
              <div className="pb-4 space-y-3 text-sm">
                {evidence.before_bidding?.length > 0 && (
                  <div>
                    <span className="text-xs text-muted-foreground font-medium">Before bidding:</span>
                    <ul className="mt-1 space-y-1">
                      {evidence.before_bidding.map((e: string, i: number) => (
                        <li key={i} className="flex items-start gap-2"><CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-blue-500" />{e}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {evidence.with_submission?.length > 0 && (
                  <div>
                    <span className="text-xs text-muted-foreground font-medium">With submission:</span>
                    <ul className="mt-1 space-y-1">
                      {evidence.with_submission.map((e: string, i: number) => (
                        <li key={i} className="flex items-start gap-2"><FileText className="h-3.5 w-3.5 mt-0.5 shrink-0 text-slate-500" />{e}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Evidence Quotes from Documents */}
        {evidenceQuotes.length > 0 && (
          <div className="px-5">
            <SectionHeader id="quotes" title="Evidence Quotes from Documents" />
            {expandedSections.has("quotes") && (
              <div className="pb-4 space-y-2">
                {evidenceQuotes.map((eq: any, i: number) => (
                  <div key={i} className="rounded-md border border-amber-200 bg-amber-50/50 px-3 py-2.5">
                    <div className="flex items-center gap-2 mb-1">
                      <FileText className="h-3 w-3 text-amber-600 shrink-0" />
                      <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wide">
                        {eq.document || "Document"}
                      </span>
                      {eq.section && (
                        <span className="text-[10px] text-amber-600">· {eq.section}</span>
                      )}
                    </div>
                    <blockquote className="text-xs italic text-foreground border-l-2 border-amber-400 pl-2.5 my-1.5 leading-relaxed">
                      &ldquo;{eq.quote}&rdquo;
                    </blockquote>
                    {eq.relevance && (
                      <p className="text-[10px] text-muted-foreground mt-1">{eq.relevance}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-3 flex items-center justify-between text-[10px] text-muted-foreground bg-slate-50">
          <span>
            {analyzedAt && `Analyzed ${new Date(analyzedAt).toLocaleDateString()}`}
            {model && ` · ${isFallback ? "Rule-based fallback" : model}`}
            {isV2 && " · v2.0"}
          </span>
          <span className="flex items-center gap-1 font-medium">
            {isFallback ? (
              <><AlertTriangle className="h-3 w-3 text-amber-500" /> Keyword Estimate</>
            ) : (
              <><Sparkles className="h-3 w-3" /> BidToGo AI</>
            )}
          </span>
        </div>
      </div>
    </Card>
  );
}
