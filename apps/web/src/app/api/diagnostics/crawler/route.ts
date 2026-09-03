import { NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

// Vercel: allow up to 60s for this route (proxies to the scraper / heavy queries)
export const maxDuration = 60;

export const dynamic = "force-dynamic";

export async function GET() {
  const { error: authError } = await requireRole(["owner", "super_admin", "admin", "manager"]);
  if (authError) return authError;

  const scraperUrl = process.env.SCRAPER_API_URL || "http://localhost:8001";
  const apiKey = process.env.SCRAPER_API_KEY || "";

  const diagnostics: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
  };

  // Scraper connectivity
  try {
    const res = await fetch(`${scraperUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    diagnostics.scraperStatus = res.ok ? "reachable" : `HTTP ${res.status}`;
  } catch (e) {
    diagnostics.scraperStatus = `unreachable: ${e instanceof Error ? e.message : "unknown"}`;
  }

  // Scraper diagnostics (protected)
  try {
    const res = await fetch(`${scraperUrl}/api/diagnostics`, {
      headers: { "X-API-Key": apiKey },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      diagnostics.scraperConfig = await res.json();
    }
  } catch {
    diagnostics.scraperConfig = "unavailable";
  }

  // Source stats
  const [totalSources, activeSources] = await Promise.all([
    prisma.source.count(),
    prisma.source.count({ where: { isActive: true } }),
  ]);
  diagnostics.sources = { total: totalSources, active: activeSources };

  // Recent runs
  const recentRuns = await prisma.sourceRun.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { source: { select: { name: true } } },
  });

  diagnostics.recentRuns = recentRuns.map((r) => ({
    id: r.id,
    source: r.source.name,
    status: r.status,
    startedAt: r.startedAt?.toISOString(),
    completedAt: r.completedAt?.toISOString(),
    found: r.opportunitiesFound,
    created: r.opportunitiesCreated,
    error: r.errorMessage?.slice(0, 200),
    triggeredBy: r.triggeredBy,
  }));

  // Opportunity counts
  const [totalOpps, relevantOpps] = await Promise.all([
    prisma.opportunity.count({ where: { ingestionMode: "live" } }),
    prisma.opportunity.count({
      where: {
        ingestionMode: "live",
        relevanceBucket: { in: ["highly_relevant", "moderately_relevant"] },
      },
    }),
  ]);
  diagnostics.opportunities = { total: totalOpps, relevant: relevantOpps };

  // Environment check
  diagnostics.environment = {
    scraper_api_url: scraperUrl,
    scraper_api_key_set: !!apiKey,
    database_url_set: !!process.env.DATABASE_URL,
    nextauth_url: process.env.NEXTAUTH_URL,
    node_env: process.env.NODE_ENV,
  };

  return NextResponse.json(diagnostics);
}
