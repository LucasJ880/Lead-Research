import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

const createSavedSearchSchema = z.object({
  name: z.string().min(1).max(255),
  filters: z.record(z.unknown()),
  notifyEnabled: z.boolean().default(false),
});

export async function GET() {
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  try {
    const adminUser = await prisma.user.findFirst({
      where: { role: "admin" },
      select: { id: true },
    });

    if (!adminUser) {
      return NextResponse.json([]);
    }

    const searches = await prisma.savedSearch.findMany({
      where: { userId: adminUser.id },
      orderBy: { createdAt: "desc" },
    });

    const data = searches.map((s) => ({
      id: s.id,
      name: s.name,
      filters: s.filters,
      notifyEnabled: s.notifyEnabled,
      resultCount: s.resultCount,
      createdAt: s.createdAt.toISOString(),
    }));

    return NextResponse.json(data);
  } catch (error) {
    console.error("GET /api/saved-searches error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  try {
    const adminUser = await prisma.user.findFirst({
      where: { role: "admin" },
      select: { id: true },
    });

    if (!adminUser) {
      return NextResponse.json(
        { error: "No admin user found" },
        { status: 500 }
      );
    }

    const body = await request.json();
    const parsed = createSavedSearchSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const search = await prisma.savedSearch.create({
      data: {
        userId: adminUser.id,
        name: parsed.data.name,
        filters: parsed.data.filters as Prisma.InputJsonValue,
        notifyEnabled: parsed.data.notifyEnabled,
      },
    });

    return NextResponse.json(
      {
        id: search.id,
        name: search.name,
        filters: search.filters,
        notifyEnabled: search.notifyEnabled,
        resultCount: search.resultCount,
        createdAt: search.createdAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/saved-searches error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
