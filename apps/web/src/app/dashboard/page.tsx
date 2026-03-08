"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  FileSearch,
  FolderOpen,
  CalendarClock,
  TrendingUp,
  ArrowUpRight,
  ExternalLink,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate, getRelevanceColor } from "@/lib/utils";
import type { DashboardStats } from "@/types";

const STAT_CONFIG = [
  {
    key: "totalOpportunities" as const,
    label: "Total Opportunities",
    icon: FileSearch,
    color: "text-blue-600 bg-blue-50",
  },
  {
    key: "openOpportunities" as const,
    label: "Open Opportunities",
    icon: FolderOpen,
    color: "text-emerald-600 bg-emerald-50",
  },
  {
    key: "closingThisWeek" as const,
    label: "Closing This Week",
    icon: CalendarClock,
    color: "text-amber-600 bg-amber-50",
  },
  {
    key: "highRelevanceLeads" as const,
    label: "High Relevance Leads",
    icon: TrendingUp,
    color: "text-violet-600 bg-violet-50",
  },
];

const statusVariant: Record<string, "success" | "warning" | "destructive" | "outline"> = {
  open: "success",
  closed: "outline",
  awarded: "warning",
  cancelled: "destructive",
};

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch("/api/stats")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load dashboard stats");
        return res.json();
      })
      .then((data: DashboardStats) => {
        setStats(data);
        setError(null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Overview of your opportunity pipeline
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="space-y-3">
                    <div className="h-4 w-32 animate-pulse rounded bg-muted" />
                    <div className="h-8 w-20 animate-pulse rounded bg-muted" />
                    <div className="h-3 w-24 animate-pulse rounded bg-muted" />
                  </div>
                  <div className="h-10 w-10 animate-pulse rounded-lg bg-muted" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardHeader className="pb-4">
            <div className="h-5 w-64 animate-pulse rounded bg-muted" />
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-muted" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Overview of your opportunity pipeline
          </p>
        </div>
        <Card>
          <CardContent className="p-6 text-center text-sm text-destructive">
            {error}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Overview of your opportunity pipeline
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {STAT_CONFIG.map((stat) => (
          <Card key={stat.key}>
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    {stat.label}
                  </p>
                  <p className="mt-2 text-3xl font-bold tracking-tight">
                    {stats[stat.key].toLocaleString()}
                  </p>
                </div>
                <div className={`rounded-lg p-2.5 ${stat.color}`}>
                  <stat.icon className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent opportunities */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-4">
          <CardTitle className="text-lg font-semibold">
            Recent High-Relevance Opportunities
          </CardTitle>
          <Link
            href="/dashboard/opportunities"
            className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            View all <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="pb-3 pr-4">Opportunity</th>
                  <th className="pb-3 pr-4">Organization</th>
                  <th className="pb-3 pr-4">Status</th>
                  <th className="pb-3 pr-4">Closing</th>
                  <th className="pb-3 pr-4">Relevance</th>
                  <th className="pb-3 pr-4">Source</th>
                  <th className="pb-3" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {stats.recentOpportunities.map((opp) => (
                  <tr key={opp.id} className="hover:bg-muted/50 transition-colors">
                    <td className="py-3 pr-4 font-medium max-w-xs">
                      <span className="line-clamp-1">{opp.title}</span>
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">
                      {opp.organization}
                    </td>
                    <td className="py-3 pr-4">
                      <Badge variant={statusVariant[opp.status] ?? "outline"}>
                        {opp.status}
                      </Badge>
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground whitespace-nowrap">
                      {formatDate(opp.closingDate)}
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${getRelevanceColor(opp.relevanceScore)}`}
                      >
                        {opp.relevanceScore}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">
                      {opp.sourceName}
                    </td>
                    <td className="py-3">
                      <Link
                        href={`/dashboard/opportunities/${opp.id}`}
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        View <ExternalLink className="h-3 w-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
                {stats.recentOpportunities.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-muted-foreground">
                      No recent opportunities found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
