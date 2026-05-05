import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser, requireRole } from "@/lib/api-auth";

const createNoteSchema = z.object({
  content: z.string().min(1, "Content is required").max(10000),
  noteType: z.enum(["general", "status_reason", "analysis_note", "system"]).default("general"),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { session, error: authError } = await requireRole([
    "owner",
    "super_admin",
    "admin",
    "manager",
    "sales",
  ]);
  if (authError) return authError;

  try {
    const { id: opportunityId } = params;

    const opportunity = await prisma.opportunity.findUnique({
      where: { id: opportunityId },
      select: { id: true },
    });

    if (!opportunity) {
      return NextResponse.json(
        { error: "Opportunity not found" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const parsed = createNoteSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const user = getSessionUser(session);
    if (!user.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const note = await prisma.note.create({
      data: {
        content: parsed.data.content,
        noteType: parsed.data.noteType,
        userId: user.id,
        opportunityId,
      },
      include: { user: { select: { name: true } } },
    });

    return NextResponse.json(
      {
        id: note.id,
        content: note.content,
        noteType: note.noteType,
        userName: note.user.name,
        createdAt: note.createdAt.toISOString(),
        updatedAt: note.updatedAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/opportunities/[id]/notes error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
