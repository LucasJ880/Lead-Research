import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const APP_TIMEZONE = "America/Toronto";
const APP_LOCALE = "zh-CN";

const PATTERN_OPTIONS: Record<string, Intl.DateTimeFormatOptions> = {
  "MMM d, yyyy": { month: "short", day: "numeric", year: "numeric" },
  "MMM d, h:mm a": { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true },
  "MMM d": { month: "short", day: "numeric" },
};

export function formatDate(
  date: string | Date | null | undefined,
  pattern = "MMM d, yyyy"
): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const opts = PATTERN_OPTIONS[pattern] ?? PATTERN_OPTIONS["MMM d, yyyy"];
  return new Intl.DateTimeFormat(APP_LOCALE, { ...opts, timeZone: APP_TIMEZONE }).format(d);
}

export function formatDateTime(
  date: string | Date | null | undefined
): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: APP_TIMEZONE,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(d);
}

export function formatCurrency(
  amount: number | null | undefined,
  currency = "USD"
): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat(APP_LOCALE, {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.slice(0, length).trimEnd() + "…";
}

export function getRelevanceColor(score: number): string {
  if (score >= 80) return "text-emerald-600 bg-emerald-50";
  if (score >= 60) return "text-blue-600 bg-blue-50";
  if (score >= 40) return "text-amber-600 bg-amber-50";
  if (score >= 20) return "text-orange-600 bg-orange-50";
  return "text-slate-500 bg-slate-50";
}

export function getBucketLabel(bucket: string): string {
  const labels: Record<string, string> = {
    highly_relevant: "高关联",
    moderately_relevant: "中关联",
    low_relevance: "低关联",
    irrelevant: "无关联",
  };
  return labels[bucket] ?? bucket;
}

export function getBucketColor(bucket: string): string {
  const colors: Record<string, string> = {
    highly_relevant: "text-emerald-700 bg-emerald-50 border-emerald-200",
    moderately_relevant: "text-blue-700 bg-blue-50 border-blue-200",
    low_relevance: "text-amber-700 bg-amber-50 border-amber-200",
    irrelevant: "text-slate-500 bg-slate-50 border-slate-200",
  };
  return colors[bucket] ?? "text-slate-500 bg-slate-50 border-slate-200";
}

export function getWorkflowLabel(status: string): string {
  const labels: Record<string, string> = {
    new: "新建",
    hot: "紧急",
    review: "待审",
    shortlisted: "候选",
    pursuing: "跟进中",
    bid_submitted: "已投标",
    won: "已中标",
    lost: "未中标",
    passed: "已跳过",
    not_relevant: "不相关",
    monitor: "监控",
    rfq_sent: "已发询价",
    bid_drafted: "标书草拟",
  };
  return labels[status] ?? status;
}

export function getWorkflowColor(status: string): string {
  const colors: Record<string, string> = {
    new: "text-slate-600 bg-slate-50 border-slate-200",
    hot: "text-red-700 bg-red-50 border-red-200",
    review: "text-amber-700 bg-amber-50 border-amber-200",
    shortlisted: "text-blue-700 bg-blue-50 border-blue-200",
    pursuing: "text-violet-700 bg-violet-50 border-violet-200",
    bid_submitted: "text-indigo-700 bg-indigo-50 border-indigo-200",
    won: "text-emerald-700 bg-emerald-50 border-emerald-200",
    lost: "text-red-700 bg-red-50 border-red-200",
    passed: "text-slate-500 bg-slate-50 border-slate-200",
    not_relevant: "text-slate-400 bg-slate-50 border-slate-200",
    monitor: "text-cyan-700 bg-cyan-50 border-cyan-200",
    rfq_sent: "text-teal-700 bg-teal-50 border-teal-200",
    bid_drafted: "text-purple-700 bg-purple-50 border-purple-200",
  };
  return colors[status] ?? "text-slate-500 bg-slate-50 border-slate-200";
}
