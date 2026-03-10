import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

const createNoteSchema = z.object({
  content: z.string().min(1, "Content is required").max(10000),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error: authError } = await requireAuth();
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

    const adminUser = await prisma.user.findFirst({
      where: { role: "admin" },
      select: { id: true, name: true },
    });

    if (!adminUser) {
      return NextResponse.json(
        { error: "No admin user found" },
        { status: 500 }
      );
    }

    const note = await prisma.note.create({
      data: {
        content: parsed.data.content,
        userId: adminUser.id,
        opportunityId,
      },
      include: { user: { select: { name: true } } },
    });

    return NextResponse.json(
      {
        id: note.id,
        content: note.content,
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
