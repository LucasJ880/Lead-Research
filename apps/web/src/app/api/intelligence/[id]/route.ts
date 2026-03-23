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
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT id, opportunity_id, intelligence_summary, analysis_model,
               analysis_mode, analysis_status, analyzed_at
        FROM tender_intelligence WHERE opportunity_id = ${id}::uuid LIMIT 1
      `;
      if (rows[0]) {
        let summary = rows[0].intelligence_summary;
        if (typeof summary === "string") {
          try { summary = JSON.parse(summary); } catch { /* keep as-is */ }
        }

        // Only return v4 Markdown reports, discard old v3 JSON
        const isV4 = typeof summary === "object" && summary !== null && (summary as any).report_markdown;
        intelligence = isV4 ? {
          id: rows[0].id,
          opportunityId: rows[0].opportunity_id,
          intelligenceSummary: summary,
          analysisModel: rows[0].analysis_model,
          analysisMode: rows[0].analysis_mode,
          analysisStatus: rows[0].analysis_status,
          analyzedAt: rows[0].analyzed_at,
        } : null;
      }
    } catch {
      // Table doesn't exist yet
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
        extractedTextPreview: d.textExtracted && d.extractedText
          ? (d.extractedText as string).slice(0, 800)
          : null,
        extractedTextLength: d.textExtracted && d.extractedText
          ? (d.extractedText as string).length
          : null,
      }));
    } catch {
      const rawDocs = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT id, title, url, file_type, file_size_bytes, page_count,
               downloaded_at, doc_category, text_extracted,
               LEFT(extracted_text, 800) as text_preview,
               LENGTH(extracted_text) as text_length
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
        extractedTextPreview: d.text_preview ?? null,
        extractedTextLength: d.text_length ? Number(d.text_length) : null,
      }));
    }

    return NextResponse.json({ opportunity, intelligence, documents });
  } catch (error) {
    console.error("GET /api/intelligence/[id] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
