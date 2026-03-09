import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const scraperUrl = process.env.SCRAPER_API_URL || "http://localhost:8001";
  const apiKey = process.env.SCRAPER_API_KEY || "scraper-internal-key-change-in-prod";

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
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to trigger crawler:", error);
    return NextResponse.json(
      { error: "Failed to connect to scraper service" },
      { status: 502 }
    );
  }
}
