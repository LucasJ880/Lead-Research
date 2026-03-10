import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  try {
    const { id } = params;

    const opportunity = await prisma.opportunity.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        descriptionFull: true,
        descriptionSummary: true,
        relevanceScore: true,
        relevanceBucket: true,
        keywordsMatched: true,
        industryTags: true,
        businessFitExplanation: true,
        sourceUrl: true,
        closingDate: true,
        source: { select: { name: true } },
      },
    });

    if (!opportunity) {
      return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
    }

    let intelligence: Record<string, unknown> | null = null;
    try {
      intelligence = await prisma.tenderIntelligence.findUnique({
        where: { opportunityId: id },
      });
    } catch {
      // Prisma client may not know the model yet; try raw SQL
      try {
        const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
          SELECT * FROM tender_intelligence WHERE opportunity_id = ${id}::uuid LIMIT 1
        `;
        if (rows[0]) {
          intelligence = {
            ...rows[0],
            // Map snake_case → camelCase
            projectOverview: rows[0].project_overview,
            scopeOfWork: rows[0].scope_of_work,
            scopeType: rows[0].scope_type,
            technicalRequirements: rows[0].technical_requirements,
            qualificationReqs: rows[0].qualification_reqs,
            criticalDates: rows[0].critical_dates,
            riskFactors: rows[0].risk_factors,
            feasibilityScore: rows[0].feasibility_score,
            recommendationStatus: rows[0].recommendation_status,
            businessFitExplanation: rows[0].business_fit_explanation,
            chinaSourceAnalysis: rows[0].china_source_analysis,
            intelligenceSummary: rows[0].intelligence_summary,
            analysisModel: rows[0].analysis_model,
            analyzedAt: rows[0].analyzed_at,
          };
        }
      } catch {
        // Table doesn't exist yet
      }
    }

    // Parse JSON fields if stored as strings
    if (intelligence) {
      for (const key of ["technicalRequirements", "qualificationReqs", "criticalDates", "riskFactors", "intelligenceSummary"]) {
        if (typeof intelligence[key] === "string") {
          try { intelligence[key] = JSON.parse(intelligence[key]); } catch { /* keep as-is */ }
        }
      }
      if (typeof intelligence.chinaSourceAnalysis === "string") {
        try { intelligence.chinaSourceAnalysis = JSON.parse(intelligence.chinaSourceAnalysis); } catch { /* keep as-is */ }
      }
    }

    let documents: Record<string, unknown>[] = [];
    try {
      documents = await prisma.opportunityDocument.findMany({
        where: { opportunityId: id },
        orderBy: { createdAt: "desc" },
      });
      documents = documents.map((d: Record<string, unknown>) => ({
        id: d.id,
        title: d.title,
        url: d.url,
        fileType: d.fileType,
        fileSizeBytes: d.fileSizeBytes,
        pageCount: d.pageCount ?? null,
        downloadedAt: d.downloadedAt ?? null,
        docCategory: d.docCategory ?? null,
        textExtracted: d.textExtracted ?? false,
      }));
    } catch {
      const rawDocs = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT id, title, url, file_type, file_size_bytes, page_count,
               downloaded_at, doc_category, text_extracted
        FROM opportunity_documents
        WHERE opportunity_id = ${id}::uuid
        ORDER BY created_at DESC
      `;
      documents = rawDocs.map((d) => ({
        id: d.id,
        title: d.title,
        url: d.url,
        fileType: d.file_type,
        fileSizeBytes: d.file_size_bytes ? Number(d.file_size_bytes) : null,
        pageCount: d.page_count ? Number(d.page_count) : null,
        downloadedAt: d.downloaded_at,
        docCategory: d.doc_category,
        textExtracted: d.text_extracted ?? false,
      }));
    }

    return NextResponse.json({ opportunity, intelligence, documents });
  } catch (error) {
    console.error("GET /api/intelligence/[id] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
