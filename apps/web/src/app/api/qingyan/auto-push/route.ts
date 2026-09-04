import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { isQingyanEnabled } from "@/lib/qingyan-client";
import { pushOpportunityToQingyan } from "@/lib/qingyan-push";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Vercel Cron: automatically push high-relevance open tenders to Qingyan.
 *
 * Enabled by setting QINGYAN_AUTO_PUSH_MIN_SCORE (e.g. 70). Each run pushes at
 * most QINGYAN_AUTO_PUSH_BATCH opportunities that are open, not yet closing,
 * not dismissed by a user, and have never been pushed.
 */
function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") || "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7) : header;
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const minScore = Number(process.env.QINGYAN_AUTO_PUSH_MIN_SCORE || 0);
  if (!minScore) {
    return NextResponse.json({ enabled: false, reason: "QINGYAN_AUTO_PUSH_MIN_SCORE not set" });
  }
  if (!isQingyanEnabled()) {
    return NextResponse.json({ enabled: false, reason: "Qingyan integration is not enabled" });
  }

  const batch = Math.min(25, Math.max(1, Number(process.env.QINGYAN_AUTO_PUSH_BATCH || 10)));
  const candidates = await prisma.opportunity.findMany({
    where: {
      relevanceScore: { gte: minScore },
      status: "open",
      OR: [{ closingDate: null }, { closingDate: { gt: new Date() } }],
      businessStatus: { notIn: ["not_fit", "archived", "lost"] },
      qingyanSync: null,
    },
    orderBy: [{ relevanceScore: "desc" }, { closingDate: "asc" }],
    select: { id: true, title: true, relevanceScore: true },
    take: batch,
  });

  const results: Array<{ id: string; title: string; score: number; status: string; error?: string }> = [];
  for (const opp of candidates) {
    try {
      const outcome = await pushOpportunityToQingyan(opp.id, { email: "auto-push" }, { mode: "auto" });
      results.push({
        id: opp.id,
        title: opp.title,
        score: opp.relevanceScore,
        status: outcome.status,
        ...(outcome.status === "failed" ? { error: outcome.error } : {}),
      });
    } catch (err) {
      results.push({ id: opp.id, title: opp.title, score: opp.relevanceScore, status: "error", error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({ enabled: true, min_score: minScore, candidates: candidates.length, results });
}
