import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { SourceItem, SourceType, CrawlFrequency, RunStatus } from "@/types";

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
  try {
    const sources = await prisma.source.findMany({
      orderBy: { name: "asc" },
    });

    const data: SourceItem[] = sources.map((s) => ({
      id: s.id,
      name: s.name,
      sourceType: s.sourceType as SourceType,
      baseUrl: s.baseUrl,
      country: s.country,
      region: s.region ?? undefined,
      frequency: s.frequency as CrawlFrequency,
      isActive: s.isActive,
      lastCrawledAt: s.lastCrawledAt ? s.lastCrawledAt.toISOString() : undefined,
      lastRunStatus: s.lastRunStatus ? (s.lastRunStatus as RunStatus) : undefined,
      categoryTags: s.categoryTags,
    }));

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
      country: source.country,
      region: source.region ?? undefined,
      frequency: source.frequency as CrawlFrequency,
      isActive: source.isActive,
      lastCrawledAt: source.lastCrawledAt ? source.lastCrawledAt.toISOString() : undefined,
      lastRunStatus: source.lastRunStatus ? (source.lastRunStatus as RunStatus) : undefined,
      categoryTags: source.categoryTags,
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
