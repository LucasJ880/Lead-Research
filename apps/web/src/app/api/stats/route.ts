import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { DashboardStats, OpportunitySummary, OpportunityStatus, RelevanceBucket, WorkflowStatus } from "@/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const now = new Date();
    const oneWeekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const liveFilter = { ingestionMode: "live" } as const;
    const relevantBuckets = ["highly_relevant", "moderately_relevant"] as string[];
    const relevantFilter = { ...liveFilter, relevanceBucket: { in: relevantBuckets } };

    const [
      totalOpportunities,
      relevantOpportunities,
      closingThisWeek,
      highlyRelevant,
      moderatelyRelevant,
      lowRelevance,
      irrelevant,
      newLast24h,
      workflowCounts,
      topSourcesRaw,
      recentRows,
      // Source network stats
      totalSources,
      activeSources,
      priorityCountsRaw,
      healthCountsRaw,
      crawlRunsLast24h,
      sourceRunsTotal,
    ] = await Promise.all([
      prisma.opportunity.count({ where: liveFilter }),
      prisma.opportunity.count({ where: relevantFilter }),
      prisma.opportunity.count({
        where: { ...relevantFilter, status: "open", closingDate: { gte: now, lte: oneWeekFromNow } },
      }),
      prisma.opportunity.count({ where: { ...liveFilter, relevanceBucket: "highly_relevant" } }),
      prisma.opportunity.count({ where: { ...liveFilter, relevanceBucket: "moderately_relevant" } }),
      prisma.opportunity.count({ where: { ...liveFilter, relevanceBucket: "low_relevance" } }),
      prisma.opportunity.count({ where: { ...liveFilter, relevanceBucket: "irrelevant" } }),
      prisma.opportunity.count({ where: { ...liveFilter, createdAt: { gte: oneDayAgo } } }),
      prisma.opportunity.groupBy({ by: ["workflowStatus"], where: liveFilter, _count: true }),
      prisma.$queryRaw<{ source_name: string; total: bigint; relevant: bigint }[]>`
        SELECT s.name AS source_name,
               COUNT(o.id)::bigint AS total,
               COUNT(o.id) FILTER (WHERE o.relevance_bucket IN ('highly_relevant','moderately_relevant'))::bigint AS relevant
        FROM opportunities o
        JOIN sources s ON o.source_id = s.id
        WHERE o.ingestion_mode = 'live'
        GROUP BY s.name
        ORDER BY relevant DESC, total DESC
        LIMIT 10
      `,
      prisma.opportunity.findMany({
        where: relevantFilter,
        orderBy: [{ relevanceScore: "desc" }, { createdAt: "desc" }],
        take: 8,
        include: {
          source: { select: { name: true } },
          organization: { select: { name: true } },
        },
      }),
      // Source network stats
      prisma.source.count(),
      prisma.source.count({ where: { isActive: true } }),
      prisma.source.groupBy({ by: ["sourcePriority"], _count: true }),
      prisma.source.groupBy({ by: ["healthStatus"], _count: true }),
      prisma.sourceRun.count({ where: { createdAt: { gte: oneDayAgo } } }),
      prisma.sourceRun.count(),
    ]);

    // Intelligence stats — fetched separately with fallback for resilience
    let intelStats = { analyzedCount: 0, pursueCount: 0, reviewCount: 0, skipCount: 0, avgFeasibility: 0 };
    try {
      const [analyzed, pursue, review, skip, avgFeas] = await Promise.all([
        prisma.tenderIntelligence.count(),
        prisma.tenderIntelligence.count({ where: { recommendationStatus: { in: ["pursue", "strongly_pursue"] } } }),
        prisma.tenderIntelligence.count({ where: { recommendationStatus: "review_carefully" } }),
        prisma.tenderIntelligence.count({ where: { recommendationStatus: { in: ["skip", "low_probability"] } } }),
        prisma.tenderIntelligence.aggregate({ _avg: { feasibilityScore: true } }),
      ]);
      intelStats = {
        analyzedCount: analyzed,
        pursueCount: pursue,
        reviewCount: review,
        skipCount: skip,
        avgFeasibility: Math.round(avgFeas._avg.feasibilityScore ?? 0),
      };
    } catch {
      // tenderIntelligence table may not be recognized by the running Prisma client yet
      // Fall back to raw SQL
      try {
        const rawIntel = await prisma.$queryRaw<{ analyzed: bigint; pursue: bigint; review: bigint; skip: bigint; avg_feas: number | null }[]>`
          SELECT
            COUNT(*)::bigint AS analyzed,
            COUNT(*) FILTER (WHERE recommendation_status IN ('pursue', 'strongly_pursue'))::bigint AS pursue,
            COUNT(*) FILTER (WHERE recommendation_status = 'review_carefully')::bigint AS review,
            COUNT(*) FILTER (WHERE recommendation_status IN ('skip', 'low_probability'))::bigint AS skip,
            AVG(feasibility_score) AS avg_feas
          FROM tender_intelligence
        `;
        if (rawIntel[0]) {
          intelStats = {
            analyzedCount: Number(rawIntel[0].analyzed),
            pursueCount: Number(rawIntel[0].pursue),
            reviewCount: Number(rawIntel[0].review),
            skipCount: Number(rawIntel[0].skip),
            avgFeasibility: Math.round(rawIntel[0].avg_feas ?? 0),
          };
        }
      } catch {
        // Table doesn't exist yet — use defaults
      }
    }

    const workflowDistribution: Record<string, number> = {};
    for (const row of workflowCounts) {
      workflowDistribution[row.workflowStatus] = row._count;
    }

    const topSources = topSourcesRaw.map((r) => ({
      name: r.source_name,
      total: Number(r.total),
      relevant: Number(r.relevant),
    }));

    const priorityCounts: Record<string, number> = {};
    for (const row of priorityCountsRaw) {
      priorityCounts[row.sourcePriority] = row._count;
    }

    const healthCounts: Record<string, number> = {};
    for (const row of healthCountsRaw) {
      healthCounts[row.healthStatus] = row._count;
    }

    const recentOpportunities: OpportunitySummary[] = recentRows.map((opp) => ({
      id: opp.id,
      title: opp.title,
      status: opp.status as OpportunityStatus,
      workflowStatus: (opp.workflowStatus ?? "new") as WorkflowStatus,
      organization: opp.organization?.name ?? undefined,
      country: opp.country ?? undefined,
      region: opp.region ?? undefined,
      city: opp.city ?? undefined,
      category: opp.category ?? undefined,
      postedDate: opp.postedDate ? opp.postedDate.toISOString() : undefined,
      closingDate: opp.closingDate ? opp.closingDate.toISOString() : undefined,
      relevanceScore: Number(opp.relevanceScore),
      relevanceBucket: opp.relevanceBucket as RelevanceBucket,
      keywordsMatched: opp.keywordsMatched ?? [],
      industryTags: opp.industryTags ?? [],
      sourceUrl: opp.sourceUrl,
      sourceName: opp.source.name,
      estimatedValue: opp.estimatedValue ? Number(opp.estimatedValue) : undefined,
      currency: opp.currency ?? undefined,
    }));

    const stats: DashboardStats = {
      totalOpportunities,
      openOpportunities: relevantOpportunities,
      closingThisWeek,
      highRelevanceLeads: highlyRelevant,
      newLast24h,
      recentOpportunities,
      bucketDistribution: {
        highly_relevant: highlyRelevant,
        moderately_relevant: moderatelyRelevant,
        low_relevance: lowRelevance,
        irrelevant,
      },
      workflowDistribution: workflowDistribution as Record<WorkflowStatus, number>,
      topSources,
      sourceNetwork: {
        totalSources,
        activeSources,
        priorityCounts,
        healthCounts,
        crawlRunsLast24h,
        totalCrawlRuns: sourceRunsTotal,
      },
      intelligence: intelStats,
    };

    return NextResponse.json(stats);
  } catch (error) {
    console.error("GET /api/stats error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
