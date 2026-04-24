import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

export async function POST() {
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  try {
    const cutoffRows = await prisma.$queryRaw<{ cutoff: Date }[]>`
      SELECT NOW() - INTERVAL '14 days' AS cutoff
    `;
    const cutoff = cutoffRows[0]?.cutoff ?? new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    const deletedRows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        DELETE FROM tender_intelligence
        WHERE opportunity_id IN (
          SELECT id FROM opportunities
          WHERE closing_date IS NOT NULL AND closing_date < ${cutoff}
        )
      `;
      await tx.$executeRaw`
        DELETE FROM opportunity_documents
        WHERE opportunity_id IN (
          SELECT id FROM opportunities
          WHERE closing_date IS NOT NULL AND closing_date < ${cutoff}
        )
      `;
      await tx.$executeRaw`
        DELETE FROM notes
        WHERE opportunity_id IN (
          SELECT id FROM opportunities
          WHERE closing_date IS NOT NULL AND closing_date < ${cutoff}
        )
      `;
      await tx.$executeRaw`
        DELETE FROM qingyan_sync
        WHERE opportunity_id IN (
          SELECT id FROM opportunities
          WHERE closing_date IS NOT NULL AND closing_date < ${cutoff}
        )
      `;
      await tx.$executeRaw`
        UPDATE alerts
        SET opportunity_id = NULL
        WHERE opportunity_id IN (
          SELECT id FROM opportunities
          WHERE closing_date IS NOT NULL AND closing_date < ${cutoff}
        )
      `;
      return tx.$queryRaw<{ id: string }[]>`
        DELETE FROM opportunities
        WHERE closing_date IS NOT NULL AND closing_date < ${cutoff}
        RETURNING id
      `;
    });

    return NextResponse.json({
      status: "ok",
      cutoff: cutoff.toISOString(),
      deleted: deletedRows.length,
    });
  } catch (error) {
    console.error("POST /api/maintenance/purge-expired error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
