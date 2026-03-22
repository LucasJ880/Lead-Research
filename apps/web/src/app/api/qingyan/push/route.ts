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
    const baseUrl = process.env.NEXTAUTH_URL || "https://bidtogo.ca";
    const oppUrl = `${baseUrl}/dashboard/opportunities/${opp.id}`;

    const fullReport = intel?.intelligenceSummary
      ? JSON.parse(JSON.stringify(intel.intelligenceSummary))
      : null;

    const payload: QingyanProjectPayload = {
      external_ref: {
        system: "bidtogo",
        id: opp.id,
        url: oppUrl,
      },
      project: {
        name: `[Tender] ${opp.title}`,
        description: buildFullDescription(opp, intel, report),
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
        full_report_url: `${oppUrl}#analysis`,
        full_report: fullReport,
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

function buildFullDescription(
  opp: { title: string; descriptionSummary: string | null },
  intel: { projectOverview: string | null } | null,
  report: Record<string, unknown>
): string {
  const sections: string[] = [];
  const verdict = (report.verdict as Record<string, unknown>) ?? {};
  const projSummary = (report.project_summary as Record<string, unknown>) ?? {};
  const scope = (report.scope_breakdown as Record<string, unknown>) ?? {};
  const techReqs = (report.technical_requirements as Record<string, unknown>) ?? {};
  const timeline = (report.timeline_milestones as Record<string, unknown>) ?? {};
  const bizFit = (report.business_fit as Record<string, unknown>) ?? {};
  const compliance = (report.compliance_risks as Record<string, unknown>) ?? {};
  const supplyChain = (report.supply_chain_feasibility as Record<string, unknown>) ?? {};
  const participation = (report.participation_strategy as Record<string, unknown>) ?? {};
  const scores = (report.feasibility_scores as Record<string, unknown>) ?? {};
  const evidence = (report.required_evidence as Record<string, unknown>) ?? {};

  if (verdict.one_line) {
    sections.push(`【AI 判断】${verdict.one_line}`);
    if (verdict.recommendation) sections[0] += ` | 推荐: ${String(verdict.recommendation).replace(/_/g, " ").toUpperCase()}`;
    if (verdict.confidence) sections[0] += ` | 置信度: ${verdict.confidence}`;
  }

  if (scores.overall_score != null) {
    const s = scores;
    sections.push(`【可行性评分】总分: ${s.overall_score}/100 | 技术: ${s.technical_feasibility ?? "—"} | 合规: ${s.compliance_feasibility ?? "—"} | 商业: ${s.commercial_feasibility ?? "—"}`
      + (s.score_rationale ? `\n${s.score_rationale}` : ""));
  }

  const overview = projSummary.overview || intel?.projectOverview;
  if (overview) {
    sections.push(`【项目概要】${overview}`
      + (projSummary.issuing_body ? `\n发标机构: ${projSummary.issuing_body}` : "")
      + (projSummary.project_type && projSummary.project_type !== "other" ? ` | 类型: ${String(projSummary.project_type).replace(/_/g, " ")}` : ""));
  }

  const deliverables = scope.main_deliverables as string[] | undefined;
  if (deliverables?.length) {
    sections.push(`【工作范围】\n${deliverables.map((d: string) => `• ${d}`).join("\n")}`
      + (scope.quantities && scope.quantities !== "Not specified" ? `\n数量: ${scope.quantities}` : "")
      + (scope.intended_use && scope.intended_use !== "Not specified" ? `\n用途: ${scope.intended_use}` : ""));
  }

  const prodReqs = techReqs.product_requirements as string[] | undefined;
  const standards = techReqs.standards_certifications as string[] | undefined;
  if (prodReqs?.length || standards?.length) {
    let t = "【技术要求】";
    if (prodReqs?.length) t += `\n产品规格: ${prodReqs.join("; ")}`;
    if (standards?.length) t += `\n标准/认证: ${standards.join("; ")}`;
    if (techReqs.control_systems && techReqs.control_systems !== "Not specified") t += `\n控制系统: ${techReqs.control_systems}`;
    sections.push(t);
  }

  if (timeline.bid_closing || timeline.project_start || timeline.delivery_deadline) {
    let t = "【时间节点】";
    if (timeline.bid_closing) t += `\n投标截止: ${timeline.bid_closing}`;
    if (timeline.project_start) t += ` | 项目开始: ${timeline.project_start}`;
    if (timeline.delivery_deadline) t += ` | 交付: ${timeline.delivery_deadline}`;
    if (timeline.schedule_pressure && timeline.schedule_pressure !== "realistic") t += `\n⚠ 时间压力: ${String(timeline.schedule_pressure).replace(/_/g, " ")}`;
    if (timeline.schedule_notes) t += `\n${timeline.schedule_notes}`;
    sections.push(t);
  }

  if (bizFit.fit_assessment) {
    let t = `【业务匹配】${String(bizFit.fit_assessment).replace(/_/g, " ")}`;
    if (bizFit.fit_explanation) t += `\n${bizFit.fit_explanation}`;
    if (bizFit.recommended_role && bizFit.recommended_role !== "not_recommended") t += `\n建议角色: ${String(bizFit.recommended_role).replace(/_/g, " ")}`;
    const gaps = bizFit.capability_gaps as string[] | undefined;
    if (gaps?.length) t += `\n能力缺口: ${gaps.join("; ")}`;
    sections.push(t);
  }

  const redFlags = compliance.red_flags as Array<Record<string, string>> | undefined;
  if (redFlags?.length) {
    sections.push(`【合规风险】\n${redFlags.map((rf) => {
      let line = `${rf.severity === "fatal_blocker" ? "🚫 致命" : rf.severity === "serious_risk" ? "⚠ 严重" : "ℹ 一般"}: ${rf.requirement}`;
      if (rf.explanation) line += ` — ${rf.explanation}`;
      return line;
    }).join("\n")}`);
  }

  if (supplyChain.china_sourcing_viable != null) {
    let t = `【供应链分析】中国采购: ${supplyChain.china_sourcing_viable ? "可行 ✓" : "不可行 ✗"}`;
    if (supplyChain.sourcing_explanation) t += `\n${supplyChain.sourcing_explanation}`;
    const restrictions = supplyChain.buy_domestic_restrictions as string[] | undefined;
    if (restrictions?.length) t += `\n国产限制: ${restrictions.join("; ")}`;
    if (supplyChain.shipping_lead_time && supplyChain.shipping_lead_time !== "Not assessed") t += `\n交期: ${supplyChain.shipping_lead_time}`;
    sections.push(t);
  }

  if (participation.recommended_approach) {
    let t = `【参与策略】${String(participation.recommended_approach).replace(/_/g, " ")}`;
    if (participation.strategy_rationale) t += `\n${participation.strategy_rationale}`;
    if (participation.competitive_positioning && participation.competitive_positioning !== "Not assessed") t += `\n竞争定位: ${participation.competitive_positioning}`;
    sections.push(t);
  }

  const beforeBidding = evidence.before_bidding as string[] | undefined;
  const withSubmission = evidence.with_submission as string[] | undefined;
  if (beforeBidding?.length || withSubmission?.length) {
    let t = "【所需证据】";
    if (beforeBidding?.length) t += `\n投标前准备:\n${beforeBidding.map((e: string) => `☐ ${e}`).join("\n")}`;
    if (withSubmission?.length) t += `\n随标提交:\n${withSubmission.map((e: string) => `☐ ${e}`).join("\n")}`;
    sections.push(t);
  }

  if (!sections.length) {
    return opp.descriptionSummary || opp.title;
  }

  return sections.join("\n\n");
}
