import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { DashboardStats, OpportunitySummary, OpportunityStatus } from "@/types";

export async function GET() {
  try {
    const now = new Date();
    const oneWeekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [
      totalOpportunities,
      openOpportunities,
      closingThisWeek,
      highRelevanceLeads,
      recentRows,
    ] = await Promise.all([
      prisma.opportunity.count(),
      prisma.opportunity.count({ where: { status: "open" } }),
      prisma.opportunity.count({
        where: {
          status: "open",
          closingDate: { gte: now, lte: oneWeekFromNow },
        },
      }),
      prisma.opportunity.count({
        where: { relevanceScore: { gte: 70 } },
      }),
      prisma.opportunity.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        include: {
          source: { select: { name: true } },
          organization: { select: { name: true } },
        },
      }),
    ]);

    const recentOpportunities: OpportunitySummary[] = recentRows.map((opp) => ({
      id: opp.id,
      title: opp.title,
      status: opp.status as OpportunityStatus,
      organization: opp.organization?.name ?? undefined,
      country: opp.country ?? undefined,
      region: opp.region ?? undefined,
      city: opp.city ?? undefined,
      category: opp.category ?? undefined,
      postedDate: opp.postedDate ? opp.postedDate.toISOString() : undefined,
      closingDate: opp.closingDate ? opp.closingDate.toISOString() : undefined,
      relevanceScore: Number(opp.relevanceScore),
      sourceUrl: opp.sourceUrl,
      sourceName: opp.source.name,
      estimatedValue: opp.estimatedValue ? Number(opp.estimatedValue) : undefined,
      currency: opp.currency ?? undefined,
    }));

    const stats: DashboardStats = {
      totalOpportunities,
      openOpportunities,
      closingThisWeek,
      highRelevanceLeads,
      recentOpportunities,
    };

    return NextResponse.json(stats);
  } catch (error) {
    console.error("GET /api/stats error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
