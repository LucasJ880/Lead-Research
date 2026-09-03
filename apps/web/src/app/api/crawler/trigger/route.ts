import { NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";

// Vercel: allow up to 60s for this route (proxies to the scraper / heavy queries)
export const maxDuration = 60;

export async function POST() {
  const { error: authError } = await requireRole(["owner", "super_admin", "admin", "manager"]);
  if (authError) return authError;

  const scraperUrl = process.env.SCRAPER_API_URL || "http://localhost:8001";
  const apiKey = process.env.SCRAPER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "SCRAPER_API_KEY is not configured on the server" },
      { status: 500 }
    );
  }

  try {
    const resp = await fetch(`${scraperUrl}/api/crawl/all`, {
      method: "POST",
      headers: { "X-API-Key": apiKey },
    });

    if (!resp.ok) {
      const text = await resp.text();
      return NextResponse.json(
        { error: `Scraper returned ${resp.status}: ${text}` },
        { status: resp.status }
      );
    }

    const data = await resp.json();
    // Scraper may return status: "dispatched" or "already_running".
    // Both are success from the caller's point of view; the frontend
    // distinguishes them in user copy.
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to trigger crawler:", error);
    return NextResponse.json(
      { error: "Failed to connect to scraper service" },
      { status: 502 }
    );
  }
}
