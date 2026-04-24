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

    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        DELETE FROM tender_intelligence
        WHERE opportunity_id IN (
          SELECT id FROM opportunities
          WHERE (closing_date IS NOT NULL AND closing_date < ${cutoff})
             OR id IN (
               SELECT o.id
               FROM opportunities o
               JOIN sources s ON s.id = o.source_id
               WHERE s.name = 'SAM.gov'
                 AND (
                   COALESCE(o.set_aside_restricted, false) = true
                   OR COALESCE((o.raw_data->>'set_aside_restricted')::boolean, false) = true
                   OR EXISTS (
                     SELECT 1
                     FROM regexp_split_to_table(lower(COALESCE(o.set_aside, o.raw_data->>'set_aside', '')), ';') AS part
                     WHERE trim(part) NOT IN ('', 'none', 'null', 'n/a', 'na', 'no set aside used', 'no set-aside used')
                   )
                 )
             )
        )
      `;
      await tx.$executeRaw`
        DELETE FROM opportunity_documents
        WHERE opportunity_id IN (
          SELECT id FROM opportunities
          WHERE (closing_date IS NOT NULL AND closing_date < ${cutoff})
             OR id IN (
               SELECT o.id
               FROM opportunities o
               JOIN sources s ON s.id = o.source_id
               WHERE s.name = 'SAM.gov'
                 AND (
                   COALESCE(o.set_aside_restricted, false) = true
                   OR COALESCE((o.raw_data->>'set_aside_restricted')::boolean, false) = true
                   OR EXISTS (
                     SELECT 1
                     FROM regexp_split_to_table(lower(COALESCE(o.set_aside, o.raw_data->>'set_aside', '')), ';') AS part
                     WHERE trim(part) NOT IN ('', 'none', 'null', 'n/a', 'na', 'no set aside used', 'no set-aside used')
                   )
                 )
             )
        )
      `;
      await tx.$executeRaw`
        DELETE FROM notes
        WHERE opportunity_id IN (
          SELECT id FROM opportunities
          WHERE (closing_date IS NOT NULL AND closing_date < ${cutoff})
             OR id IN (
               SELECT o.id
               FROM opportunities o
               JOIN sources s ON s.id = o.source_id
               WHERE s.name = 'SAM.gov'
                 AND (
                   COALESCE(o.set_aside_restricted, false) = true
                   OR COALESCE((o.raw_data->>'set_aside_restricted')::boolean, false) = true
                   OR EXISTS (
                     SELECT 1
                     FROM regexp_split_to_table(lower(COALESCE(o.set_aside, o.raw_data->>'set_aside', '')), ';') AS part
                     WHERE trim(part) NOT IN ('', 'none', 'null', 'n/a', 'na', 'no set aside used', 'no set-aside used')
                   )
                 )
             )
        )
      `;
      await tx.$executeRaw`
        DELETE FROM opportunity_tags
        WHERE opportunity_id IN (
          SELECT id FROM opportunities
          WHERE (closing_date IS NOT NULL AND closing_date < ${cutoff})
             OR id IN (
               SELECT o.id
               FROM opportunities o
               JOIN sources s ON s.id = o.source_id
               WHERE s.name = 'SAM.gov'
                 AND (
                   COALESCE(o.set_aside_restricted, false) = true
                   OR COALESCE((o.raw_data->>'set_aside_restricted')::boolean, false) = true
                   OR EXISTS (
                     SELECT 1
                     FROM regexp_split_to_table(lower(COALESCE(o.set_aside, o.raw_data->>'set_aside', '')), ';') AS part
                     WHERE trim(part) NOT IN ('', 'none', 'null', 'n/a', 'na', 'no set aside used', 'no set-aside used')
                   )
                 )
             )
        )
      `;
      await tx.$executeRaw`
        DELETE FROM qingyan_sync
        WHERE opportunity_id IN (
          SELECT id FROM opportunities
          WHERE (closing_date IS NOT NULL AND closing_date < ${cutoff})
             OR id IN (
               SELECT o.id
               FROM opportunities o
               JOIN sources s ON s.id = o.source_id
               WHERE s.name = 'SAM.gov'
                 AND (
                   COALESCE(o.set_aside_restricted, false) = true
                   OR COALESCE((o.raw_data->>'set_aside_restricted')::boolean, false) = true
                   OR EXISTS (
                     SELECT 1
                     FROM regexp_split_to_table(lower(COALESCE(o.set_aside, o.raw_data->>'set_aside', '')), ';') AS part
                     WHERE trim(part) NOT IN ('', 'none', 'null', 'n/a', 'na', 'no set aside used', 'no set-aside used')
                   )
                 )
             )
        )
      `;
      await tx.$executeRaw`
        UPDATE alerts
        SET opportunity_id = NULL
        WHERE opportunity_id IN (
          SELECT id FROM opportunities
          WHERE (closing_date IS NOT NULL AND closing_date < ${cutoff})
             OR id IN (
               SELECT o.id
               FROM opportunities o
               JOIN sources s ON s.id = o.source_id
               WHERE s.name = 'SAM.gov'
                 AND (
                   COALESCE(o.set_aside_restricted, false) = true
                   OR COALESCE((o.raw_data->>'set_aside_restricted')::boolean, false) = true
                   OR EXISTS (
                     SELECT 1
                     FROM regexp_split_to_table(lower(COALESCE(o.set_aside, o.raw_data->>'set_aside', '')), ';') AS part
                     WHERE trim(part) NOT IN ('', 'none', 'null', 'n/a', 'na', 'no set aside used', 'no set-aside used')
                   )
                 )
             )
        )
      `;
      const expired = await tx.$queryRaw<{ id: string }[]>`
        DELETE FROM opportunities
        WHERE closing_date IS NOT NULL AND closing_date < ${cutoff}
        RETURNING id
      `;
      const restricted = await tx.$queryRaw<{ id: string }[]>`
        DELETE FROM opportunities
        WHERE id IN (
          SELECT o.id
          FROM opportunities o
          JOIN sources s ON s.id = o.source_id
          WHERE s.name = 'SAM.gov'
            AND (
              COALESCE(o.set_aside_restricted, false) = true
              OR COALESCE((o.raw_data->>'set_aside_restricted')::boolean, false) = true
              OR EXISTS (
                SELECT 1
                FROM regexp_split_to_table(lower(COALESCE(o.set_aside, o.raw_data->>'set_aside', '')), ';') AS part
                WHERE trim(part) NOT IN ('', 'none', 'null', 'n/a', 'na', 'no set aside used', 'no set-aside used')
              )
            )
        )
        RETURNING id
      `;
      return { expired, restricted };
    });

    return NextResponse.json({
      status: "ok",
      cutoff: cutoff.toISOString(),
      deleted: result.expired.length + result.restricted.length,
      expiredDeleted: result.expired.length,
      samSetAsideDeleted: result.restricted.length,
    });
  } catch (error) {
    console.error("POST /api/maintenance/purge-expired error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
