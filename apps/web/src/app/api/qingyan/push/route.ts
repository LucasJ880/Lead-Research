import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { isQingyanEnabled } from "@/lib/qingyan-client";
import { pushOpportunityToQingyan } from "@/lib/qingyan-push";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const { session, error: authError } = await requireRole(["owner", "super_admin", "admin", "manager", "sales"]);
  if (authError) return authError;

  if (!isQingyanEnabled()) {
    return NextResponse.json({ error: "Qingyan integration is not enabled" }, { status: 503 });
  }

  try {
    const body = await request.json();
    const { opportunityId, options } = body as {
      opportunityId: string;
      options?: { createAs?: "project" | "task"; priority?: "high" | "medium" | "low"; assignTo?: string; notes?: string };
    };
    if (!opportunityId) {
      return NextResponse.json({ error: "opportunityId is required" }, { status: 400 });
    }

    const user = (session as { user?: { id?: string; email?: string } })?.user;
    const outcome = await pushOpportunityToQingyan(
      opportunityId,
      { userId: user?.id, email: user?.email },
      { ...options, mode: "manual" }
    );

    switch (outcome.status) {
      case "not_found":
        return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
      case "already_synced":
        return NextResponse.json(
          {
            error: "This opportunity has already been pushed to Qingyan",
            syncId: outcome.syncId,
            qingyanProjectId: outcome.qingyanProjectId,
            qingyanUrl: outcome.qingyanUrl,
          },
          { status: 409 }
        );
      case "pushing":
        return NextResponse.json({ error: "A push is already in progress", syncId: outcome.syncId }, { status: 409 });
      case "failed":
        return NextResponse.json(
          { syncId: outcome.syncId, status: "failed", error: outcome.error, retryable: outcome.retryable },
          { status: 502 }
        );
      case "synced":
        return NextResponse.json({
          syncId: outcome.syncId,
          status: "synced",
          qingyanProjectId: outcome.qingyanProjectId,
          qingyanUrl: outcome.qingyanUrl,
          pushedAt: new Date().toISOString(),
          ...(outcome.note ? { note: outcome.note } : {}),
        });
    }
  } catch (error) {
    console.error("POST /api/qingyan/push error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
