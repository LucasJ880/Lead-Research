import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser, requireRole } from "@/lib/api-auth";
import type { BusinessStatus } from "@/types";

const businessStatusSchema = z.object({
  newStatus: z.enum([
    "new_discovered",
    "candidate",
    "under_review",
    "fit",
    "not_fit",
    "archived",
    "bidding",
    "submitted",
    "won",
    "lost",
  ]),
  reason: z.string().trim().min(3).max(5000).optional(),
});

const REASON_REQUIRED: BusinessStatus[] = ["not_fit", "archived"];

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { session, error } = await requireRole([
    "owner",
    "super_admin",
    "admin",
    "manager",
    "sales",
  ]);
  if (error) return error;

  try {
    const parsed = businessStatusSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { newStatus, reason } = parsed.data;
    if (REASON_REQUIRED.includes(newStatus) && !reason?.trim()) {
      return NextResponse.json(
        { error: "Reason is required for archived/not_fit status" },
        { status: 400 }
      );
    }

    const user = getSessionUser(session);
    if (!user.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const result = await prisma.$transaction(async (tx) => {
      const opportunity = await tx.opportunity.findUnique({
        where: { id: params.id },
        select: { id: true, businessStatus: true, tenantId: true },
      });
      if (!opportunity) {
        throw new Error("NOT_FOUND");
      }

      let reasonNoteId: string | null = null;
      if (reason) {
        const note = await tx.note.create({
          data: {
            userId: user.id!,
            opportunityId: params.id,
            noteType: "status_reason",
            tenantId: opportunity.tenantId,
            content: reason,
          },
        });
        reasonNoteId = note.id;
      }

      const updated = await tx.opportunity.update({
        where: { id: params.id },
        data: {
          businessStatus: newStatus,
          businessStatusReasonLatest: reason ?? null,
          workflowUpdatedAt: new Date(),
        },
      });

      const history = await tx.opportunityStatusHistory.create({
        data: {
          opportunityId: params.id,
          tenantId: opportunity.tenantId,
          changedByUserId: user.id!,
          oldStatus: opportunity.businessStatus,
          newStatus,
          reasonNoteId,
          reasonTextSnapshot: reason ?? null,
          source: "ui",
        },
      });

      return { updated, history };
    });

    return NextResponse.json({
      opportunity: {
        id: result.updated.id,
        businessStatus: result.updated.businessStatus,
        businessStatusReasonLatest: result.updated.businessStatusReasonLatest,
      },
      historyEvent: {
        id: result.history.id,
        oldStatus: result.history.oldStatus,
        newStatus: result.history.newStatus,
        changedAt: result.history.changedAt.toISOString(),
        reason: result.history.reasonTextSnapshot ?? undefined,
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_FOUND") {
      return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
    }
    console.error("PATCH /api/opportunities/[id]/business-status error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
