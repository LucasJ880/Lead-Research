import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import type { CrawlLogEntry, RunStatus, PaginatedResponse } from "@/types";

export async function GET(request: NextRequest) {
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = request.nextUrl;

    const sourceId = searchParams.get("sourceId");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10)));
    const offset = (page - 1) * pageSize;

    const where = sourceId ? { sourceId } : {};

    const [total, runs] = await Promise.all([
      prisma.sourceRun.count({ where }),
      prisma.sourceRun.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: pageSize,
        include: {
          source: { select: { name: true } },
        },
      }),
    ]);

    const data: CrawlLogEntry[] = runs.map((run) => ({
      id: run.id,
      sourceName: run.source.name,
      sourceId: run.sourceId,
      status: run.status as RunStatus,
      startedAt: run.startedAt ? run.startedAt.toISOString() : undefined,
      completedAt: run.completedAt ? run.completedAt.toISOString() : undefined,
      durationMs: run.durationMs ?? undefined,
      pagesCrawled: run.pagesCrawled,
      opportunitiesFound: run.opportunitiesFound,
      opportunitiesCreated: run.opportunitiesCreated,
      opportunitiesUpdated: run.opportunitiesUpdated,
      errorMessage: run.errorMessage ?? undefined,
      triggeredBy: run.triggeredBy,
      createdAt: run.createdAt.toISOString(),
    }));

    const response: PaginatedResponse<CrawlLogEntry> = {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("GET /api/source-runs error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
