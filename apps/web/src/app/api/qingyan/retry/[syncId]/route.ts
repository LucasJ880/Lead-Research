import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import {
  createQingyanProject,
  isQingyanEnabled,
  QingyanApiError,
  type QingyanProjectPayload,
} from "@/lib/qingyan-client";

export async function POST(
  _request: NextRequest,
  { params }: { params: { syncId: string } }
) {
  const { session, error: authError } = await requireAuth();
  if (authError) return authError;

  if (!isQingyanEnabled()) {
    return NextResponse.json(
      { error: "Qingyan integration is not enabled" },
      { status: 503 }
    );
  }

  try {
    const { syncId } = params;

    const sync = await prisma.qingyanSync.findUnique({
      where: { id: syncId },
    });

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

    if (!sync.payloadSnapshot) {
      return NextResponse.json(
        { error: "No payload snapshot available for retry. Please push again." },
        { status: 400 }
      );
    }

    await prisma.qingyanSync.update({
      where: { id: syncId },
      data: {
        syncStatus: "pushing",
        errorMessage: null,
        retryCount: { increment: 1 },
      },
    });

    const payload = sync.payloadSnapshot as unknown as QingyanProjectPayload;

    try {
      const result = await createQingyanProject(payload);

      await prisma.qingyanSync.update({
        where: { id: syncId },
        data: {
          syncStatus: "synced",
          qingyanProjectId: result.project_id,
          qingyanUrl: result.project_url,
          qingyanStatus: "new",
          lastSyncAt: new Date(),
        },
      });

      const userId = (session as { user?: { id?: string } })?.user?.id;
      await prisma.auditLog.create({
        data: {
          userId: userId || null,
          action: "qingyan_retry",
          entityType: "opportunity",
          entityId: sync.opportunityId,
          metadata: { syncId, qingyanProjectId: result.project_id },
        },
      });

      return NextResponse.json({
        syncId,
        status: "synced",
        qingyanProjectId: result.project_id,
        qingyanUrl: result.project_url,
      });
    } catch (apiErr) {
      const errMsg =
        apiErr instanceof QingyanApiError ? apiErr.message : "Unknown retry error";

      await prisma.qingyanSync.update({
        where: { id: syncId },
        data: {
          syncStatus: "failed",
          errorMessage: errMsg,
        },
      });

      return NextResponse.json(
        { syncId, status: "failed", error: errMsg, retryable: true },
        { status: 502 }
      );
    }
  } catch (error) {
    console.error("POST /api/qingyan/retry/[syncId] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
