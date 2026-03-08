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
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatCurrency, getRelevanceColor } from "@/lib/utils";
import type { OpportunityDetail } from "@/types";

const statusVariant: Record<string, "success" | "warning" | "destructive" | "outline"> = {
  open: "success",
  closed: "outline",
  awarded: "warning",
  cancelled: "destructive",
};

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

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

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

  const totalRelevance = Object.values(opp.relevanceBreakdown).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Back nav */}
      <Link
        href="/dashboard/opportunities"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Opportunities
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Badge variant={statusVariant[opp.status] ?? "outline"} className="text-xs">
              {opp.status.toUpperCase()}
            </Badge>
            <span
              className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold ${getRelevanceColor(opp.relevanceScore)}`}
            >
              Relevance: {opp.relevanceScore}
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

          {/* Documents */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">
                Documents ({opp.documents.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {opp.documents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No documents attached.</p>
              ) : (
                <div className="space-y-2">
                  {opp.documents.map((doc) => (
                    <div
                      key={doc.id}
                      className="flex items-center justify-between rounded-md border p-3 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <FileText className="h-5 w-5 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">{doc.title || "Untitled"}</p>
                          <p className="text-xs text-muted-foreground">
                            {doc.fileType || "FILE"} · {doc.fileSizeBytes ? formatBytes(doc.fileSizeBytes) : "—"}
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
              )}
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

          {/* Relevance breakdown */}
          {totalRelevance > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Relevance Breakdown</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {Object.entries(opp.relevanceBreakdown).map(([key, value]) => (
                  <div key={key}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-muted-foreground">{key}</span>
                      <span className="font-medium">{value}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${(value / totalRelevance) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t pt-3 text-sm font-semibold">
                  <span>Total Score</span>
                  <span
                    className={`rounded-md px-2 py-0.5 text-xs ${getRelevanceColor(opp.relevanceScore)}`}
                  >
                    {opp.relevanceScore}
                  </span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Keywords */}
          {opp.keywordsMatched.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Keywords Matched</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {opp.keywordsMatched.map((kw) => (
                    <Badge key={kw} variant="outline" className="text-xs">
                      {kw}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Tags */}
          {opp.tags.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Tags</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {opp.tags.map((tag) => (
                    <Badge key={tag} variant="default" className="text-xs">
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
