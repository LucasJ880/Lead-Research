import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, parseISO } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(
  date: string | Date | null | undefined,
  pattern = "MMM d, yyyy"
): string {
  if (!date) return "—";
  const d = typeof date === "string" ? parseISO(date) : date;
  return format(d, pattern);
}

export function formatCurrency(
  amount: number | null | undefined,
  currency = "USD"
): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-US", {
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
    highly_relevant: "Highly Relevant",
    moderately_relevant: "Moderate",
    low_relevance: "Low",
    irrelevant: "Irrelevant",
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
    new: "New",
    hot: "Hot",
    review: "Review",
    shortlisted: "Shortlisted",
    pursuing: "Pursuing",
    bid_submitted: "Bid Submitted",
    won: "Won",
    lost: "Lost",
    passed: "Passed",
    not_relevant: "Not Relevant",
    monitor: "Monitor",
    rfq_sent: "RFQ Sent",
    bid_drafted: "Bid Drafted",
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
