import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/api-auth";
import { isQingyanEnabled } from "@/lib/qingyan-client";
import { pushOpportunityToQingyan } from "@/lib/qingyan-push";

export const maxDuration = 60;

/**
 * Retry a failed push. The payload is rebuilt from the current opportunity
 * data (not replayed from the old snapshot) so any enrichment that happened
 * since the failure — translations, AI report, documents — is included.
 */
export async function POST(_request: NextRequest, { params }: { params: { syncId: string } }) {
  const { session, error: authError } = await requireRole(["owner", "super_admin", "admin", "manager", "sales"]);
  if (authError) return authError;

  if (!isQingyanEnabled()) {
    return NextResponse.json({ error: "Qingyan integration is not enabled" }, { status: 503 });
  }

  try {
    const sync = await prisma.qingyanSync.findUnique({ where: { id: params.syncId } });
    if (!sync) {
      return NextResponse.json({ error: "Sync record not found" }, { status: 404 });
    }
    if (sync.syncStatus === "synced") {
      return NextResponse.json({
        syncId: sync.id,
        status: "synced",
        qingyanProjectId: sync.qingyanProjectId,
        qingyanUrl: sync.qingyanUrl,
        message: "Already synced",
      });
    }

    const user = (session as { user?: { id?: string; email?: string } })?.user;
    const outcome = await pushOpportunityToQingyan(
      sync.opportunityId,
      { userId: user?.id, email: user?.email },
      { mode: "manual" }
    );

    switch (outcome.status) {
      case "not_found":
        return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
      case "pushing":
        return NextResponse.json({ error: "A push is already in progress", syncId: outcome.syncId }, { status: 409 });
      case "failed":
        return NextResponse.json(
          { syncId: outcome.syncId, status: "failed", error: outcome.error, retryable: outcome.retryable },
          { status: 502 }
        );
      case "already_synced":
      case "synced":
        return NextResponse.json({
          syncId: outcome.syncId,
          status: "synced",
          qingyanProjectId: outcome.qingyanProjectId,
          qingyanUrl: outcome.qingyanUrl,
          pushedAt: new Date().toISOString(),
        });
    }
  } catch (error) {
    console.error("POST /api/qingyan/retry error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
