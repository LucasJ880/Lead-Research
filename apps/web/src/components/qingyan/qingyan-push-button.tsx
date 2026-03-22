"use client";

import { useState, useCallback, useEffect } from "react";
import {
  Send,
  CheckCircle2,
  Loader2,
  XCircle,
  ExternalLink,
} from "lucide-react";
import { QingyanPushDialog } from "./qingyan-push-dialog";
import type { OpportunityDetail, QingyanSyncInfo, QingyanPushResponse } from "@/types";

interface QingyanPushButtonProps {
  opportunity: OpportunityDetail;
  recommendation?: string;
  feasibilityScore?: number;
  darkMode?: boolean;
  onSyncUpdate?: (sync: QingyanSyncInfo) => void;
}

export function QingyanPushButton({
  opportunity,
  recommendation,
  feasibilityScore,
  darkMode = false,
  onSyncUpdate,
}: QingyanPushButtonProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [syncInfo, setSyncInfo] = useState<QingyanSyncInfo | null>(
    opportunity.qingyanSync ?? null
  );
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    fetch(`/api/qingyan/status/${opportunity.id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.enabled === false) {
          setEnabled(false);
          return;
        }
        if (data.synced || data.syncStatus) {
          setSyncInfo(data);
          onSyncUpdate?.(data);
        }
      })
      .catch(() => {});
  }, [opportunity.id, onSyncUpdate]);

  const handleSuccess = useCallback(
    (result: QingyanPushResponse) => {
      const updated: QingyanSyncInfo = {
        id: result.syncId,
        syncStatus: result.status,
        qingyanProjectId: result.qingyanProjectId,
        qingyanUrl: result.qingyanUrl,
        pushedAt: result.pushedAt,
        retryCount: 0,
      };
      setSyncInfo(updated);
      onSyncUpdate?.(updated);
    },
    [onSyncUpdate]
  );

  if (!enabled) return null;

  const isSynced = syncInfo?.syncStatus === "synced";
  const isFailed = syncInfo?.syncStatus === "failed";
  const isPushing = syncInfo?.syncStatus === "pushing";

  if (isSynced) {
    return (
      <div className="flex items-center gap-1.5">
        {syncInfo.qingyanUrl ? (
          <a
            href={syncInfo.qingyanUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-medium transition-all ${
              darkMode
                ? "bg-violet-500/20 ring-1 ring-violet-400/40 text-violet-200 hover:bg-violet-500/30"
                : "bg-violet-50 ring-1 ring-violet-200 text-violet-700 hover:bg-violet-100"
            }`}
          >
            <CheckCircle2 className="h-3 w-3" />
            QY · {syncInfo.qingyanProjectId || "Linked"}
            <ExternalLink className="h-2.5 w-2.5 ml-0.5 opacity-60" />
          </a>
        ) : (
          <span
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-medium ${
              darkMode
                ? "bg-violet-500/20 text-violet-200"
                : "bg-violet-50 text-violet-700"
            }`}
          >
            <CheckCircle2 className="h-3 w-3" />
            In Qingyan
          </span>
        )}
      </div>
    );
  }

  if (isPushing) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-medium ${
          darkMode ? "text-slate-300" : "text-muted-foreground"
        }`}
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        Pushing...
      </span>
    );
  }

  return (
    <>
      <button
        onClick={() => setDialogOpen(true)}
        className={`inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-medium transition-all ${
          isFailed
            ? darkMode
              ? "border border-red-400/50 text-red-300 hover:bg-red-500/20"
              : "border border-red-300 text-red-600 hover:bg-red-50"
            : darkMode
            ? "border border-violet-400/40 text-violet-200 hover:bg-violet-500/20"
            : "border border-violet-300 text-violet-700 hover:bg-violet-50"
        }`}
      >
        {isFailed ? (
          <>
            <XCircle className="h-3 w-3" />
            Retry Push
          </>
        ) : (
          <>
            <Send className="h-3 w-3" />
            Qingyan
          </>
        )}
      </button>

      <QingyanPushDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        opportunity={opportunity}
        recommendation={recommendation}
        feasibilityScore={feasibilityScore}
        onSuccess={handleSuccess}
      />
    </>
  );
}
