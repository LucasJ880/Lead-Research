import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

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

    const rows = await prisma.opportunityStatusHistory.findMany({
      where: { opportunityId: params.id },
      include: {
        changedBy: { select: { name: true } },
      },
      orderBy: { changedAt: "desc" },
      take: 200,
    });

    return NextResponse.json({
      data: rows.map((row) => ({
        id: row.id,
        oldStatus: row.oldStatus,
        newStatus: row.newStatus,
        reason: row.reasonTextSnapshot ?? undefined,
        changedBy: row.changedBy?.name ?? "System",
        changedAt: row.changedAt.toISOString(),
        source: row.source,
      })),
    });
  } catch (err) {
    console.error("GET /api/opportunities/[id]/status-history error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
