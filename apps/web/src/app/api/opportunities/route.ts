import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import type {
  OpportunityStatus,
  OpportunitySummary,
  PaginatedResponse,
  RelevanceBucket,
  WorkflowStatus,
} from "@/types";

interface RawOpportunityRow {
  id: string;
  title: string;
  status: string;
  workflow_status: string;
  organization_name: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  category: string | null;
  posted_date: Date | null;
  closing_date: Date | null;
  relevance_score: number;
  relevance_bucket: string;
  keywords_matched: string[];
  industry_tags: string[];
  source_url: string;
  source_name: string;
  estimated_value: string | null;
  currency: string;
  rank?: number;
  has_intelligence?: boolean;
  recommendation_status?: string | null;
  feasibility_score?: number | null;
  analysis_mode?: string | null;
  analysis_model?: string | null;
  has_qingyan_sync?: boolean;
  qingyan_project_id?: string | null;
}

function mapRowToSummary(row: RawOpportunityRow): OpportunitySummary {
  return {
    id: row.id,
    title: row.title,
    status: row.status as OpportunityStatus,
    workflowStatus: (row.workflow_status ?? "new") as WorkflowStatus,
    organization: row.organization_name ?? undefined,
    country: row.country ?? undefined,
    region: row.region ?? undefined,
    city: row.city ?? undefined,
    category: row.category ?? undefined,
    postedDate: row.posted_date ? new Date(row.posted_date).toISOString() : undefined,
    closingDate: row.closing_date ? new Date(row.closing_date).toISOString() : undefined,
    relevanceScore: Number(row.relevance_score),
    relevanceBucket: row.relevance_bucket as RelevanceBucket,
    keywordsMatched: row.keywords_matched ?? [],
    industryTags: row.industry_tags ?? [],
    sourceUrl: row.source_url,
    sourceName: row.source_name,
    estimatedValue: row.estimated_value ? Number(row.estimated_value) : undefined,
    currency: row.currency ?? undefined,
    hasIntelligence: row.has_intelligence ?? false,
    recommendationStatus: row.recommendation_status ?? undefined,
    feasibilityScore: row.feasibility_score ? Number(row.feasibility_score) : undefined,
    analysisMode: row.analysis_mode ?? undefined,
    analysisModel: row.analysis_model ?? undefined,
    hasQingyanSync: row.has_qingyan_sync ?? false,
    qingyanProjectId: row.qingyan_project_id ?? undefined,
  };
}


export async function GET(request: NextRequest) {
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = request.nextUrl;

    const keyword = searchParams.get("keyword")?.trim() || "";
    const status = searchParams.get("status") as OpportunityStatus | null;
    const country = searchParams.get("country");
    const region = searchParams.get("region");
    const sourceId = searchParams.get("sourceId");
    const category = searchParams.get("category");
    const bucket = searchParams.get("bucket") || "relevant";
    const workflow = searchParams.get("workflow");
    const tag = searchParams.get("tag");
    const postedAfter = searchParams.get("postedAfter");
    const postedBefore = searchParams.get("postedBefore");
    const closingAfter = searchParams.get("closingAfter");
    const closingBefore = searchParams.get("closingBefore");
    const minRelevance = searchParams.get("minRelevance");
    const sort = searchParams.get("sort") || "relevance";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10)));
    const offset = (page - 1) * pageSize;

    const params: SearchParams = {
      keyword: keyword || undefined,
      status,
      workflow,
      country,
      region,
      sourceId,
      category,
      bucket,
      tag,
      postedAfter,
      postedBefore,
      closingAfter,
      closingBefore,
      minRelevance,
      sort,
      page,
      pageSize,
      offset,
    };

    if (keyword) {
      return handleKeywordSearch({ ...params, keyword });
    }
    return handlePrismaSearch(params);
  } catch (error) {
    console.error("GET /api/opportunities error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

interface SearchParams {
  keyword?: string;
  status: string | null;
  workflow: string | null;
  country: string | null;
  region: string | null;
  sourceId: string | null;
  category: string | null;
  bucket: string | null;
  tag: string | null;
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

function addBucketCondition(conditions: string[], values: unknown[], bucket: string | null, paramIdx: { v: number }) {
  if (!bucket || bucket === "all") return;
  if (bucket === "relevant") {
    conditions.push(`o.relevance_bucket IN ('highly_relevant', 'moderately_relevant')`);
  } else {
    conditions.push(`o.relevance_bucket = $${paramIdx.v}`);
    values.push(bucket);
    paramIdx.v++;
  }
}

async function handleKeywordSearch(params: SearchParams & { keyword: string }) {
  const conditions: string[] = [];
  const values: unknown[] = [];
  const idx = { v: 1 };

  conditions.push(`o.search_vector @@ websearch_to_tsquery('english', $${idx.v})`);
  values.push(params.keyword);
  idx.v++;

  conditions.push(`o.ingestion_mode = 'live'`);
  addBucketCondition(conditions, values, params.bucket, idx);

  if (params.workflow) {
    conditions.push(`o.workflow_status = $${idx.v}::"WorkflowStatus"`);
    values.push(params.workflow);
    idx.v++;
  }

  if (params.tag) {
    conditions.push(`$${idx.v} = ANY(o.industry_tags)`);
    values.push(params.tag);
    idx.v++;
  }
  if (params.status) {
    conditions.push(`o.status = $${idx.v}::"OpportunityStatus"`);
    values.push(params.status);
    idx.v++;
  }
  if (params.country) {
    conditions.push(`o.country = $${idx.v}`);
    values.push(params.country);
    idx.v++;
  }
  if (params.region) {
    conditions.push(`o.region = $${idx.v}`);
    values.push(params.region);
    idx.v++;
  }
  if (params.sourceId) {
    conditions.push(`o.source_id = $${idx.v}::uuid`);
    values.push(params.sourceId);
    idx.v++;
  }
  if (params.category) {
    conditions.push(`o.category = $${idx.v}`);
    values.push(params.category);
    idx.v++;
  }
  if (params.postedAfter) {
    conditions.push(`o.posted_date >= $${idx.v}::date`);
    values.push(params.postedAfter);
    idx.v++;
  }
  if (params.postedBefore) {
    conditions.push(`o.posted_date <= $${idx.v}::date`);
    values.push(params.postedBefore);
    idx.v++;
  }
  if (params.closingAfter) {
    conditions.push(`o.closing_date >= $${idx.v}::timestamptz`);
    values.push(params.closingAfter);
    idx.v++;
  }
  if (params.closingBefore) {
    conditions.push(`o.closing_date <= $${idx.v}::timestamptz`);
    values.push(params.closingBefore);
    idx.v++;
  }
  if (params.minRelevance) {
    conditions.push(`o.relevance_score >= $${idx.v}`);
    values.push(parseInt(params.minRelevance, 10));
    idx.v++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  let orderBy: string;
  switch (params.sort) {
    case "closing_soon":
      orderBy = "o.closing_date ASC NULLS LAST";
      break;
    case "newest":
      orderBy = "o.posted_date DESC NULLS LAST";
      break;
    case "relevance":
    default:
      orderBy = "o.relevance_score DESC, ts_rank_cd(o.search_vector, websearch_to_tsquery('english', $1)) DESC";
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
      o.id, o.title, o.status::text, o.workflow_status::text,
      org.name AS organization_name,
      o.country, o.region, o.city, o.category,
      o.posted_date, o.closing_date,
      o.relevance_score, o.relevance_bucket,
      o.keywords_matched, o.industry_tags,
      o.source_url, s.name AS source_name,
      o.estimated_value::text, o.currency,
      ts_rank_cd(o.search_vector, websearch_to_tsquery('english', $1)) AS rank,
      (ti.id IS NOT NULL) AS has_intelligence,
      ti.recommendation_status,
      ti.feasibility_score,
      ti.analysis_mode,
      ti.analysis_model,
      (qs.id IS NOT NULL AND qs.sync_status = 'synced') AS has_qingyan_sync,
      qs.qingyan_project_id
    FROM opportunities o
    LEFT JOIN organizations org ON o.organization_id = org.id
    JOIN sources s ON o.source_id = s.id
    LEFT JOIN tender_intelligence ti ON ti.opportunity_id = o.id
    LEFT JOIN qingyan_sync qs ON qs.opportunity_id = o.id
    ${whereClause}
    ORDER BY ${orderBy}
    LIMIT $${idx.v} OFFSET $${idx.v + 1}
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
  // Use raw SQL to always include intelligence status (resilient to Prisma client sync issues)
  const conditions: string[] = ["o.ingestion_mode = 'live'"];
  const values: unknown[] = [];
  const idx = { v: 1 };

  if (params.bucket && params.bucket !== "all") {
    if (params.bucket === "relevant") {
      conditions.push(`o.relevance_bucket IN ('highly_relevant', 'moderately_relevant')`);
    } else {
      conditions.push(`o.relevance_bucket = $${idx.v}`);
      values.push(params.bucket);
      idx.v++;
    }
  }

  if (params.tag) {
    conditions.push(`$${idx.v} = ANY(o.industry_tags)`);
    values.push(params.tag);
    idx.v++;
  }
  if (params.workflow) {
    conditions.push(`o.workflow_status = $${idx.v}::"WorkflowStatus"`);
    values.push(params.workflow);
    idx.v++;
  }
  if (params.status) {
    conditions.push(`o.status = $${idx.v}::"OpportunityStatus"`);
    values.push(params.status);
    idx.v++;
  }
  if (params.country) {
    conditions.push(`o.country = $${idx.v}`);
    values.push(params.country);
    idx.v++;
  }
  if (params.region) {
    conditions.push(`o.region = $${idx.v}`);
    values.push(params.region);
    idx.v++;
  }
  if (params.sourceId) {
    conditions.push(`o.source_id = $${idx.v}::uuid`);
    values.push(params.sourceId);
    idx.v++;
  }
  if (params.category) {
    conditions.push(`o.category = $${idx.v}`);
    values.push(params.category);
    idx.v++;
  }
  if (params.postedAfter) {
    conditions.push(`o.posted_date >= $${idx.v}::date`);
    values.push(params.postedAfter);
    idx.v++;
  }
  if (params.postedBefore) {
    conditions.push(`o.posted_date <= $${idx.v}::date`);
    values.push(params.postedBefore);
    idx.v++;
  }
  if (params.closingAfter) {
    conditions.push(`o.closing_date >= $${idx.v}::timestamptz`);
    values.push(params.closingAfter);
    idx.v++;
  }
  if (params.closingBefore) {
    conditions.push(`o.closing_date <= $${idx.v}::timestamptz`);
    values.push(params.closingBefore);
    idx.v++;
  }
  if (params.minRelevance) {
    conditions.push(`o.relevance_score >= $${idx.v}`);
    values.push(parseInt(params.minRelevance, 10));
    idx.v++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  let orderBy: string;
  switch (params.sort) {
    case "closing_soon":
      orderBy = "o.closing_date ASC NULLS LAST";
      break;
    case "newest":
      orderBy = "o.posted_date DESC NULLS LAST";
      break;
    case "relevance":
    default:
      orderBy = "o.relevance_score DESC";
      break;
  }

  const countQuery = `
    SELECT COUNT(*)::int AS total
    FROM opportunities o
    ${whereClause}
  `;

  const dataQuery = `
    SELECT
      o.id, o.title, o.status::text, o.workflow_status::text,
      org.name AS organization_name,
      o.country, o.region, o.city, o.category,
      o.posted_date, o.closing_date,
      o.relevance_score, o.relevance_bucket,
      o.keywords_matched, o.industry_tags,
      o.source_url, s.name AS source_name,
      o.estimated_value::text, o.currency,
      (ti.id IS NOT NULL) AS has_intelligence,
      ti.recommendation_status,
      ti.feasibility_score,
      ti.analysis_mode,
      ti.analysis_model,
      (qs.id IS NOT NULL AND qs.sync_status = 'synced') AS has_qingyan_sync,
      qs.qingyan_project_id
    FROM opportunities o
    LEFT JOIN organizations org ON o.organization_id = org.id
    JOIN sources s ON o.source_id = s.id
    LEFT JOIN tender_intelligence ti ON ti.opportunity_id = o.id
    LEFT JOIN qingyan_sync qs ON qs.opportunity_id = o.id
    ${whereClause}
    ORDER BY ${orderBy}
    LIMIT $${idx.v} OFFSET $${idx.v + 1}
  `;

  const countValues = [...values];
  values.push(params.pageSize, params.offset);

  const [countResult, rows] = await Promise.all([
    prisma.$queryRawUnsafe<[{ total: number }]>(countQuery, ...countValues),
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
