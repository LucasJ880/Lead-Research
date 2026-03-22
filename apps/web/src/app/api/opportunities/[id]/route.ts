import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import type { OpportunityDetail, OpportunityStatus, QingyanSyncInfo, RelevanceBucket, WorkflowStatus } from "@/types";

const VALID_WORKFLOW: WorkflowStatus[] = [
  "new", "hot", "review", "shortlisted", "pursuing", "passed", "not_relevant", "monitor",
  "bid_submitted", "won", "lost", "rfq_sent", "bid_drafted",
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
        qingyanSync: true,
      },
    });

    if (!opp) {
      return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
    }

    // Extract enriched fields from rawData
    const raw = (opp.rawData as Record<string, unknown>) ?? {};
    const responseDeadline = raw.response_deadline as string | undefined;
    const officeAddressFull = raw.office_address_full as string | undefined;
    const placeOfPerformance = raw.place_of_performance as string | undefined;
    const department = raw.department as string | undefined;
    const subTier = raw.sub_tier as string | undefined;
    const office = raw.office as string | undefined;
    const setAside = raw.set_aside as string | undefined;
    const allContacts = raw.all_contacts as Array<Record<string, string>> | undefined;
    const naicsName = raw.naics_name as string | undefined;
    const classificationName = raw.classification_name as string | undefined;

    const detail: OpportunityDetail = {
      id: opp.id,
      title: (opp as any).titleZh || opp.title,
      titleZh: (opp as any).titleZh ?? undefined,
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
      descriptionSummary: (opp as any).descriptionSummaryZh || opp.descriptionSummary ?? undefined,
      descriptionSummaryZh: (opp as any).descriptionSummaryZh ?? undefined,
      descriptionFull: (opp as any).descriptionFullZh || opp.descriptionFull ?? undefined,
      descriptionFullZh: (opp as any).descriptionFullZh ?? undefined,
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
      responseDeadline: responseDeadline ?? undefined,
      officeAddress: officeAddressFull ?? undefined,
      placeOfPerformance: placeOfPerformance ?? undefined,
      department: department ?? undefined,
      subTier: subTier ?? undefined,
      office: office ?? undefined,
      setAside: setAside ?? undefined,
      naicsName: naicsName ?? undefined,
      classificationName: classificationName ?? undefined,
      allContacts: allContacts?.length ? allContacts : undefined,
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
      qingyanSync: opp.qingyanSync
        ? {
            id: opp.qingyanSync.id,
            syncStatus: opp.qingyanSync.syncStatus as QingyanSyncInfo["syncStatus"],
            qingyanProjectId: opp.qingyanSync.qingyanProjectId ?? undefined,
            qingyanTaskId: opp.qingyanSync.qingyanTaskId ?? undefined,
            qingyanUrl: opp.qingyanSync.qingyanUrl ?? undefined,
            qingyanStatus: opp.qingyanSync.qingyanStatus ?? undefined,
            pushedBy: opp.qingyanSync.pushedBy ?? undefined,
            pushedAt: opp.qingyanSync.pushedAt?.toISOString(),
            lastSyncAt: opp.qingyanSync.lastSyncAt?.toISOString(),
            errorMessage: opp.qingyanSync.errorMessage ?? undefined,
            retryCount: opp.qingyanSync.retryCount,
          }
        : undefined,
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
