import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";

const SCRAPER_API_URL = process.env.SCRAPER_API_URL || "http://localhost:8001";
const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY || "";

export async function POST(request: NextRequest) {
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  try {
    const res = await fetch(
      `${SCRAPER_API_URL}/api/analysis/cleanup-old-data`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": SCRAPER_API_KEY,
        },
      }
    );

    if (!res.ok) {
      return NextResponse.json(
        { error: "Cleanup service error" },
        { status: res.status }
      );
    }

    return NextResponse.json(await res.json());
  } catch (error) {
    console.error("POST /api/intelligence/cleanup error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
