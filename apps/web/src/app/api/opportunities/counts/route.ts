import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

export async function GET() {
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  try {
    const rows = await prisma.$queryRaw<{
      actionable: bigint;
      closing_soon: bigint;
      watch: bigint;
      expired: bigint;
    }[]>`
      SELECT
        COUNT(*) FILTER (
          WHERE COALESCE(set_aside_restricted, false) = false
            AND ingestion_mode = 'live'
            AND relevance_bucket IN ('highly_relevant', 'moderately_relevant')
            AND (closing_date IS NULL OR closing_date >= NOW())
        )::bigint AS actionable,
        COUNT(*) FILTER (
          WHERE COALESCE(set_aside_restricted, false) = false
            AND ingestion_mode = 'live'
            AND relevance_bucket IN ('highly_relevant', 'moderately_relevant')
            AND closing_date IS NOT NULL
            AND closing_date >= NOW()
            AND closing_date <= NOW() + INTERVAL '7 days'
        )::bigint AS closing_soon,
        COUNT(*) FILTER (
          WHERE COALESCE(set_aside_restricted, false) = false
            AND ingestion_mode = 'live'
            AND relevance_bucket = 'low_relevance'
            AND (closing_date IS NULL OR closing_date >= NOW())
        )::bigint AS watch,
        COUNT(*) FILTER (
          WHERE COALESCE(set_aside_restricted, false) = false
            AND ingestion_mode = 'live'
            AND closing_date IS NOT NULL
            AND closing_date < NOW()
        )::bigint AS expired
      FROM opportunities
    `;

    const row = rows[0];
    return NextResponse.json({
      actionable: Number(row?.actionable ?? 0),
      closing_soon: Number(row?.closing_soon ?? 0),
      watch: Number(row?.watch ?? 0),
      expired: Number(row?.expired ?? 0),
    });
  } catch (error) {
    console.error("GET /api/opportunities/counts error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
