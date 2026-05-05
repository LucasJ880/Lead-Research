import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";

const SCRAPER_API_URL = process.env.SCRAPER_API_URL || "http://localhost:8001";
const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY || "";

export async function POST(request: NextRequest) {
  const { error: authError } = await requireRole([
    "owner",
    "super_admin",
    "admin",
    "manager",
    "sales",
  ]);
  if (authError) return authError;

  try {
    const body = await request.json();
    const opportunityId = body.opportunityId;
    const promptTemplateKey = body.promptTemplateKey;
    if (!opportunityId) {
      return NextResponse.json({ error: "opportunityId required" }, { status: 400 });
    }

    const res = await fetch(
      `${SCRAPER_API_URL}/api/analysis/mini-summary`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": SCRAPER_API_KEY,
        },
        body: JSON.stringify({ opportunity_id: opportunityId, prompt_template_key: promptTemplateKey }),
      }
    );

    if (!res.ok) {
      const errorText = await res.text();
      return NextResponse.json(
        { error: "Mini summary service error", detail: errorText },
        { status: res.status }
      );
    }

    const result = await res.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error("POST /api/intelligence/mini-summary error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
