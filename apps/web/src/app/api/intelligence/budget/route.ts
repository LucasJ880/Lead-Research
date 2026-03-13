import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  try {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [dailyAgg, monthlyAgg, totalAnalyses, recentUsage] = await Promise.all([
      prisma.aiUsageLog.aggregate({
        where: { createdAt: { gte: startOfDay } },
        _sum: { estimatedCostUsd: true, totalTokens: true },
        _count: true,
      }),
      prisma.aiUsageLog.aggregate({
        where: { createdAt: { gte: startOfMonth } },
        _sum: { estimatedCostUsd: true, totalTokens: true },
        _count: true,
      }),
      prisma.aiUsageLog.count(),
      prisma.aiUsageLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          opportunityId: true,
          model: true,
          analysisMode: true,
          promptTokens: true,
          completionTokens: true,
          totalTokens: true,
          estimatedCostUsd: true,
          createdAt: true,
        },
      }),
    ]);

    const dailyBudget = parseFloat(process.env.AI_DAILY_BUDGET_USD || "5");
    const monthlyBudget = parseFloat(process.env.AI_MONTHLY_BUDGET_USD || "100");

    return NextResponse.json({
      daily: {
        spent: dailyAgg._sum.estimatedCostUsd ?? 0,
        budget: dailyBudget,
        analysisCount: dailyAgg._count,
        tokens: dailyAgg._sum.totalTokens ?? 0,
      },
      monthly: {
        spent: monthlyAgg._sum.estimatedCostUsd ?? 0,
        budget: monthlyBudget,
        analysisCount: monthlyAgg._count,
        tokens: monthlyAgg._sum.totalTokens ?? 0,
      },
      totalAnalyses,
      recentUsage,
    });
  } catch (error) {
    console.error("GET /api/intelligence/budget error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
