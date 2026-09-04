import { prisma } from "@/lib/prisma";
import {
  createQingyanProject,
  mapFeasibilityToRiskLevel,
  QingyanApiError,
  type QingyanProjectPayload,
} from "@/lib/qingyan-client";

/** A sync row stuck in "pushing" longer than this belongs to a crashed request. */
const STUCK_PUSHING_MS = 3 * 60 * 1000;
const MAX_DESCRIPTION_CHARS = 6000;
const MAX_DOC_TEXT_CHARS = 8000;

export interface PushOptions {
  createAs?: "project" | "task";
  priority?: "high" | "medium" | "low";
  assignTo?: string;
  notes?: string;
  mode?: "manual" | "auto";
}

export type PushOutcome =
  | { status: "synced"; syncId: string; qingyanProjectId: string | null; qingyanUrl: string | null; note?: string }
  | { status: "failed"; syncId: string; error: string; retryable: boolean }
  | { status: "already_synced"; syncId: string; qingyanProjectId: string | null; qingyanUrl: string | null }
  | { status: "not_found" }
  | { status: "pushing"; syncId: string };

function clip(text: string | null | undefined, max: number): string | null {
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function priorityFromScore(score: number): "high" | "medium" | "low" {
  if (score >= 85) return "high";
  if (score >= 70) return "medium";
  return "low";
}

/**
 * Build the Qingyan project payload for an opportunity — everything BidToGo knows
 * that a CRM/AI downstream can use: original notice URL, buyer contact, Chinese
 * translations, structured AI intelligence and extracted document text.
 */
export async function buildQingyanPayload(
  opportunityId: string,
  pushedBy: string,
  options?: PushOptions
): Promise<QingyanProjectPayload | null> {
  const opp = await prisma.opportunity.findUnique({
    where: { id: opportunityId },
    include: {
      source: { select: { name: true } },
      organization: { select: { name: true } },
      documents: {
        select: { title: true, url: true, fileType: true, pageCount: true, fileSizeBytes: true, extractedText: true },
        orderBy: { createdAt: "asc" },
        take: 25,
      },
      intelligence: true,
    },
  });
  if (!opp) return null;

  const intel = opp.intelligence;
  const intelSummary = (intel?.intelligenceSummary as Record<string, unknown>) ?? {};
  const markdownReport = typeof intelSummary.report_markdown === "string" ? (intelSummary.report_markdown as string) : null;
  const structuredReport =
    intelSummary.structured_report && typeof intelSummary.structured_report === "object"
      ? (intelSummary.structured_report as Record<string, unknown>)
      : null;
  const structuredFit = typeof structuredReport?.fit_score === "number" ? (structuredReport.fit_score as number) : null;

  const locationParts = [opp.city, opp.region, opp.country].filter(Boolean);
  const baseUrl = process.env.NEXTAUTH_URL || "https://bidtogo.ca";
  const shortSummary = opp.descriptionSummary || intel?.projectOverview || opp.title;
  const hasContact = Boolean(opp.contactName || opp.contactEmail || opp.contactPhone);

  return {
    external_ref: { system: "bidtogo", id: opp.id, url: `${baseUrl}/dashboard/opportunities/${opp.id}` },
    project: {
      name: `[招标] ${opp.titleZh || opp.title}`,
      description: shortSummary,
      category: "tender_opportunity",
      priority: options?.priority || priorityFromScore(opp.relevanceScore),
      deadline: opp.closingDate ? opp.closingDate.toISOString() : null,
      source_platform: opp.source.name,
      client_organization: opp.organization?.name || null,
      location: locationParts.length > 0 ? locationParts.join(", ") : null,
      estimated_value: opp.estimatedValue ? Number(opp.estimatedValue) : null,
      currency: opp.currency,
      solicitation_number: opp.solicitationNumber || null,
      source_url: opp.sourceUrl,
      posted_date: opp.postedDate ? opp.postedDate.toISOString().slice(0, 10) : null,
      procurement_type: opp.procurementType || null,
      set_aside: opp.setAside || null,
      addenda_count: opp.addendaCount,
      has_documents: opp.hasDocuments,
      mandatory_site_visit: opp.mandatorySiteVisit || null,
      pre_bid_meeting: opp.preBidMeeting || null,
      contact: hasContact
        ? { name: opp.contactName || null, email: opp.contactEmail || null, phone: opp.contactPhone || null }
        : null,
      description_full: clip(opp.descriptionFull, MAX_DESCRIPTION_CHARS),
      description_zh: opp.descriptionSummaryZh || null,
      description_full_zh: clip(opp.descriptionFullZh, MAX_DESCRIPTION_CHARS),
      industry_tags: opp.industryTags,
    },
    intelligence: {
      recommendation: intel?.recommendationStatus || (structuredReport?.recommendation as string | undefined) || null,
      risk_level: mapFeasibilityToRiskLevel(intel?.feasibilityScore ?? structuredFit),
      fit_score: opp.relevanceScore || null,
      feasibility_score: intel?.feasibilityScore ?? structuredFit,
      summary: opp.businessFitExplanation || intel?.projectOverview || null,
      full_report_url: null,
      full_report: markdownReport ? { report_markdown: markdownReport } : null,
      structured_report: structuredReport,
      scope_of_work: intel?.scopeOfWork || null,
      technical_requirements: intel?.technicalRequirements ?? null,
      qualification_reqs: intel?.qualificationReqs ?? null,
      critical_dates: intel?.criticalDates ?? null,
      risk_factors: intel?.riskFactors ?? null,
      china_source_analysis: intel?.chinaSourceAnalysis || null,
      analyzed_at: intel?.analyzedAt ? intel.analyzedAt.toISOString() : null,
    },
    documents: opp.documents.map((doc) => ({
      title: doc.title || "Untitled",
      url: doc.url,
      file_type: doc.fileType || null,
      page_count: doc.pageCount ?? null,
      file_size_bytes: doc.fileSizeBytes ?? null,
      extracted_text: clip(doc.extractedText, MAX_DOC_TEXT_CHARS),
    })),
    metadata: {
      bidtogo_workflow_status: opp.workflowStatus,
      relevance_score: opp.relevanceScore,
      relevance_bucket: opp.relevanceBucket,
      keywords_matched: opp.keywordsMatched,
      negative_keywords: opp.negativeKeywords,
      business_status: opp.businessStatus,
      industry_tags: opp.industryTags,
      source_external_id: opp.externalId,
      pushed_by: pushedBy,
      pushed_at: new Date().toISOString(),
      push_mode: options?.mode || "manual",
    },
    workflow_template: "tender_review",
  };
}

/**
 * Push one opportunity to Qingyan, maintaining the QingyanSync state machine.
 * Used by the manual button (POST /api/qingyan/push) and the auto-push cron.
 */
export async function pushOpportunityToQingyan(
  opportunityId: string,
  actor: { userId?: string | null; email?: string | null },
  options?: PushOptions
): Promise<PushOutcome> {
  const existing = await prisma.qingyanSync.findUnique({ where: { opportunityId } });

  if (existing?.syncStatus === "synced") {
    return {
      status: "already_synced",
      syncId: existing.id,
      qingyanProjectId: existing.qingyanProjectId,
      qingyanUrl: existing.qingyanUrl,
    };
  }
  if (existing?.syncStatus === "pushing") {
    const age = Date.now() - existing.updatedAt.getTime();
    if (age < STUCK_PUSHING_MS) return { status: "pushing", syncId: existing.id };
    // A request that died mid-push left the row stuck; release it and continue.
    await prisma.qingyanSync.update({
      where: { id: existing.id },
      data: { syncStatus: "failed", errorMessage: "Previous push did not complete (timed out)" },
    });
  }

  const payload = await buildQingyanPayload(opportunityId, actor.email || "system", options);
  if (!payload) return { status: "not_found" };

  const syncRecord = existing
    ? await prisma.qingyanSync.update({
        where: { id: existing.id },
        data: { syncStatus: "pushing", errorMessage: null, retryCount: { increment: 1 } },
      })
    : await prisma.qingyanSync.create({
        data: { opportunityId, syncStatus: "pushing", pushedBy: actor.userId || null, pushedAt: new Date() },
      });

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
        metadata: JSON.parse(
          JSON.stringify({
            tasksCreated: result.tasks_created || [],
            createAs: options?.createAs || "project",
            assignTo: options?.assignTo,
            userNotes: options?.notes,
            mode: options?.mode || "manual",
          })
        ),
      },
    });
    await prisma.auditLog.create({
      data: {
        userId: actor.userId || null,
        action: options?.mode === "auto" ? "qingyan_auto_push" : "qingyan_push",
        entityType: "opportunity",
        entityId: opportunityId,
        metadata: { qingyanProjectId: result.project_id, syncId: syncRecord.id },
      },
    });
    return { status: "synced", syncId: syncRecord.id, qingyanProjectId: result.project_id, qingyanUrl: result.project_url };
  } catch (apiErr) {
    if (apiErr instanceof QingyanApiError && apiErr.code === "DUPLICATE_EXTERNAL_REF") {
      await prisma.qingyanSync.update({
        where: { id: syncRecord.id },
        data: {
          syncStatus: "synced",
          qingyanProjectId: apiErr.existingProjectId || null,
          qingyanUrl: apiErr.existingProjectUrl || null,
          lastSyncAt: new Date(),
        },
      });
      return {
        status: "synced",
        syncId: syncRecord.id,
        qingyanProjectId: apiErr.existingProjectId || null,
        qingyanUrl: apiErr.existingProjectUrl || null,
        note: "Already existed in Qingyan — linked successfully",
      };
    }
    const errMsg = apiErr instanceof QingyanApiError ? apiErr.message : apiErr instanceof Error ? apiErr.message : "Unknown push error";
    const retryable = apiErr instanceof QingyanApiError ? apiErr.status >= 500 || apiErr.status === 408 || apiErr.status === 0 : true;
    await prisma.qingyanSync.update({
      where: { id: syncRecord.id },
      data: { syncStatus: "failed", errorMessage: errMsg },
    });
    return { status: "failed", syncId: syncRecord.id, error: errMsg, retryable };
  }
}
