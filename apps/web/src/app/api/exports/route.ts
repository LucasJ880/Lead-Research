import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import type { OpportunityStatus } from "@/types";

interface ExportRow {
  Title: string;
  Status: string;
  Organization: string;
  Country: string;
  Region: string;
  City: string;
  "Posted Date": string;
  "Closing Date": string;
  Category: string;
  "Est. Value": string;
  Currency: string;
  "Relevance Score": number;
  Source: string;
  "Source URL": string;
  "Solicitation #": string;
  "Contact Name": string;
  "Contact Email": string;
}

interface RawExportRow {
  title: string;
  status: string;
  organization_name: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  posted_date: Date | null;
  closing_date: Date | null;
  category: string | null;
  estimated_value: string | null;
  currency: string;
  relevance_score: number;
  source_name: string;
  source_url: string;
  solicitation_number: string | null;
  contact_name: string | null;
  contact_email: string | null;
}

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  return date.toISOString().split("T")[0];
}

function toExportRow(row: RawExportRow): ExportRow {
  return {
    Title: row.title,
    Status: row.status,
    Organization: row.organization_name ?? "",
    Country: row.country ?? "",
    Region: row.region ?? "",
    City: row.city ?? "",
    "Posted Date": formatDate(row.posted_date),
    "Closing Date": formatDate(row.closing_date),
    Category: row.category ?? "",
    "Est. Value": row.estimated_value ? Number(row.estimated_value).toLocaleString() : "",
    Currency: row.currency,
    "Relevance Score": Number(row.relevance_score),
    Source: row.source_name,
    "Source URL": row.source_url,
    "Solicitation #": row.solicitation_number ?? "",
    "Contact Name": row.contact_name ?? "",
    "Contact Email": row.contact_email ?? "",
  };
}

function toPrismaExportRow(
  opp: Prisma.OpportunityGetPayload<{
    include: {
      source: { select: { name: true } };
      organization: { select: { name: true } };
    };
  }>
): ExportRow {
  return {
    Title: opp.title,
    Status: opp.status,
    Organization: opp.organization?.name ?? "",
    Country: opp.country ?? "",
    Region: opp.region ?? "",
    City: opp.city ?? "",
    "Posted Date": opp.postedDate ? formatDate(opp.postedDate) : "",
    "Closing Date": opp.closingDate ? formatDate(opp.closingDate) : "",
    Category: opp.category ?? "",
    "Est. Value": opp.estimatedValue ? Number(opp.estimatedValue).toLocaleString() : "",
    Currency: opp.currency,
    "Relevance Score": Number(opp.relevanceScore),
    Source: opp.source.name,
    "Source URL": opp.sourceUrl,
    "Solicitation #": opp.solicitationNumber ?? "",
    "Contact Name": opp.contactName ?? "",
    "Contact Email": opp.contactEmail ?? "",
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
    const postedAfter = searchParams.get("postedAfter");
    const postedBefore = searchParams.get("postedBefore");
    const closingAfter = searchParams.get("closingAfter");
    const closingBefore = searchParams.get("closingBefore");
    const minRelevance = searchParams.get("minRelevance");
    const format = searchParams.get("format") || "xlsx";

    let exportData: ExportRow[];

    if (keyword) {
      exportData = await fetchWithKeyword({
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
      });
    } else {
      exportData = await fetchWithPrisma({
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
      });
    }

    if (format === "csv") {
      const ws = XLSX.utils.json_to_sheet(exportData);
      const csv = XLSX.utils.sheet_to_csv(ws);
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="opportunities_export.csv"`,
        },
      });
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportData);

    const colWidths = [
      { wch: 50 }, // Title
      { wch: 12 }, // Status
      { wch: 30 }, // Organization
      { wch: 8 },  // Country
      { wch: 15 }, // Region
      { wch: 15 }, // City
      { wch: 12 }, // Posted Date
      { wch: 12 }, // Closing Date
      { wch: 20 }, // Category
      { wch: 15 }, // Est. Value
      { wch: 8 },  // Currency
      { wch: 10 }, // Relevance Score
      { wch: 25 }, // Source
      { wch: 40 }, // Source URL
      { wch: 20 }, // Solicitation #
      { wch: 20 }, // Contact Name
      { wch: 25 }, // Contact Email
    ];
    ws["!cols"] = colWidths;

    XLSX.utils.book_append_sheet(wb, ws, "Opportunities");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    return new NextResponse(buf, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="opportunities_export.xlsx"`,
      },
    });
  } catch (error) {
    console.error("GET /api/exports error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

interface FilterParams {
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
}

async function fetchWithKeyword(
  params: FilterParams & { keyword: string }
): Promise<ExportRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  conditions.push(
    `o.search_vector @@ websearch_to_tsquery('english', $${paramIdx})`
  );
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

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const query = `
    SELECT
      o.title,
      o.status::text,
      org.name AS organization_name,
      o.country,
      o.region,
      o.city,
      o.posted_date,
      o.closing_date,
      o.category,
      o.estimated_value::text,
      o.currency,
      o.relevance_score,
      s.name AS source_name,
      o.source_url,
      o.solicitation_number,
      o.contact_name,
      o.contact_email
    FROM opportunities o
    LEFT JOIN organizations org ON o.organization_id = org.id
    JOIN sources s ON o.source_id = s.id
    ${whereClause}
    ORDER BY ts_rank_cd(o.search_vector, websearch_to_tsquery('english', $1)) DESC
    LIMIT 10000
  `;

  const rows = await prisma.$queryRawUnsafe<RawExportRow[]>(query, ...values);
  return rows.map(toExportRow);
}

async function fetchWithPrisma(params: FilterParams): Promise<ExportRow[]> {
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

  const opportunities = await prisma.opportunity.findMany({
    where,
    orderBy: { postedDate: { sort: "desc", nulls: "last" } },
    take: 10000,
    include: {
      source: { select: { name: true } },
      organization: { select: { name: true } },
    },
  });

  return opportunities.map(toPrismaExportRow);
}
