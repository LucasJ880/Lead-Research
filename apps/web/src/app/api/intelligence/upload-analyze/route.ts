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
    const formData = await request.formData();

    const proxyForm = new FormData();
    const files = formData.getAll("files");
    for (const file of files) {
      proxyForm.append("files", file);
    }
    const opportunityId = formData.get("opportunity_id");
    if (opportunityId) {
      proxyForm.append("opportunity_id", opportunityId.toString());
    }
    const title = formData.get("title");
    if (title) {
      proxyForm.append("title", title.toString());
    }
    const promptTemplateKey = formData.get("prompt_template_key");
    if (promptTemplateKey) {
      proxyForm.append("prompt_template_key", promptTemplateKey.toString());
    }

    const res = await fetch(
      `${SCRAPER_API_URL}/api/analysis/upload-and-analyze`,
      {
        method: "POST",
        headers: { "X-API-Key": SCRAPER_API_KEY },
        body: proxyForm,
      }
    );

    if (!res.ok) {
      const errorText = await res.text();
      console.error("Upload analysis API error:", res.status, errorText);
      return NextResponse.json(
        { error: "Analysis service error", detail: errorText },
        { status: res.status }
      );
    }

    const result = await res.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error("POST /api/intelligence/upload-analyze error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
