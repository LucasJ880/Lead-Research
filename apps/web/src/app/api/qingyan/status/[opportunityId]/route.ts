import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { isQingyanEnabled } from "@/lib/qingyan-client";
import type { QingyanSyncInfo } from "@/types";

export async function GET(
  _request: NextRequest,
  { params }: { params: { opportunityId: string } }
) {
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  if (!isQingyanEnabled()) {
    return NextResponse.json({ enabled: false });
  }

  try {
    const { opportunityId } = params;

    const sync = await prisma.qingyanSync.findUnique({
      where: { opportunityId },
      include: {
        opportunity: false,
      },
    });

    if (!sync) {
      return NextResponse.json({ synced: false, enabled: true });
    }

    let pushedByName: string | undefined;
    if (sync.pushedBy) {
      const user = await prisma.user.findUnique({
        where: { id: sync.pushedBy },
        select: { name: true },
      });
      pushedByName = user?.name;
    }

    const info: QingyanSyncInfo & { synced: boolean; enabled: boolean } = {
      synced: sync.syncStatus === "synced",
      enabled: true,
      id: sync.id,
      syncStatus: sync.syncStatus as QingyanSyncInfo["syncStatus"],
      qingyanProjectId: sync.qingyanProjectId ?? undefined,
      qingyanTaskId: sync.qingyanTaskId ?? undefined,
      qingyanUrl: sync.qingyanUrl ?? undefined,
      qingyanStatus: sync.qingyanStatus ?? undefined,
      pushedBy: sync.pushedBy ?? undefined,
      pushedByName,
      pushedAt: sync.pushedAt?.toISOString(),
      lastSyncAt: sync.lastSyncAt?.toISOString(),
      errorMessage: sync.errorMessage ?? undefined,
      retryCount: sync.retryCount,
    };

    return NextResponse.json(info);
  } catch (error) {
    console.error("GET /api/qingyan/status/[opportunityId] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
