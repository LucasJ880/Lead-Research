import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/api-auth";

export async function GET() {
  const { error } = await requireRole(["owner", "super_admin", "admin"]);
  if (error) return error;

  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        tenantId: true,
        companyId: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      data: users.map((u) => ({
        ...u,
        createdAt: u.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("GET /api/admin/users error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
