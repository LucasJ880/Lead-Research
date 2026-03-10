import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import type { SourceItem, SourceType, CrawlFrequency, RunStatus, SourcePriority, SourceHealthStatus } from "@/types";

const createSourceSchema = z.object({
  name: z.string().min(1).max(255),
  sourceType: z.enum([
    "bid_portal",
    "municipal",
    "school_board",
    "housing_authority",
    "university",
    "hospital",
    "construction",
    "aggregator",
    "other",
  ]),
  baseUrl: z.string().url(),
  country: z.string().length(2),
  region: z.string().max(100).optional(),
  frequency: z.enum(["hourly", "daily", "weekly", "manual"]).default("daily"),
  categoryTags: z.array(z.string()).default([]),
});

export async function GET() {
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  try {
    const sources = await prisma.source.findMany({
      orderBy: [
        { sourcePriority: "asc" },
        { industryFitScore: "desc" },
        { name: "asc" },
      ],
    });

    const data: SourceItem[] = sources.map((s) => {
      const total = s.totalOpportunities;
      const relevant = s.relevantOpportunities;
      return {
        id: s.id,
        name: s.name,
        sourceType: s.sourceType as SourceType,
        baseUrl: s.baseUrl,
        listingPath: s.listingPath ?? undefined,
        country: s.country,
        region: s.region ?? undefined,
        frequency: s.frequency as CrawlFrequency,
        isActive: s.isActive,
        lastCrawledAt: s.lastCrawledAt ? s.lastCrawledAt.toISOString() : undefined,
        lastRunStatus: s.lastRunStatus ? (s.lastRunStatus as RunStatus) : undefined,
        categoryTags: s.categoryTags,
        industryFitScore: s.industryFitScore,
        sourcePriority: s.sourcePriority as SourcePriority,
        healthStatus: s.healthStatus as SourceHealthStatus,
        totalOpportunities: total,
        relevantOpportunities: relevant,
        highlyRelevantCount: s.highlyRelevantCount,
        sourceYieldPct: total > 0 ? Math.round((relevant / total) * 100) : 0,
        totalCrawlRuns: s.totalCrawlRuns,
        successfulCrawlRuns: s.successfulCrawlRuns,
        failedCrawlRuns: s.failedCrawlRuns,
        avgCrawlDurationMs: s.avgCrawlDurationMs,
        yieldAnalyticsUpdatedAt: s.yieldAnalyticsUpdatedAt?.toISOString(),
        lastCrawlSuccess: s.lastRunStatus === "completed",
      };
    });

    return NextResponse.json(data);
  } catch (error) {
    console.error("GET /api/sources error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  try {
    const body = await request.json();
    const parsed = createSourceSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const source = await prisma.source.create({
      data: {
        name: parsed.data.name,
        sourceType: parsed.data.sourceType,
        baseUrl: parsed.data.baseUrl,
        country: parsed.data.country,
        region: parsed.data.region,
        frequency: parsed.data.frequency,
        categoryTags: parsed.data.categoryTags,
      },
    });

    const result: SourceItem = {
      id: source.id,
      name: source.name,
      sourceType: source.sourceType as SourceType,
      baseUrl: source.baseUrl,
      listingPath: source.listingPath ?? undefined,
      country: source.country,
      region: source.region ?? undefined,
      frequency: source.frequency as CrawlFrequency,
      isActive: source.isActive,
      lastCrawledAt: source.lastCrawledAt ? source.lastCrawledAt.toISOString() : undefined,
      lastRunStatus: source.lastRunStatus ? (source.lastRunStatus as RunStatus) : undefined,
      categoryTags: source.categoryTags,
      industryFitScore: source.industryFitScore,
      sourcePriority: source.sourcePriority as SourcePriority,
      healthStatus: source.healthStatus as SourceHealthStatus,
      totalOpportunities: 0,
      relevantOpportunities: 0,
      highlyRelevantCount: 0,
      sourceYieldPct: 0,
      totalCrawlRuns: 0,
      successfulCrawlRuns: 0,
      failedCrawlRuns: 0,
      avgCrawlDurationMs: 0,
      lastCrawlSuccess: false,
    };

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error("POST /api/sources error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
