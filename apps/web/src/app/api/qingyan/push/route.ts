import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import {
  createQingyanProject,
  isQingyanEnabled,
  mapFeasibilityToRiskLevel,
  QingyanApiError,
  type QingyanProjectPayload,
} from "@/lib/qingyan-client";

export async function POST(request: NextRequest) {
  const { session, error: authError } = await requireAuth();
  if (authError) return authError;

  if (!isQingyanEnabled()) {
    return NextResponse.json(
      { error: "Qingyan integration is not enabled" },
      { status: 503 }
    );
  }

  try {
    const body = await request.json();
    const { opportunityId, options } = body as {
      opportunityId: string;
      options?: {
        createAs?: "project" | "task";
        priority?: "high" | "medium" | "low";
        assignTo?: string;
        notes?: string;
      };
    };

    if (!opportunityId) {
      return NextResponse.json({ error: "opportunityId is required" }, { status: 400 });
    }

    const existing = await prisma.qingyanSync.findUnique({
      where: { opportunityId },
    });

    if (existing && existing.syncStatus === "synced") {
      return NextResponse.json(
        {
          error: "This opportunity has already been pushed to Qingyan",
          syncId: existing.id,
          qingyanProjectId: existing.qingyanProjectId,
          qingyanUrl: existing.qingyanUrl,
        },
        { status: 409 }
      );
    }

    const opp = await prisma.opportunity.findUnique({
      where: { id: opportunityId },
      include: {
        source: { select: { name: true } },
        organization: { select: { name: true } },
        documents: { select: { title: true, url: true, fileType: true } },
        intelligence: {
          select: {
            feasibilityScore: true,
            recommendationStatus: true,
            intelligenceSummary: true,
            projectOverview: true,
          },
        },
      },
    });

    if (!opp) {
      return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
    }

    const userId = (session as { user?: { id?: string } })?.user?.id;

    const syncRecord = existing
      ? await prisma.qingyanSync.update({
          where: { id: existing.id },
          data: {
            syncStatus: "pushing",
            errorMessage: null,
            retryCount: { increment: 1 },
          },
        })
      : await prisma.qingyanSync.create({
          data: {
            opportunityId,
            syncStatus: "pushing",
            pushedBy: userId || null,
            pushedAt: new Date(),
          },
        });

    const intel = opp.intelligence;
    const report = (intel?.intelligenceSummary as Record<string, unknown>) ?? {};
    const verdict = (report.verdict as Record<string, unknown>) ?? {};
    const projSummary = (report.project_summary as Record<string, unknown>) ?? {};

    const locationParts = [opp.city, opp.region, opp.country].filter(Boolean);

    const payload: QingyanProjectPayload = {
      external_ref: {
        system: "bidtogo",
        id: opp.id,
        url: `${process.env.NEXTAUTH_URL || "https://bidtogo.ca"}/dashboard/opportunities/${opp.id}`,
      },
      project: {
        name: `[Tender] ${opp.title}`,
        description: buildDescription(opp, intel, verdict, projSummary),
        category: "tender_opportunity",
        priority: options?.priority || "medium",
        deadline: opp.closingDate ? opp.closingDate.toISOString() : null,
        source_platform: opp.source.name,
        client_organization: opp.organization?.name || null,
        location: locationParts.length > 0 ? locationParts.join(", ") : null,
        estimated_value: opp.estimatedValue ? Number(opp.estimatedValue) : null,
        currency: opp.currency,
        solicitation_number: opp.solicitationNumber || null,
      },
      intelligence: {
        recommendation: intel?.recommendationStatus || null,
        risk_level: mapFeasibilityToRiskLevel(intel?.feasibilityScore),
        fit_score: intel?.feasibilityScore || null,
        summary: (verdict.one_line as string) || intel?.projectOverview || null,
        full_report_url: `${process.env.NEXTAUTH_URL || "https://bidtogo.ca"}/dashboard/opportunities/${opp.id}#analysis`,
      },
      documents: opp.documents.map((doc) => ({
        title: doc.title || "Untitled",
        url: doc.url,
        file_type: doc.fileType || null,
      })),
      metadata: {
        bidtogo_workflow_status: opp.workflowStatus,
        relevance_score: opp.relevanceScore,
        relevance_bucket: opp.relevanceBucket,
        keywords_matched: opp.keywordsMatched,
        pushed_by: session?.user?.email || "unknown",
        pushed_at: new Date().toISOString(),
      },
      workflow_template: "tender_review",
    };

    try {
      const result = await createQingyanProject(payload);

      await prisma.qingyanSync.update({
        where: { id: syncRecord.id },
        data: {
          syncStatus: "synced",
          qingyanProjectId: result.project_id,
          qingyanUrl: result.project_url,
          qingyanStatus: "new",
          pushedAt: new Date(),
          lastSyncAt: new Date(),
          payloadSnapshot: JSON.parse(JSON.stringify(payload)),
          metadata: JSON.parse(JSON.stringify({
            tasksCreated: result.tasks_created || [],
            createAs: options?.createAs || "project",
            assignTo: options?.assignTo,
            userNotes: options?.notes,
          })),
        },
      });

      await prisma.auditLog.create({
        data: {
          userId: userId || null,
          action: "qingyan_push",
          entityType: "opportunity",
          entityId: opp.id,
          metadata: {
            qingyanProjectId: result.project_id,
            syncId: syncRecord.id,
          },
        },
      });

      return NextResponse.json({
        syncId: syncRecord.id,
        status: "synced",
        qingyanProjectId: result.project_id,
        qingyanUrl: result.project_url,
        pushedAt: new Date().toISOString(),
      });
    } catch (apiErr) {
      const errMsg =
        apiErr instanceof QingyanApiError ? apiErr.message : "Unknown push error";
      const retryable =
        apiErr instanceof QingyanApiError
          ? apiErr.status >= 500 || apiErr.status === 408 || apiErr.status === 0
          : true;

      if (
        apiErr instanceof QingyanApiError &&
        apiErr.code === "DUPLICATE_EXTERNAL_REF"
      ) {
        await prisma.qingyanSync.update({
          where: { id: syncRecord.id },
          data: {
            syncStatus: "synced",
            qingyanProjectId: apiErr.existingProjectId || null,
            qingyanUrl: apiErr.existingProjectUrl || null,
            lastSyncAt: new Date(),
          },
        });

        return NextResponse.json({
          syncId: syncRecord.id,
          status: "synced",
          qingyanProjectId: apiErr.existingProjectId,
          qingyanUrl: apiErr.existingProjectUrl,
          pushedAt: new Date().toISOString(),
          note: "Already existed in Qingyan — linked successfully",
        });
      }

      await prisma.qingyanSync.update({
        where: { id: syncRecord.id },
        data: {
          syncStatus: "failed",
          errorMessage: errMsg,
        },
      });

      return NextResponse.json(
        {
          syncId: syncRecord.id,
          status: "failed",
          error: errMsg,
          retryable,
        },
        { status: 502 }
      );
    }
  } catch (error) {
    console.error("POST /api/qingyan/push error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function buildDescription(
  opp: { title: string; descriptionSummary: string | null },
  intel: { projectOverview: string | null } | null,
  verdict: Record<string, unknown>,
  projSummary: Record<string, unknown>
): string {
  const parts: string[] = [];

  if (verdict.one_line) {
    parts.push(`AI Verdict: ${verdict.one_line}`);
  }
  if (projSummary.overview) {
    parts.push(`\n${projSummary.overview}`);
  } else if (intel?.projectOverview) {
    parts.push(`\n${intel.projectOverview}`);
  } else if (opp.descriptionSummary) {
    parts.push(`\n${opp.descriptionSummary}`);
  }

  return parts.join("\n") || opp.title;
}
