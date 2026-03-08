import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type {
  OpportunityStatus,
  OpportunitySummary,
  PaginatedResponse,
} from "@/types";

interface RawOpportunityRow {
  id: string;
  title: string;
  status: string;
  organization_name: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  category: string | null;
  posted_date: Date | null;
  closing_date: Date | null;
  relevance_score: number;
  source_url: string;
  source_name: string;
  estimated_value: string | null;
  currency: string;
  rank?: number;
}

function mapRowToSummary(row: RawOpportunityRow): OpportunitySummary {
  return {
    id: row.id,
    title: row.title,
    status: row.status as OpportunityStatus,
    organization: row.organization_name ?? undefined,
    country: row.country ?? undefined,
    region: row.region ?? undefined,
    city: row.city ?? undefined,
    category: row.category ?? undefined,
    postedDate: row.posted_date ? new Date(row.posted_date).toISOString() : undefined,
    closingDate: row.closing_date ? new Date(row.closing_date).toISOString() : undefined,
    relevanceScore: Number(row.relevance_score),
    sourceUrl: row.source_url,
    sourceName: row.source_name,
    estimatedValue: row.estimated_value ? Number(row.estimated_value) : undefined,
    currency: row.currency ?? undefined,
  };
}

function mapPrismaToSummary(
  opp: Prisma.OpportunityGetPayload<{
    include: { source: { select: { name: true } }; organization: { select: { name: true } } };
  }>
): OpportunitySummary {
  return {
    id: opp.id,
    title: opp.title,
    status: opp.status as OpportunityStatus,
    organization: opp.organization?.name ?? undefined,
    country: opp.country ?? undefined,
    region: opp.region ?? undefined,
    city: opp.city ?? undefined,
    category: opp.category ?? undefined,
    postedDate: opp.postedDate ? opp.postedDate.toISOString() : undefined,
    closingDate: opp.closingDate ? opp.closingDate.toISOString() : undefined,
    relevanceScore: Number(opp.relevanceScore),
    sourceUrl: opp.sourceUrl,
    sourceName: opp.source.name,
    estimatedValue: opp.estimatedValue ? Number(opp.estimatedValue) : undefined,
    currency: opp.currency ?? undefined,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;

    const keyword = searchParams.get("keyword")?.trim() || "";
    const status = searchParams.get("status") as OpportunityStatus | null;
    const country = searchParams.get("country");
    const region = searchParams.get("region");
    const sourceId = searchParams.get("sourceId");
    const category = searchParams.get("category");
    const postedAfter = searchParams.get("postedAfter");
    const postedBefore = searchParams.get("postedBefore");
    const closingAfter = searchParams.get("closingAfter");
    const closingBefore = searchParams.get("closingBefore");
    const minRelevance = searchParams.get("minRelevance");
    const sort = searchParams.get("sort") || "newest";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10)));
    const offset = (page - 1) * pageSize;

    if (keyword) {
      return handleKeywordSearch({
        keyword,
        status,
        country,
        region,
        sourceId,
        category,
        postedAfter,
        postedBefore,
        closingAfter,
        closingBefore,
        minRelevance,
        sort,
        page,
        pageSize,
        offset,
      });
    }

    return handlePrismaSearch({
      status,
      country,
      region,
      sourceId,
      category,
      postedAfter,
      postedBefore,
      closingAfter,
      closingBefore,
      minRelevance,
      sort,
      page,
      pageSize,
      offset,
    });
  } catch (error) {
    console.error("GET /api/opportunities error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

interface SearchParams {
  keyword?: string;
  status: string | null;
  country: string | null;
  region: string | null;
  sourceId: string | null;
  category: string | null;
  postedAfter: string | null;
  postedBefore: string | null;
  closingAfter: string | null;
  closingBefore: string | null;
  minRelevance: string | null;
  sort: string;
  page: number;
  pageSize: number;
  offset: number;
}

async function handleKeywordSearch(params: SearchParams & { keyword: string }) {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  conditions.push(`o.search_vector @@ websearch_to_tsquery('english', $${paramIdx})`);
  values.push(params.keyword);
  paramIdx++;

  if (params.status) {
    conditions.push(`o.status = $${paramIdx}::"OpportunityStatus"`);
    values.push(params.status);
    paramIdx++;
  }
  if (params.country) {
    conditions.push(`o.country = $${paramIdx}`);
    values.push(params.country);
    paramIdx++;
  }
  if (params.region) {
    conditions.push(`o.region = $${paramIdx}`);
    values.push(params.region);
    paramIdx++;
  }
  if (params.sourceId) {
    conditions.push(`o.source_id = $${paramIdx}::uuid`);
    values.push(params.sourceId);
    paramIdx++;
  }
  if (params.category) {
    conditions.push(`o.category = $${paramIdx}`);
    values.push(params.category);
    paramIdx++;
  }
  if (params.postedAfter) {
    conditions.push(`o.posted_date >= $${paramIdx}::date`);
    values.push(params.postedAfter);
    paramIdx++;
  }
  if (params.postedBefore) {
    conditions.push(`o.posted_date <= $${paramIdx}::date`);
    values.push(params.postedBefore);
    paramIdx++;
  }
  if (params.closingAfter) {
    conditions.push(`o.closing_date >= $${paramIdx}::timestamptz`);
    values.push(params.closingAfter);
    paramIdx++;
  }
  if (params.closingBefore) {
    conditions.push(`o.closing_date <= $${paramIdx}::timestamptz`);
    values.push(params.closingBefore);
    paramIdx++;
  }
  if (params.minRelevance) {
    conditions.push(`o.relevance_score >= $${paramIdx}`);
    values.push(parseInt(params.minRelevance, 10));
    paramIdx++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  let orderBy: string;
  switch (params.sort) {
    case "closing_soon":
      orderBy = "o.closing_date ASC NULLS LAST";
      break;
    case "relevance":
      orderBy = `ts_rank_cd(o.search_vector, websearch_to_tsquery('english', $1)) DESC`;
      break;
    case "newest":
    default:
      orderBy = "o.posted_date DESC NULLS LAST";
      break;
  }

  const countQuery = `
    SELECT COUNT(*)::int AS total
    FROM opportunities o
    LEFT JOIN organizations org ON o.organization_id = org.id
    LEFT JOIN sources s ON o.source_id = s.id
    ${whereClause}
  `;

  const dataQuery = `
    SELECT
      o.id,
      o.title,
      o.status::text,
      org.name AS organization_name,
      o.country,
      o.region,
      o.city,
      o.category,
      o.posted_date,
      o.closing_date,
      o.relevance_score,
      o.source_url,
      s.name AS source_name,
      o.estimated_value::text,
      o.currency,
      ts_rank_cd(o.search_vector, websearch_to_tsquery('english', $1)) AS rank
    FROM opportunities o
    LEFT JOIN organizations org ON o.organization_id = org.id
    JOIN sources s ON o.source_id = s.id
    ${whereClause}
    ORDER BY ${orderBy}
    LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
  `;

  values.push(params.pageSize, params.offset);

  const [countResult, rows] = await Promise.all([
    prisma.$queryRawUnsafe<[{ total: number }]>(countQuery, ...values.slice(0, -2)),
    prisma.$queryRawUnsafe<RawOpportunityRow[]>(dataQuery, ...values),
  ]);

  const total = countResult[0]?.total ?? 0;
  const data = rows.map(mapRowToSummary);

  const response: PaginatedResponse<OpportunitySummary> = {
    data,
    total,
    page: params.page,
    pageSize: params.pageSize,
    totalPages: Math.ceil(total / params.pageSize),
  };

  return NextResponse.json(response);
}

async function handlePrismaSearch(params: SearchParams) {
  const where: Prisma.OpportunityWhereInput = {};

  if (params.status) where.status = params.status as OpportunityStatus;
  if (params.country) where.country = params.country;
  if (params.region) where.region = params.region;
  if (params.sourceId) where.sourceId = params.sourceId;
  if (params.category) where.category = params.category;

  if (params.postedAfter || params.postedBefore) {
    where.postedDate = {};
    if (params.postedAfter) where.postedDate.gte = new Date(params.postedAfter);
    if (params.postedBefore) where.postedDate.lte = new Date(params.postedBefore);
  }

  if (params.closingAfter || params.closingBefore) {
    where.closingDate = {};
    if (params.closingAfter) where.closingDate.gte = new Date(params.closingAfter);
    if (params.closingBefore) where.closingDate.lte = new Date(params.closingBefore);
  }

  if (params.minRelevance) {
    where.relevanceScore = { gte: parseInt(params.minRelevance, 10) };
  }

  let orderBy: Prisma.OpportunityOrderByWithRelationInput;
  switch (params.sort) {
    case "closing_soon":
      orderBy = { closingDate: { sort: "asc", nulls: "last" } };
      break;
    case "relevance":
      orderBy = { relevanceScore: "desc" };
      break;
    case "newest":
    default:
      orderBy = { postedDate: { sort: "desc", nulls: "last" } };
      break;
  }

  const [total, opportunities] = await Promise.all([
    prisma.opportunity.count({ where }),
    prisma.opportunity.findMany({
      where,
      orderBy,
      skip: params.offset,
      take: params.pageSize,
      include: {
        source: { select: { name: true } },
        organization: { select: { name: true } },
      },
    }),
  ]);

  const data = opportunities.map(mapPrismaToSummary);

  const response: PaginatedResponse<OpportunitySummary> = {
    data,
    total,
    page: params.page,
    pageSize: params.pageSize,
    totalPages: Math.ceil(total / params.pageSize),
  };

  return NextResponse.json(response);
}
