import crypto from "crypto";

const QINGYAN_API_BASE = process.env.QINGYAN_API_BASE || "";
const QINGYAN_API_TOKEN = process.env.QINGYAN_API_TOKEN || "";
const QINGYAN_ENABLED = process.env.QINGYAN_ENABLED === "true";
const QINGYAN_WEBHOOK_SECRET = process.env.QINGYAN_WEBHOOK_SECRET || "";

const REQUEST_TIMEOUT_MS = 10_000;

export function isQingyanEnabled(): boolean {
  return QINGYAN_ENABLED && !!QINGYAN_API_BASE && !!QINGYAN_API_TOKEN;
}

export interface QingyanProjectPayload {
  external_ref: {
    system: "bidtogo";
    id: string;
    url: string;
  };
  project: {
    name: string;
    description: string;
    category: "tender_opportunity";
    priority: "high" | "medium" | "low";
    deadline: string | null;
    source_platform: string;
    client_organization: string | null;
    location: string | null;
    estimated_value: number | null;
    currency: string;
    solicitation_number: string | null;
  };
  intelligence: {
    recommendation: string | null;
    risk_level: "low" | "medium" | "high" | "unassessed";
    fit_score: number | null;
    summary: string | null;
    full_report_url: string;
  };
  documents: Array<{
    title: string;
    url: string;
    file_type: string | null;
  }>;
  metadata: {
    bidtogo_workflow_status: string;
    relevance_score: number;
    relevance_bucket: string;
    keywords_matched: string[];
    pushed_by: string;
    pushed_at: string;
  };
  workflow_template: "tender_review";
}

export interface QingyanCreateResponse {
  project_id: string;
  project_url: string;
  status: string;
  tasks_created?: Array<{ task_id: string; name: string }>;
}

export interface QingyanErrorResponse {
  error: string;
  code?: string;
  existing_project_id?: string;
  existing_project_url?: string;
}

class QingyanApiError extends Error {
  status: number;
  code?: string;
  existingProjectId?: string;
  existingProjectUrl?: string;

  constructor(message: string, status: number, body?: QingyanErrorResponse) {
    super(message);
    this.name = "QingyanApiError";
    this.status = status;
    this.code = body?.code;
    this.existingProjectId = body?.existing_project_id;
    this.existingProjectUrl = body?.existing_project_url;
  }
}

export { QingyanApiError };

export async function createQingyanProject(
  payload: QingyanProjectPayload
): Promise<QingyanCreateResponse> {
  if (!isQingyanEnabled()) {
    throw new Error("Qingyan integration is not enabled");
  }

  const requestId = crypto.randomUUID();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${QINGYAN_API_BASE}/api/v1/projects`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${QINGYAN_API_TOKEN}`,
        "X-Source-System": "bidtogo",
        "X-Request-Id": requestId,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new QingyanApiError(
        body.error || `Qingyan API returned ${res.status}`,
        res.status,
        body as QingyanErrorResponse
      );
    }

    return (await res.json()) as QingyanCreateResponse;
  } catch (err) {
    if (err instanceof QingyanApiError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new QingyanApiError("Qingyan API request timed out", 408);
    }
    throw new QingyanApiError(
      err instanceof Error ? err.message : "Unknown error calling Qingyan API",
      0
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function verifyQingyanWebhookSignature(
  signature: string,
  timestamp: string,
  body: string
): boolean {
  if (!QINGYAN_WEBHOOK_SECRET) return false;

  const fiveMinutes = 5 * 60;
  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Math.abs(now - ts) > fiveMinutes) return false;

  const expected = crypto
    .createHmac("sha256", QINGYAN_WEBHOOK_SECRET)
    .update(`${timestamp}.${body}`)
    .digest("hex");

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export function mapFeasibilityToRiskLevel(
  score: number | null | undefined
): "low" | "medium" | "high" | "unassessed" {
  if (score == null) return "unassessed";
  if (score >= 70) return "low";
  if (score >= 40) return "medium";
  return "high";
}
