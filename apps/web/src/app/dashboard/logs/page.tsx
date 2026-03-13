"use client";

import { useState, useEffect, useCallback } from "react";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Play,
  Calendar,
  FileSearch,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CrawlLogEntry, PaginatedResponse, RunStatus } from "@/types";

const STATUS_CONFIG: Record<
  RunStatus,
  { icon: typeof CheckCircle2; label: string; color: string }
> = {
  completed: {
    icon: CheckCircle2,
    label: "Completed",
    color: "text-emerald-600 bg-emerald-50 border-emerald-200",
  },
  failed: {
    icon: XCircle,
    label: "Failed",
    color: "text-red-600 bg-red-50 border-red-200",
  },
  running: {
    icon: Loader2,
    label: "Running",
    color: "text-blue-600 bg-blue-50 border-blue-200",
  },
  pending: {
    icon: Clock,
    label: "Pending",
    color: "text-amber-600 bg-amber-50 border-amber-200",
  },
  cancelled: {
    icon: AlertTriangle,
    label: "Cancelled",
    color: "text-slate-500 bg-slate-50 border-slate-200",
  },
};

function formatDuration(ms?: number): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m ${secs}s`;
}

function formatTime(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function LogsPage() {
  const [runs, setRuns] = useState<CrawlLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [crawlRunning, setCrawlRunning] = useState(false);
  const [crawlMessage, setCrawlMessage] = useState<string | null>(null);

  const fetchRuns = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/source-runs?page=${p}&pageSize=25`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body: PaginatedResponse<CrawlLogEntry> = await res.json();
      setRuns(body.data);
      setTotal(body.total);
      setTotalPages(body.totalPages);
      setPage(body.page);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load logs");
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-refresh: poll every 10s while any run is in progress
  const hasRunning = runs.some(
    (r) => r.status === "running" || r.status === "pending"
  );

  useEffect(() => {
    fetchRuns(1);
  }, [fetchRuns]);

  useEffect(() => {
    if (!hasRunning) return;
    const interval = setInterval(() => fetchRuns(page), 10_000);
    return () => clearInterval(interval);
  }, [hasRunning, page, fetchRuns]);

  const triggerCrawl = useCallback(async () => {
    setCrawlRunning(true);
    setCrawlMessage(null);
    try {
      const res = await fetch("/api/crawler/trigger", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setCrawlMessage(`Error: ${body.error || res.statusText}`);
      } else {
        setCrawlMessage(
          "Crawler dispatched — this page will auto-refresh while runs are in progress."
        );
        // Quick poll cycle: 3s, 6s, 15s, then the interval takes over
        setTimeout(() => fetchRuns(1), 3000);
        setTimeout(() => fetchRuns(1), 6000);
        setTimeout(() => fetchRuns(1), 15000);
      }
    } catch {
      setCrawlMessage("Failed to connect to crawler service.");
    } finally {
      setCrawlRunning(false);
    }
  }, [fetchRuns]);

  const summary = {
    total: runs.length,
    completed: runs.filter((r) => r.status === "completed").length,
    failed: runs.filter((r) => r.status === "failed").length,
    running: runs.filter((r) => r.status === "running" || r.status === "pending").length,
    totalInserted: runs.reduce((sum, r) => sum + r.opportunitiesCreated, 0),
    totalFound: runs.reduce((sum, r) => sum + r.opportunitiesFound, 0),
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Crawl Logs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Source-level crawl execution history &middot; {total} total runs
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchRuns(page)}
            className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          <button
            onClick={triggerCrawl}
            disabled={crawlRunning}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {crawlRunning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Run Crawler
          </button>
        </div>
      </div>

      {crawlMessage && (
        <div className="rounded-md border bg-blue-50 p-3 text-sm text-blue-800">
          {crawlMessage}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium text-muted-foreground">Runs on Page</p>
            <p className="mt-1 text-xl font-bold">{summary.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium text-emerald-600">Completed</p>
            <p className="mt-1 text-xl font-bold text-emerald-600">{summary.completed}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium text-red-600">Failed</p>
            <p className="mt-1 text-xl font-bold text-red-600">{summary.failed}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium text-blue-600">Running / Pending</p>
            <p className="mt-1 text-xl font-bold text-blue-600">{summary.running}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium text-muted-foreground">Opps Found / Inserted</p>
            <p className="mt-1 text-xl font-bold">
              {summary.totalFound}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                / {summary.totalInserted} new
              </span>
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Runs Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Crawl Run History</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="py-8 text-center text-sm text-destructive">{error}</div>
          ) : runs.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <FileSearch className="mx-auto h-10 w-10 mb-3 text-muted-foreground/40" />
              <p className="text-sm font-medium">No crawl runs yet</p>
              <p className="mt-1 text-xs">
                Click &ldquo;Run Crawler&rdquo; to start your first crawl.
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-b text-left text-xs font-medium uppercase tracking-wider text-muted-foreground hover:bg-transparent">
                      <TableHead className="pb-3 pr-4">Status</TableHead>
                      <TableHead className="pb-3 pr-4">Source</TableHead>
                      <TableHead className="pb-3 pr-4">Trigger</TableHead>
                      <TableHead className="pb-3 pr-4">Started</TableHead>
                      <TableHead className="pb-3 pr-4">Duration</TableHead>
                      <TableHead className="pb-3 pr-4 text-right">Pages</TableHead>
                      <TableHead className="pb-3 pr-4 text-right">Found</TableHead>
                      <TableHead className="pb-3 pr-4 text-right">New</TableHead>
                      <TableHead className="pb-3 pr-4 text-right">Updated</TableHead>
                      <TableHead className="pb-3">Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((run) => {
                      const cfg = STATUS_CONFIG[run.status] || STATUS_CONFIG.pending;
                      const StatusIcon = cfg.icon;
                      return (
                        <TableRow key={run.id} className="hover:bg-muted/50 transition-colors">
                          <TableCell className="py-3 pr-4">
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium ${cfg.color}`}
                            >
                              <StatusIcon
                                className={`h-3 w-3 ${run.status === "running" ? "animate-spin" : ""}`}
                              />
                              {cfg.label}
                            </span>
                          </TableCell>
                          <TableCell className="py-3 pr-4 font-medium max-w-[180px] truncate">
                            {run.sourceName}
                          </TableCell>
                          <TableCell className="py-3 pr-4 text-muted-foreground text-xs">
                            {run.triggeredBy === "local_agent" ? (
                              <span className="inline-flex items-center gap-1">
                                <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
                                Local Agent
                              </span>
                            ) : (
                              <span className="capitalize">{run.triggeredBy}</span>
                            )}
                          </TableCell>
                          <TableCell className="py-3 pr-4 text-muted-foreground whitespace-nowrap text-xs">
                            {formatTime(run.startedAt || run.createdAt)}
                          </TableCell>
                          <TableCell className="py-3 pr-4 text-muted-foreground whitespace-nowrap text-xs">
                            {formatDuration(run.durationMs)}
                          </TableCell>
                          <TableCell className="py-3 pr-4 text-right tabular-nums">
                            {run.pagesCrawled}
                          </TableCell>
                          <TableCell className="py-3 pr-4 text-right tabular-nums">
                            {run.opportunitiesFound}
                          </TableCell>
                          <TableCell className="py-3 pr-4 text-right tabular-nums font-medium">
                            {run.opportunitiesCreated > 0 ? (
                              <span className="text-emerald-600">
                                +{run.opportunitiesCreated}
                              </span>
                            ) : (
                              run.opportunitiesCreated
                            )}
                          </TableCell>
                          <TableCell className="py-3 pr-4 text-right tabular-nums">
                            {run.opportunitiesUpdated}
                          </TableCell>
                          <TableCell className="py-3 max-w-[200px]">
                            {run.errorMessage ? (
                              <span
                                className="text-xs text-red-600 line-clamp-2"
                                title={run.errorMessage}
                              >
                                {run.errorMessage}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t pt-4 mt-4">
                  <p className="text-xs text-muted-foreground">
                    Page {page} of {totalPages} &middot; {total} total runs
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      disabled={page <= 1}
                      onClick={() => fetchRuns(page - 1)}
                      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50 transition-colors"
                    >
                      <ChevronLeft className="h-3 w-3" /> Prev
                    </button>
                    <button
                      disabled={page >= totalPages}
                      onClick={() => fetchRuns(page + 1)}
                      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50 transition-colors"
                    >
                      Next <ChevronRight className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
