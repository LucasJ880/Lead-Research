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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [intel, setIntel] = useState<any>(null);
  const [intelLoading, setIntelLoading] = useState(false);

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
    fetch(`/api/intelligence/${id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setIntel(data))
      .catch(() => {})
      .finally(() => setIntelLoading(false));
  }, [id]);

  useEffect(() => {
    fetchDetail();
    fetchIntelligence();
  }, [fetchDetail, fetchIntelligence]);

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
      alert("Failed to update workflow status.");
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
      alert("Failed to save note. Please try again.");
    } finally {
      setSubmittingNote(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Link
          href="/dashboard/opportunities"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Opportunities
        </Link>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (error === "not_found") {
    return (
      <div className="space-y-6 animate-fade-in">
        <Link
          href="/dashboard/opportunities"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Opportunities
        </Link>
        <Card>
          <CardContent className="p-12 text-center">
            <h2 className="text-lg font-semibold">Opportunity Not Found</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              The opportunity you&apos;re looking for doesn&apos;t exist or has been removed.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Link
          href="/dashboard/opportunities"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Opportunities
        </Link>
        <Card>
          <CardContent className="p-6 text-center text-sm text-destructive">
            {error}
          </CardContent>
        </Card>
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
    <div className="space-y-6 animate-fade-in">
      <Link
        href="/dashboard/opportunities"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Opportunities
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusVariant[opp.status] ?? "outline"} className="text-xs">
              {opp.status.toUpperCase()}
            </Badge>
            <span
              className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold ${getRelevanceColor(opp.relevanceScore)}`}
            >
              Score: {opp.relevanceScore}
            </span>
            <span
              className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${getBucketColor(opp.relevanceBucket)}`}
            >
              {getBucketLabel(opp.relevanceBucket)}
            </span>
            <span
              className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${getWorkflowColor(opp.workflowStatus)}`}
            >
              {getWorkflowLabel(opp.workflowStatus)}
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{opp.title}</h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {opp.organization && (
              <span className="flex items-center gap-1">
                <Building2 className="h-3.5 w-3.5" /> {opp.organization}
              </span>
            )}
            <span className="flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />{" "}
              {[opp.city, opp.region, opp.country].filter(Boolean).join(", ")}
            </span>
            <span className="flex items-center gap-1">
              <Globe className="h-3.5 w-3.5" /> {opp.sourceName}
            </span>
          </div>
        </div>
        <Button variant="outline" size="sm" asChild>
          <a href={opp.sourceUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="mr-2 h-4 w-4" /> View Original
          </a>
        </Button>
      </div>

      {/* Workflow actions */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground mr-2">Actions:</span>
            {WORKFLOW_ACTIONS.map((action) => {
              const isActive = opp.workflowStatus === action.value;
              return (
                <button
                  key={action.value}
                  onClick={() => handleWorkflowChange(action.value)}
                  disabled={updatingWorkflow || isActive}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50
                    ${isActive
                      ? getWorkflowColor(action.value) + " ring-2 ring-offset-1 ring-primary/30"
                      : "bg-background hover:bg-muted border-input text-muted-foreground"
                    }`}
                >
                  <action.icon className="h-3.5 w-3.5" />
                  {action.shortLabel}
                  {isActive && <CheckCircle2 className="h-3 w-3" />}
                </button>
              );
            })}
          </div>
          {opp.workflowUpdatedAt && (
            <p className="mt-2 text-xs text-muted-foreground">
              Status updated {formatDate(opp.workflowUpdatedAt, "MMM d, yyyy h:mm a")}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main content */}
        <div className="space-y-6 lg:col-span-2">
          {/* Description */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Description</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="prose prose-sm max-w-none text-foreground">
                {(opp.descriptionFull || opp.descriptionSummary || "No description available.")
                  .split("\n")
                  .map((line, i) => (
                    <p key={i} className={line.startsWith("-") ? "ml-4" : ""}>
                      {line || <br />}
                    </p>
                  ))}
              </div>
            </CardContent>
          </Card>

          {/* Intelligence Panel */}
          {intel?.intelligence && <IntelligencePanel data={intel.intelligence} />}

          {/* Documents (from intelligence + original) */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">
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
                  <div className="space-y-2">
                    {docs.map((doc: { id: string; title?: string; url: string; fileType?: string; fileSizeBytes?: number; pageCount?: number; downloadedAt?: string; docCategory?: string }) => (
                      <div
                        key={doc.id}
                        className="flex items-center justify-between rounded-md border p-3 hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <FileText className="h-5 w-5 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">{doc.title || "Untitled"}</p>
                            <p className="text-xs text-muted-foreground">
                              {doc.fileType?.toUpperCase() || "FILE"}
                              {doc.fileSizeBytes ? ` · ${formatBytes(doc.fileSizeBytes)}` : ""}
                              {doc.pageCount ? ` · ${doc.pageCount} pages` : ""}
                              {doc.downloadedAt ? " · Downloaded" : ""}
                            </p>
                          </div>
                        </div>
                        <Button variant="ghost" size="sm" asChild>
                          <a href={doc.url} target="_blank" rel="noopener noreferrer">
                            <Download className="h-4 w-4" />
                          </a>
                        </Button>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </CardContent>
          </Card>

          {/* Notes */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Notes</CardTitle>
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
        <div className="space-y-6">
          {/* Key details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
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
              <CardHeader>
                <CardTitle className="text-base">Contact</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <MetaRow icon={User} label="Name" value={opp.contactName} />
                <MetaRow icon={Mail} label="Email" value={opp.contactEmail} />
                <MetaRow icon={Phone} label="Phone" value={opp.contactPhone} />
              </CardContent>
            </Card>
          )}

          {/* Why this matched */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Why This Matched</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
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
              <CardHeader>
                <CardTitle className="text-base">Industry Tags</CardTitle>
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
              <CardHeader>
                <CardTitle className="text-base">Tags</CardTitle>
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
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="text-sm break-words">{value || "—"}</p>
      </div>
    </div>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function IntelligencePanel({ data }: { data: any }) {
  if (!data) return null;

  // Handle both camelCase (Prisma) and snake_case (raw SQL) keys
  const summary = data.intelligenceSummary || data.intelligence_summary || {};
  const feasibility = summary.feasibility_assessment || {};
  const china = summary.china_sourcing_analysis || {};
  const tech = data.technicalRequirements || data.technical_requirements || summary.technical_requirements || {};
  const quals = data.qualificationReqs || data.qualification_reqs || summary.qualification_requirements || {};
  const dates = data.criticalDates || data.critical_dates || summary.critical_dates || {};
  const risks = data.riskFactors || data.risk_factors || summary.risk_factors || [];
  const wcr = summary.window_covering_relevance || {};

  const recColors: Record<string, string> = {
    strongly_pursue: "bg-emerald-100 text-emerald-800 border-emerald-300",
    pursue: "bg-green-100 text-green-800 border-green-300",
    review_carefully: "bg-amber-100 text-amber-800 border-amber-300",
    low_probability: "bg-orange-100 text-orange-800 border-orange-300",
    skip: "bg-red-100 text-red-800 border-red-300",
  };

  const feasScore = data.feasibilityScore ?? data.feasibility_score ?? feasibility.feasibility_score;
  const recommendation = data.recommendationStatus ?? data.recommendation_status ?? feasibility.recommendation;

  return (
    <Card className="border-2 border-blue-200 bg-blue-50/30">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <svg className="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
            </svg>
            AI Tender Intelligence
          </CardTitle>
          {(data.analyzedAt || data.analyzed_at) && (
            <span className="text-xs text-muted-foreground">
              Analyzed {new Date(data.analyzedAt || data.analyzed_at).toLocaleDateString()}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Feasibility Score & Recommendation */}
        <div className="flex items-center gap-4 p-4 rounded-lg bg-white border">
          {feasScore != null && (
            <div className="text-center">
              <div className={`text-3xl font-bold ${
                feasScore >= 70 ? "text-emerald-600" : feasScore >= 40 ? "text-amber-600" : "text-red-600"
              }`}>
                {feasScore}
              </div>
              <div className="text-xs text-muted-foreground">Feasibility</div>
            </div>
          )}
          {recommendation && (
            <div className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${recColors[recommendation] || "bg-gray-100"}`}>
              {recommendation.replace(/_/g, " ").toUpperCase()}
            </div>
          )}
        </div>

        {/* Project Overview */}
        {(data.projectOverview || data.project_overview || summary.project_overview) && (
          <Section title="Project Overview">
            <p className="text-sm">{data.projectOverview || data.project_overview || summary.project_overview}</p>
          </Section>
        )}

        {/* Scope of Work */}
        {(data.scopeOfWork || data.scope_of_work || summary.scope_of_work) && (
          <Section title="Scope of Work">
            <p className="text-sm">{data.scopeOfWork || data.scope_of_work || summary.scope_of_work}</p>
            {(data.scopeType || data.scope_type || summary.scope_type) && (
              <Badge variant="outline" className="mt-2 text-xs">
                {(data.scopeType || data.scope_type || summary.scope_type).replace(/_/g, " ")}
              </Badge>
            )}
          </Section>
        )}

        {/* Window Covering Relevance */}
        {wcr.relevance_explanation && (
          <Section title="Industry Relevance">
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
          </Section>
        )}

        {/* Technical Requirements */}
        {tech.materials?.length > 0 && (
          <Section title="Technical Requirements">
            {tech.materials.length > 0 && (
              <div className="mb-2">
                <p className="text-xs font-medium text-muted-foreground mb-1">Materials</p>
                <div className="flex flex-wrap gap-1">
                  {tech.materials.map((m: string) => (
                    <Badge key={m} variant="outline" className="text-xs">{m}</Badge>
                  ))}
                </div>
              </div>
            )}
            {tech.measurements && <p className="text-sm"><strong>Measurements:</strong> {tech.measurements}</p>}
            {tech.compliance?.length > 0 && (
              <div className="mt-2">
                <p className="text-xs font-medium text-muted-foreground mb-1">Compliance</p>
                <div className="flex flex-wrap gap-1">
                  {tech.compliance.map((c: string) => (
                    <Badge key={c} variant="outline" className="text-xs">{c}</Badge>
                  ))}
                </div>
              </div>
            )}
          </Section>
        )}

        {/* Qualification Requirements */}
        {(quals.certifications?.length > 0 || quals.bonding || quals.experience_years !== "not specified") && (
          <Section title="Qualification Requirements">
            <div className="space-y-1 text-sm">
              {quals.experience_years && quals.experience_years !== "not specified" && (
                <p><strong>Experience:</strong> {quals.experience_years}</p>
              )}
              {quals.bonding && <p><strong>Bonding:</strong> {quals.bonding}</p>}
              {quals.insurance_min && quals.insurance_min !== "not specified" && (
                <p><strong>Insurance:</strong> {quals.insurance_min}</p>
              )}
              {quals.labor_requirements && <p><strong>Labor:</strong> {quals.labor_requirements}</p>}
              {quals.certifications?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {quals.certifications.map((c: string) => (
                    <Badge key={c} variant="outline" className="text-xs">{c}</Badge>
                  ))}
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Critical Dates */}
        {(dates.site_visit_date || dates.pre_bid_meeting || dates.project_start || dates.project_completion) && (
          <Section title="Critical Dates">
            <div className="space-y-1 text-sm">
              {dates.site_visit_date && <p><strong>Site Visit:</strong> {dates.site_visit_date}</p>}
              {dates.pre_bid_meeting && <p><strong>Pre-Bid Meeting:</strong> {dates.pre_bid_meeting}</p>}
              {dates.project_start && <p><strong>Project Start:</strong> {dates.project_start}</p>}
              {dates.project_completion && <p><strong>Completion:</strong> {dates.project_completion}</p>}
              {dates.timeline_notes && <p className="text-muted-foreground">{dates.timeline_notes}</p>}
            </div>
          </Section>
        )}

        {/* Risk Factors */}
        {risks.length > 0 && (
          <Section title="Risk Factors">
            <ul className="space-y-1">
              {(Array.isArray(risks) ? risks : []).map((risk: string, i: number) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                  {risk}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* China Sourcing */}
        {china.explanation && (
          <Section title="China Sourcing Analysis">
            <div className="flex items-center gap-2 mb-2">
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${china.viable ? "bg-green-500" : "bg-red-500"}`} />
              <span className="text-sm font-medium">{china.viable ? "Viable" : "Not Viable"}</span>
            </div>
            <p className="text-sm">{china.explanation}</p>
            {china.restrictions?.length > 0 && (
              <div className="mt-2">
                <p className="text-xs font-medium text-muted-foreground">Restrictions</p>
                <ul className="text-sm mt-1 space-y-1">
                  {china.restrictions.map((r: string, i: number) => <li key={i}>- {r}</li>)}
                </ul>
              </div>
            )}
            {china.lead_time_concern && (
              <p className="text-sm mt-1 text-muted-foreground">{china.lead_time_concern}</p>
            )}
          </Section>
        )}

        {/* Recommended Action */}
        {(summary.recommended_action || data.businessFitExplanation || data.business_fit_explanation) && (
          <div className="rounded-lg border-2 border-blue-300 bg-blue-50 p-4">
            <p className="text-xs font-medium text-blue-800 mb-1">Recommended Action</p>
            <p className="text-sm text-blue-900">{summary.recommended_action || data.businessFitExplanation || data.business_fit_explanation}</p>
          </div>
        )}

        {/* Business Fit */}
        {feasibility.key_advantages?.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-xs font-medium text-emerald-700 mb-2">Key Advantages</p>
              <ul className="space-y-1">
                {feasibility.key_advantages.map((a: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-emerald-800">
                    <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {a}
                  </li>
                ))}
              </ul>
            </div>
            {feasibility.key_concerns?.length > 0 && (
              <div>
                <p className="text-xs font-medium text-amber-700 mb-2">Key Concerns</p>
                <ul className="space-y-1">
                  {feasibility.key_concerns.map((c: string, i: number) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-amber-800">
                      <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {(data.analysisModel || data.analysis_model) && (
          <p className="text-xs text-muted-foreground text-right">
            Model: {data.analysisModel || data.analysis_model}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{title}</h4>
      {children}
    </div>
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */
