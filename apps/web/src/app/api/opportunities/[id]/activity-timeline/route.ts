import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

type TimelineItem = {
  id: string;
  type: "status_change" | "note" | "analysis";
  createdAt: string;
  actorName?: string;
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
};

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    const exists = await prisma.opportunity.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!exists) {
      return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
    }

    const [notes, statusHistory, intelligence] = await Promise.all([
      prisma.note.findMany({
        where: { opportunityId: params.id },
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      prisma.opportunityStatusHistory.findMany({
        where: { opportunityId: params.id },
        include: { changedBy: { select: { name: true } } },
        orderBy: { changedAt: "desc" },
        take: 100,
      }),
      prisma.tenderIntelligence.findUnique({
        where: { opportunityId: params.id },
        select: {
          id: true,
          analyzedAt: true,
          analysisModel: true,
          analysisMode: true,
          recommendationStatus: true,
          feasibilityScore: true,
        },
      }),
    ]);

    const timeline: TimelineItem[] = [];

    for (const item of statusHistory) {
      timeline.push({
        id: `status-${item.id}`,
        type: "status_change",
        createdAt: item.changedAt.toISOString(),
        actorName: item.changedBy?.name ?? "System",
        title: `状态变更: ${item.oldStatus} -> ${item.newStatus}`,
        description: item.reasonTextSnapshot ?? undefined,
      });
    }

    for (const note of notes) {
      timeline.push({
        id: `note-${note.id}`,
        type: "note",
        createdAt: note.createdAt.toISOString(),
        actorName: note.user.name,
        title: note.noteType === "status_reason" ? "状态原因备注" : "备注",
        description: note.content,
        metadata: { noteType: note.noteType },
      });
    }

    if (intelligence?.analyzedAt) {
      timeline.push({
        id: `analysis-${intelligence.id}`,
        type: "analysis",
        createdAt: intelligence.analyzedAt.toISOString(),
        title: "AI 分析完成",
        description: intelligence.recommendationStatus ?? undefined,
        metadata: {
          model: intelligence.analysisModel,
          mode: intelligence.analysisMode,
          feasibilityScore: intelligence.feasibilityScore,
        },
      });
    }

    timeline.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return NextResponse.json({ data: timeline.slice(0, 200) });
  } catch (err) {
    console.error("GET /api/opportunities/[id]/activity-timeline error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
