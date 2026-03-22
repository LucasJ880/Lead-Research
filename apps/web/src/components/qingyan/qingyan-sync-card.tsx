"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ExternalLink,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Send,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import type { QingyanSyncInfo } from "@/types";

interface QingyanSyncCardProps {
  syncInfo: QingyanSyncInfo;
  onRetry?: () => void;
  retrying?: boolean;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  synced: { label: "Synced", color: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: CheckCircle2 },
  pushing: { label: "Pushing...", color: "bg-blue-50 text-blue-700 border-blue-200", icon: Loader2 },
  pending: { label: "Pending", color: "bg-amber-50 text-amber-700 border-amber-200", icon: Clock },
  failed: { label: "Failed", color: "bg-red-50 text-red-700 border-red-200", icon: XCircle },
  cancelled: { label: "Cancelled", color: "bg-slate-50 text-slate-600 border-slate-200", icon: XCircle },
};

const QINGYAN_STATUS_LABELS: Record<string, string> = {
  new: "New",
  under_review: "Under Review",
  qualification_check: "Qualification Check",
  pursuing: "Pursuing",
  supplier_quote: "Supplier Quote",
  bid_preparation: "Bid Preparation",
  bid_submitted: "Bid Submitted",
  won: "Won",
  lost: "Lost",
  passed: "Passed",
  archived: "Archived",
};

export function QingyanSyncCard({ syncInfo, onRetry, retrying }: QingyanSyncCardProps) {
  const statusConfig = STATUS_CONFIG[syncInfo.syncStatus] || STATUS_CONFIG.pending;
  const StatusIcon = statusConfig.icon;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            <Send className="h-3.5 w-3.5 text-violet-600" />
            Qingyan
          </CardTitle>
          <Badge variant="outline" className={`text-[10px] ${statusConfig.color}`}>
            <StatusIcon className={`h-2.5 w-2.5 mr-1 ${syncInfo.syncStatus === "pushing" ? "animate-spin" : ""}`} />
            {statusConfig.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {syncInfo.qingyanProjectId && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground text-xs">Project ID</span>
            <span className="font-mono text-xs font-medium">{syncInfo.qingyanProjectId}</span>
          </div>
        )}

        {syncInfo.qingyanStatus && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground text-xs">Qingyan Status</span>
            <Badge variant="outline" className="text-[10px]">
              {QINGYAN_STATUS_LABELS[syncInfo.qingyanStatus] || syncInfo.qingyanStatus}
            </Badge>
          </div>
        )}

        {syncInfo.pushedByName && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground text-xs">Pushed By</span>
            <span className="text-xs font-medium">{syncInfo.pushedByName}</span>
          </div>
        )}

        {syncInfo.pushedAt && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground text-xs">Pushed At</span>
            <span className="text-xs">{formatDate(syncInfo.pushedAt, "MMM d, yyyy h:mm a")}</span>
          </div>
        )}

        {syncInfo.lastSyncAt && syncInfo.lastSyncAt !== syncInfo.pushedAt && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground text-xs">Last Sync</span>
            <span className="text-xs">{formatDate(syncInfo.lastSyncAt, "MMM d, yyyy h:mm a")}</span>
          </div>
        )}

        {syncInfo.errorMessage && (
          <div className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[10px] text-red-700">
            {syncInfo.errorMessage}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          {syncInfo.qingyanUrl && (
            <a
              href={syncInfo.qingyanUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1.5 text-[10px] font-medium text-white hover:bg-violet-700 transition-colors flex-1 justify-center"
            >
              <ExternalLink className="h-3 w-3" />
              View in Qingyan
            </a>
          )}
          {syncInfo.syncStatus === "failed" && onRetry && (
            <button
              onClick={onRetry}
              disabled={retrying}
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[10px] font-medium hover:bg-muted transition-colors disabled:opacity-50"
            >
              {retrying ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Retry
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
