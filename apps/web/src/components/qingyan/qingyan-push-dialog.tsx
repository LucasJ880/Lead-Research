"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Send,
  Loader2,
  Calendar,
  Building2,
  Globe,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import type { OpportunityDetail, QingyanPushResponse } from "@/types";

interface QingyanPushDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opportunity: OpportunityDetail;
  recommendation?: string;
  feasibilityScore?: number;
  onSuccess: (result: QingyanPushResponse) => void;
}

export function QingyanPushDialog({
  open,
  onOpenChange,
  opportunity,
  recommendation,
  feasibilityScore,
  onSuccess,
}: QingyanPushDialogProps) {
  const [priority, setPriority] = useState<"high" | "medium" | "low">("medium");
  const [notes, setNotes] = useState("");
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePush() {
    setPushing(true);
    setError(null);

    try {
      const res = await fetch("/api/qingyan/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opportunityId: opportunity.id,
          options: {
            createAs: "project",
            priority,
            notes: notes.trim() || undefined,
          },
        }),
      });

      const data = await res.json();

      if (!res.ok && res.status !== 409) {
        throw new Error(data.error || "Push failed");
      }

      onSuccess(data as QingyanPushResponse);
      onOpenChange(false);
      setNotes("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Push failed");
    } finally {
      setPushing(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Send className="h-4 w-4 text-violet-600" />
            Push to Qingyan
          </DialogTitle>
          <DialogDescription>
            Create an internal project in Qingyan for this opportunity
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Opportunity summary */}
          <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
            <p className="text-sm font-medium leading-snug line-clamp-2">
              {opportunity.title}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {opportunity.sourceName && (
                <span className="flex items-center gap-1">
                  <Globe className="h-3 w-3" /> {opportunity.sourceName}
                </span>
              )}
              {opportunity.organization && (
                <span className="flex items-center gap-1">
                  <Building2 className="h-3 w-3" /> {opportunity.organization}
                </span>
              )}
              {opportunity.closingDate && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> Closing: {formatDate(opportunity.closingDate)}
                </span>
              )}
            </div>
            {(recommendation || feasibilityScore != null) && (
              <div className="flex items-center gap-2 pt-1">
                {recommendation && (
                  <Badge variant="outline" className="text-[10px]">
                    <Sparkles className="h-2.5 w-2.5 mr-1" />
                    {recommendation.replace(/_/g, " ").toUpperCase()}
                  </Badge>
                )}
                {feasibilityScore != null && (
                  <span className={`text-xs font-bold ${
                    feasibilityScore >= 65 ? "text-emerald-600" : feasibilityScore >= 40 ? "text-amber-600" : "text-red-600"
                  }`}>
                    Score: {feasibilityScore}/100
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Priority */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Priority
            </label>
            <div className="flex gap-2">
              {(["high", "medium", "low"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPriority(p)}
                  className={`flex-1 rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                    priority === p
                      ? p === "high"
                        ? "border-red-300 bg-red-50 text-red-700"
                        : p === "medium"
                        ? "border-amber-300 bg-amber-50 text-amber-700"
                        : "border-slate-300 bg-slate-50 text-slate-700"
                      : "border-input hover:bg-muted"
                  }`}
                >
                  {p === "high" ? "High" : p === "medium" ? "Medium" : "Low"}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add context for the internal team..."
              rows={2}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
            />
          </div>

          {/* What will be pushed */}
          <div className="rounded-lg border bg-violet-50/50 p-3">
            <p className="text-[10px] font-semibold text-violet-700 uppercase tracking-wider mb-1.5">
              Will be pushed to Qingyan
            </p>
            <div className="flex flex-wrap gap-1.5">
              {["Opportunity details", "AI intelligence", "Documents", "Source URL", "Deadline"].map((item) => (
                <span key={item} className="inline-flex items-center gap-1 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
                  <CheckCircle2 className="h-2.5 w-2.5" /> {item}
                </span>
              ))}
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={pushing}>
            Cancel
          </Button>
          <Button size="sm" onClick={handlePush} disabled={pushing} className="bg-violet-600 hover:bg-violet-700">
            {pushing ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Pushing...
              </>
            ) : (
              <>
                <Send className="mr-1.5 h-3.5 w-3.5" />
                Push to Qingyan
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
