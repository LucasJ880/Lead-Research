import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api-auth";

const validateSchema = z.object({
  content: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const { error } = await requireRole(["owner", "super_admin", "admin", "manager"]);
  if (error) return error;

  try {
    const parsed = validateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const content = parsed.data.content;
    const lines = content.split("\n");
    const invalidTabs = lines.findIndex((line) => /^\t+/.test(line));
    if (invalidTabs >= 0) {
      return NextResponse.json(
        { valid: false, error: `Invalid YAML indentation (tab) at line ${invalidTabs + 1}` },
        { status: 400 }
      );
    }
    const missing: string[] = [];
    for (const required of ["template_key:", "version:", "system_prompt:", "user_prompt:"]) {
      if (!content.includes(required)) missing.push(required);
    }

    if (missing.length > 0) {
      return NextResponse.json(
        { valid: false, error: `Missing required keys: ${missing.join(", ")}` },
        { status: 400 }
      );
    }

    return NextResponse.json({ valid: true });
  } catch (err) {
    console.error("POST /api/intelligence/prompts/validate error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
