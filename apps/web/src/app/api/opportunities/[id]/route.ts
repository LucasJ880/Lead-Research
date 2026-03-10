import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import type { OpportunityDetail, OpportunityStatus, RelevanceBucket, WorkflowStatus } from "@/types";

const VALID_WORKFLOW: WorkflowStatus[] = [
  "new", "hot", "review", "shortlisted", "pursuing", "passed", "not_relevant", "monitor",
];

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  try {
    const { id } = params;

    const opp = await prisma.opportunity.findUnique({
      where: { id },
      include: {
        source: { select: { name: true } },
        organization: { select: { name: true } },
        documents: {
          select: {
            id: true,
            title: true,
            url: true,
            fileType: true,
            fileSizeBytes: true,
          },
        },
        notes: {
          include: { user: { select: { name: true } } },
          orderBy: { createdAt: "desc" },
        },
        tags: {
          include: { tag: { select: { name: true } } },
        },
      },
    });

    if (!opp) {
      return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
    }

    const detail: OpportunityDetail = {
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
      relevanceBucket: opp.relevanceBucket as RelevanceBucket,
      workflowStatus: opp.workflowStatus as WorkflowStatus,
      keywordsMatched: opp.keywordsMatched ?? [],
      negativeKeywords: opp.negativeKeywords ?? [],
      industryTags: opp.industryTags ?? [],
      sourceUrl: opp.sourceUrl,
      sourceName: opp.source.name,
      estimatedValue: opp.estimatedValue ? Number(opp.estimatedValue) : undefined,
      currency: opp.currency ?? undefined,
      externalId: opp.externalId ?? undefined,
      descriptionSummary: opp.descriptionSummary ?? undefined,
      descriptionFull: opp.descriptionFull ?? undefined,
      locationRaw: opp.locationRaw ?? undefined,
      projectType: opp.projectType ?? undefined,
      solicitationNumber: opp.solicitationNumber ?? undefined,
      contactName: opp.contactName ?? undefined,
      contactEmail: opp.contactEmail ?? undefined,
      contactPhone: opp.contactPhone ?? undefined,
      hasDocuments: opp.hasDocuments,
      mandatorySiteVisit: opp.mandatorySiteVisit ?? undefined,
      preBidMeeting: opp.preBidMeeting ?? undefined,
      addendaCount: opp.addendaCount,
      relevanceBreakdown: opp.relevanceBreakdown as Record<string, unknown>,
      businessFitExplanation: opp.businessFitExplanation ?? undefined,
      workflowNote: opp.workflowNote ?? undefined,
      workflowUpdatedAt: opp.workflowUpdatedAt ? opp.workflowUpdatedAt.toISOString() : undefined,
      documents: opp.documents.map((doc) => ({
        id: doc.id,
        title: doc.title ?? undefined,
        url: doc.url,
        fileType: doc.fileType ?? undefined,
        fileSizeBytes: doc.fileSizeBytes ?? undefined,
      })),
      notes: opp.notes.map((note) => ({
        id: note.id,
        content: note.content,
        userName: note.user.name,
        createdAt: note.createdAt.toISOString(),
        updatedAt: note.updatedAt.toISOString(),
      })),
      tags: opp.tags.map((t) => t.tag.name),
    };

    return NextResponse.json(detail);
  } catch (error) {
    console.error("GET /api/opportunities/[id] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  try {
    const { id } = params;
    const body = await request.json();
    const { workflowStatus, workflowNote } = body as {
      workflowStatus?: string;
      workflowNote?: string;
    };

    if (workflowStatus && !VALID_WORKFLOW.includes(workflowStatus as WorkflowStatus)) {
      return NextResponse.json(
        { error: `Invalid workflow status. Valid: ${VALID_WORKFLOW.join(", ")}` },
        { status: 400 }
      );
    }

    const data: Record<string, unknown> = { workflowUpdatedAt: new Date() };
    if (workflowStatus) data.workflowStatus = workflowStatus;
    if (workflowNote !== undefined) data.workflowNote = workflowNote;

    const updated = await prisma.opportunity.update({
      where: { id },
      data,
      select: { id: true, workflowStatus: true, workflowNote: true, workflowUpdatedAt: true },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("PATCH /api/opportunities/[id] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
