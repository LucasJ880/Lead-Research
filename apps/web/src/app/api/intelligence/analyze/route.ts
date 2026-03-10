import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";

const SCRAPER_API_URL = process.env.SCRAPER_API_URL || "http://localhost:8001";
const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY || "";

export async function POST(request: NextRequest) {
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  try {
    const body = await request.json();
    const { opportunityId, mode = "quick" } = body;

    if (!opportunityId) {
      return NextResponse.json(
        { error: "opportunityId is required" },
        { status: 400 }
      );
    }

    const res = await fetch(`${SCRAPER_API_URL}/api/analysis/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": SCRAPER_API_KEY,
      },
      body: JSON.stringify({
        opportunity_id: opportunityId,
        mode,
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error("Analysis API error:", res.status, errorText);
      return NextResponse.json(
        { error: "Analysis service error", detail: errorText },
        { status: res.status }
      );
    }

    const result = await res.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error("POST /api/intelligence/analyze error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
