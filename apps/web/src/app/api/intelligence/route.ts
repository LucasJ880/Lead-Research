import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const filter = searchParams.get("filter") || "all"; // all | pursue | review | skip
    const page = Math.max(1, Number(searchParams.get("page") || 1));
    const pageSize = Math.min(50, Math.max(1, Number(searchParams.get("pageSize") || 20)));
    const offset = (page - 1) * pageSize;

    let recFilter = "";
    if (filter === "pursue") {
      recFilter = "AND ti.recommendation_status IN ('strongly_pursue', 'pursue')";
    } else if (filter === "review") {
      recFilter = "AND ti.recommendation_status IN ('review_carefully', 'low_probability')";
    } else if (filter === "skip") {
      recFilter = "AND ti.recommendation_status = 'skip'";
    }

    const countRows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*) as count FROM tender_intelligence ti
       JOIN opportunities o ON o.id = ti.opportunity_id
       WHERE 1=1 ${recFilter}`
    );
    const total = Number(countRows[0]?.count ?? 0);

    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT
         ti.id as intel_id,
         ti.opportunity_id,
         ti.feasibility_score,
         ti.recommendation_status,
         ti.project_overview,
         ti.scope_of_work,
         ti.scope_type,
         ti.business_fit_explanation,
         ti.analysis_model,
         ti.analyzed_at,
         ti.intelligence_summary,
         o.title,
         o.relevance_score,
         o.relevance_bucket,
         o.keywords_matched,
         o.industry_tags,
         o.closing_date,
         o.source_url,
         o.status,
         s.name as source_name,
         org.name as organization,
         (SELECT COUNT(*) FROM opportunity_documents od WHERE od.opportunity_id = o.id) as doc_count
       FROM tender_intelligence ti
       JOIN opportunities o ON o.id = ti.opportunity_id
       LEFT JOIN sources s ON o.source_id = s.id
       LEFT JOIN organizations org ON o.organization_id = org.id
       WHERE 1=1 ${recFilter}
       ORDER BY ti.feasibility_score DESC NULLS LAST, o.relevance_score DESC
       LIMIT ${pageSize} OFFSET ${offset}`
    );

    const items = rows.map((r) => {
      let summary = r.intelligence_summary;
      if (typeof summary === "string") {
        try { summary = JSON.parse(summary); } catch { /* keep */ }
      }

      return {
        id: r.opportunity_id,
        intelId: r.intel_id,
        title: r.title,
        organization: r.organization || null,
        sourceName: r.source_name || "Unknown",
        sourceUrl: r.source_url,
        status: r.status,
        relevanceScore: r.relevance_score,
        relevanceBucket: r.relevance_bucket,
        keywordsMatched: r.keywords_matched ?? [],
        industryTags: r.industry_tags ?? [],
        closingDate: r.closing_date,
        feasibilityScore: r.feasibility_score,
        recommendationStatus: r.recommendation_status,
        projectOverview: r.project_overview,
        scopeType: r.scope_type,
        businessFitExplanation: r.business_fit_explanation,
        analysisModel: r.analysis_model,
        analyzedAt: r.analyzed_at,
        docCount: Number(r.doc_count ?? 0),
        chinaViable: (summary as Record<string, Record<string, unknown>>)?.china_sourcing_analysis?.viable ?? null,
      };
    });

    return NextResponse.json({
      data: items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error) {
    console.error("GET /api/intelligence error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
