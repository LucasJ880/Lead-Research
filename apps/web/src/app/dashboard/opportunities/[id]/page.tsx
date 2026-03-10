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
              <MetaRow icon={Tag} label="Category" value={opp.category} />
              <MetaRow icon={Building2} label="Project Type" value={opp.projectType} />
              <MetaRow icon={FileText} label="Addenda" value={String(opp.addendaCount)} />
              {opp.mandatorySiteVisit && (
                <MetaRow icon={MapPin} label="Site Visit" value={opp.mandatorySiteVisit} />
              )}
              {opp.preBidMeeting && (
                <MetaRow icon={Calendar} label="Pre-Bid Meeting" value={opp.preBidMeeting} />
              )}
            </CardContent>
          </Card>

          {/* Contact */}
          {(opp.contactName || opp.contactEmail || opp.contactPhone) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Contact</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <MetaRow icon={User} label="Name" value={opp.contactName} />
                <MetaRow icon={Mail} label="Email" value={opp.contactEmail} />
                <MetaRow icon={Phone} label="Phone" value={opp.contactPhone} />
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
  const [showDetails, setShowDetails] = useState(false);

  if (!data) return null;

  const summary: any = data.intelligenceSummary || data.intelligence_summary || {};
  const feasibility: any = summary.feasibility_assessment || {};
  const china: any = summary.china_sourcing_analysis || {};
  const tech: any = data.technicalRequirements || data.technical_requirements || summary.technical_requirements || {};
  const quals: any = data.qualificationReqs || data.qualification_reqs || summary.qualification_requirements || {};
  const dates: any = data.criticalDates || data.critical_dates || summary.critical_dates || {};
  const risks: string[] = data.riskFactors || data.risk_factors || summary.risk_factors || [];
  const wcr: any = summary.window_covering_relevance || {};

  const recColors: Record<string, string> = {
    strongly_pursue: "bg-emerald-100 text-emerald-800 border-emerald-300",
    pursue: "bg-green-100 text-green-800 border-green-300",
    review_carefully: "bg-amber-100 text-amber-800 border-amber-300",
    low_probability: "bg-orange-100 text-orange-800 border-orange-300",
    skip: "bg-red-100 text-red-800 border-red-300",
  };

  const feasScore: number | undefined = data.feasibilityScore ?? data.feasibility_score ?? feasibility.feasibility_score;
  const recommendation: string | undefined = data.recommendationStatus ?? data.recommendation_status ?? feasibility.recommendation;
  const verdict: string | undefined = summary.one_line_verdict;
  const overview: string | undefined = data.projectOverview || data.project_overview || summary.project_overview;
  const scopeType: string | undefined = data.scopeType || data.scope_type || summary.scope_type;
  const advantages: string[] = feasibility.key_advantages || [];
  const concerns: string[] = feasibility.key_concerns || [];
  const recAction: string | undefined = summary.recommended_action || data.businessFitExplanation || data.business_fit_explanation;
  const analyzedAt: string | undefined = data.analyzedAt || data.analyzed_at;
  const model: string | undefined = data.analysisModel || data.analysis_model;

  return (
    <Card className="border-2 border-blue-200 overflow-hidden">
      {/* ── TIER 1: Decision Header ── */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-5">
        <div className="flex items-start gap-5">
          {feasScore != null && (
            <div className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border-2 text-2xl font-bold ${
              feasScore >= 70 ? "border-emerald-400 text-emerald-600 bg-emerald-50"
              : feasScore >= 40 ? "border-amber-400 text-amber-600 bg-amber-50"
              : "border-red-400 text-red-600 bg-red-50"
            }`}>
              {feasScore}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 flex-wrap">
                <Sparkles className="h-4 w-4 text-blue-600" />
                <span className="text-sm font-semibold text-blue-900">AI Intelligence Report</span>
              {recommendation && (
                <span className={`rounded-md border px-2.5 py-0.5 text-xs font-bold ${recColors[recommendation] || "bg-gray-100"}`}>
                  {recommendation.replace(/_/g, " ").toUpperCase()}
                </span>
              )}
              {scopeType && scopeType !== "unclear" && (
                <Badge variant="outline" className="text-[10px]">
                  {scopeType.replace(/_/g, " ")}
                </Badge>
              )}
              </div>
              {onReanalyze && (
                <button
                  onClick={onReanalyze}
                  disabled={reanalyzing}
                  className="inline-flex items-center gap-1.5 rounded-md border border-blue-300 bg-white px-2.5 py-1.5 text-2xs font-medium text-blue-700 hover:bg-blue-50 transition-colors disabled:opacity-50 shrink-0"
                >
                  {reanalyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  Re-analyze
                </button>
              )}
            </div>
            {verdict && (
              <p className="mt-1.5 text-sm text-blue-800 leading-snug">{verdict}</p>
            )}
            {!verdict && overview && (
              <p className="mt-1.5 text-sm text-blue-800 leading-snug line-clamp-2">{overview}</p>
            )}
          </div>
        </div>
      </div>

      <CardContent className="p-5 space-y-5">
        {/* ── TIER 2: Key Intelligence ── */}
        {verdict && overview && (
          <div className="rounded-lg border bg-white p-4">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Project Summary</h4>
            <p className="text-sm leading-relaxed">{overview}</p>
          </div>
        )}

        {/* Advantages vs Concerns — side by side */}
        {(advantages.length > 0 || concerns.length > 0) && (
          <div className="grid gap-4 md:grid-cols-2">
            {advantages.length > 0 && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4">
                <h4 className="text-xs font-semibold text-emerald-700 uppercase tracking-wider mb-2">Why It Fits</h4>
                <ul className="space-y-1.5">
                  {advantages.map((a, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-emerald-800">
                      <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {a}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {concerns.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4">
                <h4 className="text-xs font-semibold text-amber-700 uppercase tracking-wider mb-2">Key Concerns</h4>
                <ul className="space-y-1.5">
                  {concerns.map((c, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-amber-800">
                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* ── TIER 3: Decision Factors ── */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* Timeline */}
          {(dates.site_visit_date || dates.pre_bid_meeting || dates.project_start || dates.project_completion || dates.timeline_notes) && (
            <div className="rounded-lg border bg-white p-4">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Timeline</h4>
              <div className="space-y-1 text-sm">
                {dates.site_visit_date && <p><span className="text-muted-foreground">Site Visit:</span> {dates.site_visit_date}</p>}
                {dates.pre_bid_meeting && <p><span className="text-muted-foreground">Pre-Bid:</span> {dates.pre_bid_meeting}</p>}
                {dates.project_start && <p><span className="text-muted-foreground">Start:</span> {dates.project_start}</p>}
                {dates.project_completion && <p><span className="text-muted-foreground">Completion:</span> {dates.project_completion}</p>}
                {dates.timeline_notes && (
                  <p className="text-xs text-amber-700 mt-1 flex items-start gap-1">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                    {dates.timeline_notes}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* China Sourcing */}
          {china.explanation && (
            <div className="rounded-lg border bg-white p-4">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">China Sourcing</h4>
              <div className="flex items-center gap-2 mb-1.5">
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${china.viable ? "bg-green-500" : "bg-red-500"}`} />
                <span className="text-sm font-medium">{china.viable ? "Viable" : "Not Viable"}</span>
              </div>
              <p className="text-sm text-muted-foreground">{china.explanation}</p>
              {china.lead_time_concern && (
                <p className="text-xs text-muted-foreground mt-1">{china.lead_time_concern}</p>
              )}
            </div>
          )}
        </div>

        {/* Industry Relevance */}
        {wcr.relevance_explanation && (
          <div className="rounded-lg border bg-white p-4">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Industry Relevance</h4>
            <p className="text-sm">{wcr.relevance_explanation}</p>
            {wcr.specific_products?.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {wcr.specific_products.map((p: string) => (
                  <Badge key={p} variant="default" className="text-xs">{p}</Badge>
                ))}
              </div>
            )}
            {wcr.estimated_scope_percentage != null && (
              <p className="text-xs text-muted-foreground mt-1">
                Est. scope: {wcr.estimated_scope_percentage}% window coverings/textiles
              </p>
            )}
          </div>
        )}

        {/* Recommended Action */}
        {recAction && (
          <div className="rounded-lg border-2 border-blue-300 bg-blue-50 p-4">
            <h4 className="text-xs font-semibold text-blue-800 uppercase tracking-wider mb-1">Next Step</h4>
            <p className="text-sm text-blue-900">{recAction}</p>
          </div>
        )}

        {/* Risk Factors (compact) */}
        {(Array.isArray(risks) ? risks : []).length > 0 && (
          <div className="rounded-lg border bg-white p-4">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Risk Factors</h4>
            <ul className="space-y-1">
              {(Array.isArray(risks) ? risks : []).map((risk, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                  {risk}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── TIER 4: Expandable Details ── */}
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center gap-2 text-xs font-medium text-blue-700 hover:text-blue-900 transition-colors w-full justify-center py-2 rounded-md border border-dashed border-blue-300 hover:bg-blue-50"
        >
          {showDetails ? "Hide" : "Show"} Full Details
          <svg className={`h-3.5 w-3.5 transition-transform ${showDetails ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>

        {showDetails && (
          <div className="space-y-4 animate-fade-in">
            {/* Scope of Work */}
            {(data.scopeOfWork || data.scope_of_work || summary.scope_of_work) && (
              <DetailSection title="Scope of Work">
                <p className="text-sm">{data.scopeOfWork || data.scope_of_work || summary.scope_of_work}</p>
              </DetailSection>
            )}

            {/* Technical Requirements */}
            {tech.materials?.length > 0 && (
              <DetailSection title="Technical Requirements">
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1">
                    {tech.materials.map((m: string) => (
                      <Badge key={m} variant="outline" className="text-xs">{m}</Badge>
                    ))}
                  </div>
                  {tech.measurements && <p className="text-sm"><span className="text-muted-foreground">Measurements:</span> {tech.measurements}</p>}
                  {tech.compliance?.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {tech.compliance.map((c: string) => (
                        <Badge key={c} variant="outline" className="text-xs bg-violet-50 text-violet-700 border-violet-200">{c}</Badge>
                      ))}
                    </div>
                  )}
                </div>
              </DetailSection>
            )}

            {/* Qualification Requirements */}
            {(quals.certifications?.length > 0 || quals.bonding || (quals.experience_years && quals.experience_years !== "not specified")) && (
              <DetailSection title="Qualification Requirements">
                <div className="space-y-1 text-sm">
                  {quals.experience_years && quals.experience_years !== "not specified" && (
                    <p><span className="text-muted-foreground">Experience:</span> {quals.experience_years}</p>
                  )}
                  {quals.bonding && <p><span className="text-muted-foreground">Bonding:</span> {quals.bonding}</p>}
                  {quals.insurance_min && quals.insurance_min !== "not specified" && (
                    <p><span className="text-muted-foreground">Insurance:</span> {quals.insurance_min}</p>
                  )}
                  {quals.labor_requirements && <p><span className="text-muted-foreground">Labor:</span> {quals.labor_requirements}</p>}
                  {quals.certifications?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {quals.certifications.map((c: string) => (
                        <Badge key={c} variant="outline" className="text-xs">{c}</Badge>
                      ))}
                    </div>
                  )}
                </div>
              </DetailSection>
            )}

            {/* China Sourcing Restrictions */}
            {china.restrictions?.length > 0 && (
              <DetailSection title="China Sourcing Restrictions">
                <ul className="text-sm space-y-1">
                  {china.restrictions.map((r: string, i: number) => <li key={i} className="flex items-start gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-red-400 shrink-0" />{r}</li>)}
                </ul>
              </DetailSection>
            )}
          </div>
        )}

        {/* Footer metadata */}
        <div className="flex items-center justify-between pt-2 border-t text-[10px] text-muted-foreground">
          <span>
            {analyzedAt && `Analyzed ${new Date(analyzedAt).toLocaleDateString()}`}
            {model && ` · ${model === "fallback_rule_based" ? "Rule-based" : model}`}
          </span>
          <span className="flex items-center gap-1">
            <Sparkles className="h-3 w-3" /> BidToGo AI
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
