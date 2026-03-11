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
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  formatDate,
  formatCurrency,
  getRelevanceColor,
  getBucketLabel,
  getBucketColor,
  getWorkflowLabel,
  getWorkflowColor,
} from "@/lib/utils";
import type { OpportunityDetail, WorkflowStatus } from "@/types";

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
  // eslint-disable-next-line
  const [intel, setIntel] = useState<any>(null);
  const [intelLoading, setIntelLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [intelError, setIntelError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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

  async function handleAnalyze() {
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      const res = await fetch("/api/intelligence/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunityId: id, mode: "quick" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Analysis failed" }));
        throw new Error(err.detail || err.error || "Analysis failed");
      }
      const result = await res.json().catch(() => ({}));
      if (result.status === "failed") {
        throw new Error(result.message || "Analysis failed — model or API error");
      }
      await new Promise((r) => setTimeout(r, 1200));
      fetchIntelligence();
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
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
    <Link href="/dashboard/opportunities" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
      <ArrowLeft className="h-3.5 w-3.5" /> Opportunities
    </Link>
  );

  if (loading) {
    return (
      <div className="space-y-4">
        {backLink}
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
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

  const breakdown = opp.relevanceBreakdown ?? {};
  const primaryMatches: string[] = (breakdown.primary_matches as string[]) ?? [];
  const secondaryMatches: string[] = (breakdown.secondary_matches as string[]) ?? [];
  const contextualMatches: string[] = (breakdown.contextual_matches as string[]) ?? [];
  const semanticMatches: string[] = (breakdown.semantic_matches as string[]) ?? [];

  return (
    <div className="space-y-4">
      {backLink}

      {/* Header — compact + bold */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-lg font-bold tracking-tight leading-snug">{opp.title}</h1>
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            <Badge variant={statusVariant[opp.status] ?? "outline"} className="text-2xs">
              {opp.status.toUpperCase()}
            </Badge>
            <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-2xs font-bold ${getRelevanceColor(opp.relevanceScore)}`}>
              {opp.relevanceScore}
            </span>
            <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-2xs font-medium ${getBucketColor(opp.relevanceBucket)}`}>
              {getBucketLabel(opp.relevanceBucket)}
            </span>
            <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-2xs font-medium ${getWorkflowColor(opp.workflowStatus)}`}>
              {getWorkflowLabel(opp.workflowStatus)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground mt-1.5">
            {opp.organization && (
              <span className="flex items-center gap-1"><Building2 className="h-3 w-3" /> {opp.organization}</span>
            )}
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" /> {[opp.city, opp.region, opp.country].filter(Boolean).join(", ")}
            </span>
            <span className="flex items-center gap-1"><Globe className="h-3 w-3" /> {opp.sourceName}</span>
          </div>
        </div>
        <a href={opp.sourceUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
          <ExternalLink className="h-3 w-3" /> Original
        </a>
      </div>

      {/* Workflow actions — inline compact */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-2xs font-medium text-muted-foreground mr-1">Stage:</span>
        {WORKFLOW_ACTIONS.map((action) => {
          const isActive = opp.workflowStatus === action.value;
          return (
            <button
              key={action.value}
              onClick={() => handleWorkflowChange(action.value)}
              disabled={updatingWorkflow || isActive}
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-2xs font-medium transition-colors disabled:opacity-50 ${
                isActive ? getWorkflowColor(action.value) + " ring-1 ring-offset-1 ring-primary/20" : "bg-background hover:bg-muted border-input text-muted-foreground"
              }`}
            >
              <action.icon className="h-3 w-3" />
              {action.shortLabel}
              {isActive && <CheckCircle2 className="h-2.5 w-2.5" />}
            </button>
          );
        })}
      </div>

      {actionError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {actionError}
        </div>
      )}

      {/* AI Analysis CTA — only shown when no analysis exists */}
      {!intelLoading && !intelError && !intel?.intelligence && (
        <div className="flex items-center justify-between rounded-lg border-2 border-dashed border-muted-foreground/20 bg-muted/10 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <div>
              <span className="text-xs font-semibold">No AI Analysis Yet</span>
              <p className="text-2xs text-muted-foreground">Get feasibility scoring, scope extraction, and business recommendations.</p>
            </div>
          </div>
          <button
            onClick={handleAnalyze}
            disabled={analyzing}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50 shrink-0"
          >
            {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {analyzing ? "Analyzing..." : "Analyze"}
          </button>
        </div>
      )}
      {analysisError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{analysisError}</div>
      )}

      {intelError && !intelLoading && (
        <Card className="border-dashed border-amber-300 bg-amber-50/30">
          <CardContent className="p-4 flex items-center justify-between">
            <p className="text-sm text-amber-800">Could not load AI intelligence data.</p>
            <Button variant="outline" size="sm" onClick={fetchIntelligence}>
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Main content */}
        <div className="space-y-4 lg:col-span-2">
          {/* Intelligence Panel — shown first when available */}
          {intel?.intelligence && (
            <div id="ai-intelligence">
              <IntelligencePanel data={intel.intelligence} onReanalyze={handleAnalyze} reanalyzing={analyzing} />
            </div>
          )}

          {/* Description */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Description</CardTitle>
            </CardHeader>
            <CardContent>
              {opp.descriptionSummary && opp.descriptionFull && (
                <div className="mb-4 flex flex-wrap gap-2 text-xs">
                  {opp.descriptionSummary.split(". ").filter(Boolean).map((part, i) => (
                    <span key={i} className="inline-block rounded-md bg-muted px-2 py-1 text-muted-foreground">
                      {part.replace(/\.$/, "")}
                    </span>
                  ))}
                </div>
              )}
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

          {/* Documents */}
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold">
                Documents ({(intel?.documents?.length || 0) || opp.documents.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(() => {
                const docs = intel?.documents?.length ? intel.documents : opp.documents;
                if (!docs || docs.length === 0) {
                  return <p className="text-sm text-muted-foreground">No documents attached.</p>;
                }
                return (
                  <div className="space-y-1.5">
                    {docs.map((doc: { id: string; title?: string; url: string; fileType?: string; fileSizeBytes?: number; pageCount?: number; downloadedAt?: string; docCategory?: string }) => {
                      const ft = (doc.fileType || "").toLowerCase();
                      const typeColor = ft === "pdf" ? "text-red-500" : ft === "doc" || ft === "docx" ? "text-blue-500" : ft === "xls" || ft === "xlsx" ? "text-green-600" : "text-muted-foreground";
                      return (
                        <a
                          key={doc.id}
                          href={doc.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2.5 rounded-md border px-3 py-2 hover:bg-muted/40 transition-colors group"
                        >
                          <FileText className={`h-4 w-4 shrink-0 ${typeColor}`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate group-hover:text-primary transition-colors">{doc.title || "Untitled"}</p>
                            <p className="text-2xs text-muted-foreground">
                              {doc.fileType?.toUpperCase() || "FILE"}
                              {doc.fileSizeBytes ? ` · ${formatBytes(doc.fileSizeBytes)}` : ""}
                              {doc.pageCount ? ` · ${doc.pageCount}p` : ""}
                            </p>
                          </div>
                          <Download className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground shrink-0" />
                        </a>
                      );
                    })}
                  </div>
                );
              })()}
            </CardContent>
          </Card>

          {/* Notes */}
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
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {note.content}
                  </p>
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
                <Button
                  size="sm"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || submittingNote}
                >
                  {submittingNote ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  Add Note
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar metadata */}
        <div className="space-y-4">
          {/* Key details */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              <MetaRow icon={Hash} label="Solicitation #" value={opp.solicitationNumber} />
              <MetaRow icon={Hash} label="External ID" value={opp.externalId} />
              <MetaRow icon={DollarSign} label="Est. Value" value={formatCurrency(opp.estimatedValue, opp.currency)} />
              <MetaRow icon={Calendar} label="Posted" value={formatDate(opp.postedDate)} />
              <MetaRow icon={Clock} label="Closing" value={formatDate(opp.closingDate, "MMM d, yyyy h:mm a")} />
              {opp.responseDeadline && (
                <MetaRow icon={Clock} label="Response Due" value={formatDate(opp.responseDeadline, "MMM d, yyyy h:mm a")} />
              )}
              <MetaRow icon={Tag} label="Category" value={opp.category} />
              {opp.naicsName && (
                <MetaRow icon={Tag} label="NAICS" value={opp.naicsName} />
              )}
              {opp.classificationName && (
                <MetaRow icon={Tag} label="PSC" value={opp.classificationName} />
              )}
              <MetaRow icon={Building2} label="Project Type" value={opp.projectType} />
              {opp.setAside && (
                <MetaRow icon={Tag} label="Set-Aside" value={opp.setAside} />
              )}
              <MetaRow icon={FileText} label="Addenda" value={String(opp.addendaCount)} />
              {opp.placeOfPerformance && (
                <MetaRow icon={MapPin} label="Place of Performance" value={opp.placeOfPerformance} />
              )}
              {opp.mandatorySiteVisit && (
                <MetaRow icon={MapPin} label="Site Visit" value={opp.mandatorySiteVisit} />
              )}
              {opp.preBidMeeting && (
                <MetaRow icon={Calendar} label="Pre-Bid Meeting" value={opp.preBidMeeting} />
              )}
            </CardContent>
          </Card>

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
                {opp.officeAddress && (
                  <MetaRow icon={MapPin} label="Office" value={opp.officeAddress} />
                )}
                {opp.department && (
                  <MetaRow icon={Building2} label="Department" value={opp.department} />
                )}
                {opp.office && (
                  <MetaRow icon={Building2} label="Office Name" value={opp.office} />
                )}
              </CardContent>
            </Card>
          )}

          {/* Why this matched */}
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
              {breakdown.title_boost != null && Number(breakdown.title_boost) > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Title boost</span>
                  <span className="font-medium text-blue-600">+{String(breakdown.title_boost)}</span>
                </div>
              )}
              {breakdown.org_bonus != null && Number(breakdown.org_bonus) > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Org bonus</span>
                  <span className="font-medium text-blue-600">+{String(breakdown.org_bonus)}</span>
                </div>
              )}
              {breakdown.source_fit_bonus != null && Number(breakdown.source_fit_bonus) > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Source fit bonus</span>
                  <span className="font-medium text-blue-600">+{String(breakdown.source_fit_bonus)}</span>
                </div>
              )}
              {breakdown.category_bonus != null && Number(breakdown.category_bonus) > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Category bonus</span>
                  <span className="font-medium text-blue-600">+{String(breakdown.category_bonus)}</span>
                </div>
              )}

              {primaryMatches.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Primary matches</p>
                  <div className="flex flex-wrap gap-1">
                    {primaryMatches.map((kw) => (
                      <span key={kw} className="inline-block rounded-sm bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">{kw}</span>
                    ))}
                  </div>
                </div>
              )}

              {secondaryMatches.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Secondary matches</p>
                  <div className="flex flex-wrap gap-1">
                    {secondaryMatches.map((kw) => (
                      <span key={kw} className="inline-block rounded-sm bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700">{kw}</span>
                    ))}
                  </div>
                </div>
              )}

              {contextualMatches.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Contextual matches</p>
                  <div className="flex flex-wrap gap-1">
                    {contextualMatches.map((kw) => (
                      <span key={kw} className="inline-block rounded-sm bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">{kw}</span>
                    ))}
                  </div>
                </div>
              )}

              {semanticMatches.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Semantic matches</p>
                  <div className="flex flex-wrap gap-1">
                    {semanticMatches.map((kw) => (
                      <span key={kw} className="inline-block rounded-sm bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-700">{kw}</span>
                    ))}
                  </div>
                </div>
              )}

              {opp.negativeKeywords.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Negative matches</p>
                  <div className="flex flex-wrap gap-1">
                    {opp.negativeKeywords.map((kw) => (
                      <span key={kw} className="inline-block rounded-sm bg-red-50 px-1.5 py-0.5 text-[10px] text-red-700">{kw}</span>
                    ))}
                  </div>
                </div>
              )}

              {opp.keywordsMatched.length === 0 && opp.negativeKeywords.length === 0 && semanticMatches.length === 0 && (
                <p className="text-sm text-muted-foreground">No keyword matches found.</p>
              )}
            </CardContent>
          </Card>

          {/* Industry Tags */}
          {opp.industryTags.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Industry Tags</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {opp.industryTags.map((tag) => (
                    <Badge key={tag} variant="default" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Tags from DB */}
          {opp.tags.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Tags</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {opp.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

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
    <div className="flex items-start gap-2">
      <Icon className="mt-px h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-2xs text-muted-foreground">{label}</p>
        <p className="text-xs font-medium break-words">{value || "—"}</p>
      </div>
    </div>
  );
}

// eslint-disable-next-line
function IntelligencePanel({ data, onReanalyze, reanalyzing }: { data: any; onReanalyze?: () => void; reanalyzing?: boolean }) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["summary", "fit", "compliance", "supply"]));

  if (!data) return null;

  const rpt: any = data.intelligenceSummary || data.intelligence_summary || {};
  const isV2 = rpt.report_version === "2.0";

  // v2 report fields
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

  // v1 fallback
  const v1feasibility: any = rpt.feasibility_assessment || {};
  const v1china: any = rpt.china_sourcing_analysis || {};

  const overallScore: number | undefined = isV2
    ? scores.overall_score
    : (data.feasibilityScore ?? data.feasibility_score ?? v1feasibility.feasibility_score);
  const recommendation: string | undefined = isV2
    ? verdict.recommendation
    : (data.recommendationStatus ?? data.recommendation_status ?? v1feasibility.recommendation);
  const confidence: string | undefined = verdict.confidence;
  const verdictLine: string | undefined = isV2 ? verdict.one_line : rpt.one_line_verdict;
  const overview: string | undefined = isV2
    ? projSummary.overview
    : (data.projectOverview || data.project_overview || rpt.project_overview);
  const analyzedAt: string | undefined = data.analyzedAt || data.analyzed_at || rpt.analyzed_at;
  const model: string | undefined = data.analysisModel || data.analysis_model || rpt.analysis_model;

  const recColors: Record<string, string> = {
    strongly_pursue: "bg-emerald-600 text-white",
    pursue: "bg-emerald-600 text-white",
    review_carefully: "bg-amber-500 text-white",
    low_probability: "bg-orange-500 text-white",
    skip: "bg-red-600 text-white",
  };

  const confColors: Record<string, string> = {
    high: "text-emerald-700", medium: "text-blue-700", low: "text-amber-700", very_low: "text-red-700",
  };

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

  const SectionHeader = ({ id, title, icon }: { id: string; title: string; icon?: React.ReactNode }) => (
    <button
      onClick={() => toggleSection(id)}
      className="flex items-center justify-between w-full py-2.5 text-left group"
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-600 group-hover:text-foreground transition-colors">{title}</span>
      </div>
      <svg className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${expandedSections.has(id) ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
      </svg>
    </button>
  );

  return (
    <Card className="border-2 border-blue-200 overflow-hidden">
      {/* ── DECISION HEADER ── */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 p-5 text-white">
        <div className="flex items-start gap-4">
          {overallScore != null && (
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div className={`flex h-14 w-14 items-center justify-center rounded-xl text-xl font-bold ${
                overallScore >= 65 ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/50"
                : overallScore >= 40 ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-400/50"
                : "bg-red-500/20 text-red-300 ring-1 ring-red-400/50"
              }`}>
                {overallScore}
              </div>
              <span className="text-[9px] text-slate-400 font-medium">SCORE</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span className="text-xs font-semibold text-slate-300 tracking-wide">TENDER INTELLIGENCE REPORT</span>
              {recommendation && (
                <span className={`rounded px-2 py-0.5 text-[10px] font-bold tracking-wide ${recColors[recommendation] || "bg-gray-600"}`}>
                  {recommendation.replace(/_/g, " ").toUpperCase()}
                </span>
              )}
              {confidence && (
                <span className={`text-[10px] font-medium ${confColors[confidence] || "text-slate-400"}`}>
                  {confidence.replace(/_/g, " ")} confidence
                </span>
              )}
              {onReanalyze && (
                <button
                  onClick={onReanalyze}
                  disabled={reanalyzing}
                  className="ml-auto inline-flex items-center gap-1 rounded border border-slate-600 px-2 py-1 text-[10px] font-medium text-slate-300 hover:bg-slate-700 transition-colors disabled:opacity-50"
                >
                  {reanalyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  Re-analyze
                </button>
              )}
            </div>
            {verdictLine && (
              <p className="text-sm text-white/90 leading-snug font-medium">{verdictLine}</p>
            )}
            {confidence && verdict.confidence_rationale && (
              <p className="text-[11px] text-slate-400 mt-1">{verdict.confidence_rationale}</p>
            )}
          </div>
        </div>

        {/* Three feasibility scores bar */}
        {isV2 && (scores.technical_feasibility != null || scores.compliance_feasibility != null || scores.commercial_feasibility != null) && (
          <div className="grid grid-cols-3 gap-3 mt-4 pt-3 border-t border-slate-700">
            {[
              { label: "Technical", val: scores.technical_feasibility },
              { label: "Compliance", val: scores.compliance_feasibility },
              { label: "Commercial", val: scores.commercial_feasibility },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <div className="text-[10px] text-slate-400 mb-1">{s.label}</div>
                <div className="w-full bg-slate-700 rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full transition-all ${
                      (s.val ?? 0) >= 65 ? "bg-emerald-400" : (s.val ?? 0) >= 40 ? "bg-amber-400" : "bg-red-400"
                    }`}
                    style={{ width: `${Math.min(s.val ?? 0, 100)}%` }}
                  />
                </div>
                <div className={`text-xs font-bold mt-0.5 ${
                  (s.val ?? 0) >= 65 ? "text-emerald-300" : (s.val ?? 0) >= 40 ? "text-amber-300" : "text-red-300"
                }`}>{s.val ?? "—"}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <CardContent className="p-0 divide-y">
        {/* ── 1. Project Summary ── */}
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

        {/* ── 2. Scope Breakdown ── */}
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

        {/* ── 3. Technical Requirements ── */}
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

        {/* ── 4. Timeline ── */}
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

        {/* ── 5. Evaluation Strategy ── */}
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

        {/* ── 6. Business Fit ── */}
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
              {(isV2 ? bizFit.fit_explanation : v1feasibility.business_fit_explanation) && (
                <p className="text-sm">{isV2 ? bizFit.fit_explanation : v1feasibility.business_fit_explanation}</p>
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

        {/* ── 7. Compliance Red Flags ── */}
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

        {/* ── 8. Compatibility Analysis ── */}
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
                {compat.proof_required && compat.proof_required !== "Not specified" && <p><span className="text-muted-foreground">Proof needed:</span> {compat.proof_required}</p>}
                {compat.compatibility_notes && <p className="text-xs text-muted-foreground">{compat.compatibility_notes}</p>}
              </div>
            )}
          </div>
        )}

        {/* ── 9. Supply Chain Feasibility ── */}
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
              ) : v1china.explanation ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className={`inline-block h-2.5 w-2.5 rounded-full ${v1china.viable ? "bg-green-500" : "bg-red-500"}`} />
                    <span className="font-medium">{v1china.viable ? "Viable" : "Not Viable"}</span>
                  </div>
                  <p>{v1china.explanation}</p>
                </>
              ) : <p className="text-muted-foreground">Not assessed.</p>}
            </div>
          )}
        </div>

        {/* ── 10. Participation Strategy ── */}
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

        {/* ── 11. Required Evidence ── */}
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

        {/* ── Footer ── */}
        <div className="px-5 py-3 flex items-center justify-between text-[10px] text-muted-foreground bg-slate-50">
          <span>
            {analyzedAt && `Analyzed ${new Date(analyzedAt).toLocaleDateString()}`}
            {model && ` · ${model === "fallback_rule_based" ? "Rule-based" : model}`}
            {isV2 && " · v2.0"}
          </span>
          <span className="flex items-center gap-1 font-medium">
            <Sparkles className="h-3 w-3" /> BidToGo Intelligence
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-slate-50/50 p-4">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{title}</h4>
      {children}
    </div>
  );
}
