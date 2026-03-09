import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, { status: string; detail?: string }> = {};

  // Database
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { status: "ok" };
  } catch (e) {
    checks.database = {
      status: "error",
      detail: e instanceof Error ? e.message : "Unknown error",
    };
  }

  // Scraper API
  const scraperUrl = process.env.SCRAPER_API_URL || "http://localhost:8001";
  try {
    const resp = await fetch(`${scraperUrl}/api/health`, {
      signal: AbortSignal.timeout(5000),
    });
    checks.scraper = { status: resp.ok ? "ok" : "error", detail: `HTTP ${resp.status}` };
  } catch {
    checks.scraper = { status: "error", detail: `Cannot reach ${scraperUrl}` };
  }

  // Environment
  const requiredVars = [
    "DATABASE_URL",
    "NEXTAUTH_SECRET",
    "NEXTAUTH_URL",
    "SCRAPER_API_URL",
    "SCRAPER_API_KEY",
  ];
  const missingVars = requiredVars.filter((v) => !process.env[v]);
  checks.environment = missingVars.length === 0
    ? { status: "ok" }
    : { status: "warning", detail: `Missing: ${missingVars.join(", ")}` };

  // Source count
  try {
    const count = await prisma.source.count();
    checks.sources = { status: "ok", detail: `${count} registered` };
  } catch {
    checks.sources = { status: "error", detail: "Cannot query sources" };
  }

  // Admin user exists
  try {
    const adminCount = await prisma.user.count({ where: { role: "admin" } });
    checks.admin = adminCount > 0
      ? { status: "ok", detail: `${adminCount} admin(s)` }
      : { status: "warning", detail: "No admin users found" };
  } catch {
    checks.admin = { status: "error", detail: "Cannot query users" };
  }

  const allOk = Object.values(checks).every((c) => c.status === "ok");

  return NextResponse.json(
    { status: allOk ? "healthy" : "degraded", checks },
    { status: allOk ? 200 : 503 }
  );
}
