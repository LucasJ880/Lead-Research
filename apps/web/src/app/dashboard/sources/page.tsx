"use client";

import { useState, useEffect } from "react";
import {
  Plus,
  MoreHorizontal,
  Globe,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  Pause,
  Loader2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import type { SourceItem, RunStatus } from "@/types";

const runStatusConfig: Record<
  RunStatus,
  { icon: typeof CheckCircle2; color: string; label: string }
> = {
  completed: { icon: CheckCircle2, color: "text-emerald-600", label: "Completed" },
  failed: { icon: AlertCircle, color: "text-red-500", label: "Failed" },
  running: { icon: Clock, color: "text-blue-500", label: "Running" },
  pending: { icon: Clock, color: "text-amber-500", label: "Pending" },
  cancelled: { icon: XCircle, color: "text-slate-400", label: "Cancelled" },
};

const frequencyLabels: Record<string, string> = {
  hourly: "Every hour",
  daily: "Daily",
  weekly: "Weekly",
  manual: "Manual",
};

export default function SourcesPage() {
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch("/api/sources")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load sources");
        return res.json();
      })
      .then((data: SourceItem[]) => {
        setSources(data);
        setError(null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sources</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage bid portals and opportunity sources
          </p>
        </div>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" /> Add Source
        </Button>
      </div>

      {error && (
        <Card>
          <CardContent className="p-6 text-center text-sm text-destructive">
            {error}
          </CardContent>
        </Card>
      )}

      <Card>
        <div className="overflow-x-auto relative">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Country</th>
                <th className="px-4 py-3">Region</th>
                <th className="px-4 py-3">Frequency</th>
                <th className="px-4 py-3 whitespace-nowrap">Last Crawled</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-center">Active</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {sources.map((source) => {
                const runInfo = source.lastRunStatus
                  ? runStatusConfig[source.lastRunStatus]
                  : null;
                return (
                  <tr key={source.id} className="hover:bg-muted/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                          <Globe className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div>
                          <p className="font-medium">{source.name}</p>
                          <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                            {source.baseUrl}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className="text-xs capitalize">
                        {source.sourceType.replace("_", " ")}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{source.country}</td>
                    <td className="px-4 py-3 text-muted-foreground">{source.region ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {frequencyLabels[source.frequency] ?? source.frequency}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {formatDate(source.lastCrawledAt, "MMM d, h:mm a")}
                    </td>
                    <td className="px-4 py-3">
                      {runInfo && (
                        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${runInfo.color}`}>
                          <runInfo.icon className="h-3.5 w-3.5" />
                          {runInfo.label}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {source.isActive ? (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        </span>
                      ) : (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-100">
                          <Pause className="h-3.5 w-3.5 text-slate-400" />
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {!loading && sources.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                    No sources configured yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
