import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyQingyanWebhookSignature } from "@/lib/qingyan-client";
import type { WorkflowStatus } from "@/types";

const QINGYAN_TO_BIDTOGO_STATUS: Record<string, WorkflowStatus> = {
  new: "review",
  under_review: "review",
  qualification_check: "review",
  pursuing: "pursuing",
  supplier_quote: "rfq_sent",
  bid_preparation: "bid_drafted",
  bid_submitted: "bid_submitted",
  won: "won",
  lost: "lost",
  passed: "passed",
};

interface WebhookPayload {
  event: string;
  project_id: string;
  external_ref_id: string;
  external_ref_system?: string;
  old_status?: string;
  new_status: string;
  updated_by?: string;
  updated_at?: string;
}

export async function POST(request: NextRequest) {
  try {
    const signature = request.headers.get("x-qingyan-signature") || "";
    const timestamp = request.headers.get("x-qingyan-timestamp") || "";
    const rawBody = await request.text();

    if (!verifyQingyanWebhookSignature(signature, timestamp, rawBody)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const payload: WebhookPayload = JSON.parse(rawBody);

    if (payload.external_ref_system && payload.external_ref_system !== "bidtogo") {
      return NextResponse.json({ status: "ignored", reason: "Not a BidToGo reference" });
    }

    if (payload.event !== "project.status_changed") {
      return NextResponse.json({ status: "ignored", reason: `Unknown event: ${payload.event}` });
    }

    const sync = await prisma.qingyanSync.findFirst({
      where: {
        OR: [
          { qingyanProjectId: payload.project_id },
          { opportunityId: payload.external_ref_id },
        ],
      },
    });

    if (!sync) {
      return NextResponse.json(
        { error: "No matching sync record found" },
        { status: 404 }
      );
    }

    await prisma.qingyanSync.update({
      where: { id: sync.id },
      data: {
        qingyanStatus: payload.new_status,
        lastSyncAt: new Date(),
      },
    });

    const mappedStatus = QINGYAN_TO_BIDTOGO_STATUS[payload.new_status];
    if (mappedStatus) {
      await prisma.opportunity.update({
        where: { id: sync.opportunityId },
        data: {
          workflowStatus: mappedStatus,
          workflowUpdatedAt: new Date(),
          workflowNote: `Status updated from Qingyan: ${payload.new_status} (by ${payload.updated_by || "system"})`,
        },
      });
    }

    await prisma.auditLog.create({
      data: {
        action: "qingyan_webhook",
        entityType: "opportunity",
        entityId: sync.opportunityId,
        metadata: {
          event: payload.event,
          qingyanProjectId: payload.project_id,
          oldStatus: payload.old_status,
          newStatus: payload.new_status,
          updatedBy: payload.updated_by,
          mappedWorkflow: mappedStatus || null,
        },
      },
    });

    return NextResponse.json({
      status: "processed",
      syncId: sync.id,
      mappedWorkflow: mappedStatus || null,
    });
  } catch (error) {
    console.error("POST /api/webhooks/qingyan error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
