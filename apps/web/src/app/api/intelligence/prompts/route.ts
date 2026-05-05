import { NextResponse } from "next/server";
import path from "path";
import { promises as fs } from "fs";
import { requireRole } from "@/lib/api-auth";

function candidatePromptDirs(): string[] {
  return [
    path.resolve(process.cwd(), "services/scraper/config/prompts"),
    path.resolve(process.cwd(), "../services/scraper/config/prompts"),
    path.resolve(process.cwd(), "../../services/scraper/config/prompts"),
  ];
}

async function resolvePromptDir(): Promise<string> {
  for (const dir of candidatePromptDirs()) {
    try {
      await fs.access(dir);
      return dir;
    } catch {
      // Try next
    }
  }
  throw new Error("Prompt directory not found");
}

export async function GET() {
  const { error } = await requireRole(["owner", "super_admin", "admin", "manager"]);
  if (error) return error;

  try {
    const dir = await resolvePromptDir();
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
      .map((entry) => entry.name);

    const data = await Promise.all(
      files.map(async (name) => {
        const fullPath = path.join(dir, name);
        const content = await fs.readFile(fullPath, "utf8");
        const versionMatch = content.match(/version:\s*["']?([^\n"']+)/);
        const templateKeyMatch = content.match(/template_key:\s*["']?([^\n"']+)/);
        return {
          file: name,
          templateKey: templateKeyMatch?.[1]?.trim() ?? name.replace(".yaml", ""),
          version: versionMatch?.[1]?.trim() ?? "1.0.0",
          content,
        };
      })
    );

    return NextResponse.json({ data });
  } catch (err) {
    console.error("GET /api/intelligence/prompts error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
