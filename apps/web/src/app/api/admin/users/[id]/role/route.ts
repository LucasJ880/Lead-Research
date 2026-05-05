import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser, requireRole } from "@/lib/api-auth";

const roleSchema = z.object({
  role: z.enum(["owner", "super_admin", "admin", "manager", "sales", "viewer", "client"]),
  companyId: z.string().uuid().nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { session, error } = await requireRole(["owner", "super_admin", "admin"]);
  if (error) return error;

  try {
    const parsed = roleSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const sessionUser = getSessionUser(session);
    if (sessionUser.id === params.id) {
      return NextResponse.json(
        { error: "You cannot modify your own role" },
        { status: 403 }
      );
    }

    const updated = await prisma.user.update({
      where: { id: params.id },
      data: {
        role: parsed.data.role,
        companyId: parsed.data.companyId,
      },
      select: { id: true, role: true, companyId: true },
    });

    return NextResponse.json(updated);
  } catch (err) {
    console.error("PATCH /api/admin/users/[id]/role error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
