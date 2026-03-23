import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

export async function POST() {
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  try {
    const updated = await prisma.$executeRaw`
      WITH opp_stats AS (
        SELECT
          source_id,
          COUNT(*)::int AS total_opps,
          COUNT(*) FILTER (WHERE relevance_bucket IN ('highly_relevant','moderately_relevant'))::int AS relevant_opps,
          COUNT(*) FILTER (WHERE relevance_bucket = 'highly_relevant')::int AS highly_relevant
        FROM opportunities
        WHERE ingestion_mode = 'live'
        GROUP BY source_id
      ),
      run_stats AS (
        SELECT
          source_id,
          COUNT(*)::int AS total_runs,
          COUNT(*) FILTER (WHERE status = 'completed')::int AS success_runs,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS fail_runs,
          COALESCE(AVG(duration_ms) FILTER (WHERE status = 'completed'), 0)::int AS avg_duration
        FROM source_runs
        GROUP BY source_id
      ),
      recent_runs AS (
        SELECT DISTINCT ON (source_id)
          source_id, status
        FROM source_runs
        ORDER BY source_id, created_at DESC
      )
      UPDATE sources s SET
        total_opportunities = COALESCE(o.total_opps, 0),
        relevant_opportunities = COALESCE(o.relevant_opps, 0),
        highly_relevant_count = COALESCE(o.highly_relevant, 0),
        total_crawl_runs = COALESCE(r.total_runs, 0),
        successful_crawl_runs = COALESCE(r.success_runs, 0),
        failed_crawl_runs = COALESCE(r.fail_runs, 0),
        avg_crawl_duration_ms = COALESCE(r.avg_duration, 0),
        health_status = CASE
          WHEN s.health_status = 'unsupported'::"SourceHealthStatus" THEN 'unsupported'::"SourceHealthStatus"
          WHEN s.is_active = false THEN s.health_status
          WHEN r.total_runs IS NULL OR r.total_runs = 0 THEN 'untested'::"SourceHealthStatus"
          WHEN r.fail_runs::float / r.total_runs > 0.8 THEN 'failing'::"SourceHealthStatus"
          WHEN r.fail_runs::float / r.total_runs > 0.3 THEN 'degraded'::"SourceHealthStatus"
          WHEN rr.status = 'completed' AND COALESCE(o.total_opps, 0) > 0 THEN 'healthy'::"SourceHealthStatus"
          WHEN rr.status = 'completed' THEN 'degraded'::"SourceHealthStatus"
          ELSE 'degraded'::"SourceHealthStatus"
        END,
        yield_analytics_updated_at = NOW(),
        updated_at = NOW()
      FROM
        (SELECT id FROM sources) AS src
        LEFT JOIN opp_stats o ON o.source_id = src.id
        LEFT JOIN run_stats r ON r.source_id = src.id
        LEFT JOIN recent_runs rr ON rr.source_id = src.id
      WHERE s.id = src.id
    `;

    return NextResponse.json({
      success: true,
      sourcesUpdated: updated,
      recalculatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("POST /api/sources/recalculate error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
