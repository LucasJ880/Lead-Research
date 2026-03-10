import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import type { Source } from "@prisma/client";
import type { SourceItem, SourceType, CrawlFrequency, RunStatus, SourcePriority, SourceHealthStatus } from "@/types";

function mapSource(s: Source): SourceItem {
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
}

const updateSourceSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  sourceType: z
    .enum([
      "bid_portal",
      "municipal",
      "school_board",
      "housing_authority",
      "university",
      "hospital",
      "construction",
      "aggregator",
      "other",
    ])
    .optional(),
  baseUrl: z.string().url().optional(),
  country: z.string().length(2).optional(),
  region: z.string().max(100).nullable().optional(),
  frequency: z.enum(["hourly", "daily", "weekly", "manual"]).optional(),
  isActive: z.boolean().optional(),
  categoryTags: z.array(z.string()).optional(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  try {
    const source = await prisma.source.findUnique({
      where: { id: params.id },
    });

    if (!source) {
      return NextResponse.json(
        { error: "Source not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(mapSource(source));
  } catch (error) {
    console.error("GET /api/sources/[id] error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  try {
    const existing = await prisma.source.findUnique({
      where: { id: params.id },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Source not found" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const parsed = updateSourceSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const source = await prisma.source.update({
      where: { id: params.id },
      data: parsed.data,
    });

    return NextResponse.json(mapSource(source));
  } catch (error) {
    console.error("PATCH /api/sources/[id] error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  try {
    const existing = await prisma.source.findUnique({
      where: { id: params.id },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Source not found" },
        { status: 404 }
      );
    }

    await prisma.source.delete({ where: { id: params.id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/sources/[id] error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
