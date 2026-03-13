"use client";

import { useState, useCallback, useEffect } from "react";
import {
  Play,
  Loader2,
  RefreshCw,
  Shield,
  Zap,
  Tags,
  Filter,
  Globe,
  ToggleLeft,
  ToggleRight,
  Database,
  Activity,
  AlertTriangle,
  Info,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const PRIMARY_KEYWORDS = [
  "blinds", "blind", "roller shade", "roller shades", "roller blind", "roller blinds",
  "zebra blind", "zebra blinds", "window covering", "window coverings",
  "shade", "shades", "curtain", "curtains", "drapery", "drape", "drapes",
  "window treatment", "motorized shades", "solar shades", "blackout shades",
  "skylight shades", "privacy curtain", "cubicle curtain", "hospital curtain",
  "drapery track", "window blind", "venetian blinds", "vertical blinds",
];

const SECONDARY_KEYWORDS = [
  "fabric", "textile", "linen", "bedding", "blankets", "sheet", "sheets",
  "privacy curtains", "cubicle curtains", "healthcare curtain",
  "soft furnishing", "furnishing", "interior furnishing", "furniture",
  "FF&E", "hotel linen", "hospital linen", "hospitality linen",
  "interior finishing", "interior finishings", "interior fit-out",
  "towel", "duvet", "comforter", "pillow", "mattress cover",
];

const CONTEXT_KEYWORDS = [
  "hospital renovation", "school renovation", "hotel renovation",
  "tenant improvement", "interior fit-out", "furnishing package",
  "furnishing supply", "linen supply", "textile supply",
  "window treatment replacement", "privacy divider replacement",
  "condo furnishing", "apartment furnishing", "senior living",
  "patient room", "dormitory", "long-term care",
];

const NEGATIVE_KEYWORDS = [
  "watermain", "sewer", "asphalt", "bridge", "road repair", "road construction",
  "software", "ERP", "IT consulting", "cloud migration", "cyber security",
  "legal services", "audit services", "fuel supply", "fleet maintenance",
  "snow removal", "heavy equipment", "paving", "excavat", "culvert",
  "pharmaceutical", "policing", "ambulance", "demolition only",
  "vehicles", "diesel", "landscaping", "waste management",
];

export default function SettingsPage() {
  const [crawlRunning, setCrawlRunning] = useState(false);
  const [crawlMessage, setCrawlMessage] = useState<string | null>(null);
  const [recalcRunning, setRecalcRunning] = useState(false);
  const [recalcMessage, setRecalcMessage] = useState<string | null>(null);
  const [businessFocus, setBusinessFocus] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("bidtogo_business_focus");
    if (stored !== null) setBusinessFocus(stored === "true");
  }, []);

  function toggleBusinessFocus() {
    const next = !businessFocus;
    setBusinessFocus(next);
    localStorage.setItem("bidtogo_business_focus", String(next));
  }

  const triggerCrawl = useCallback(async () => {
    setCrawlRunning(true);
    setCrawlMessage(null);
    try {
      const res = await fetch("/api/crawler/trigger", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      setCrawlMessage(res.ok
        ? `Crawler dispatched — ${body.dispatched ?? "?"} sources queued.`
        : `Error: ${body.error || res.statusText}`);
    } catch {
      setCrawlMessage("Failed to connect to crawler service.");
    } finally {
      setCrawlRunning(false);
    }
  }, []);

  const recalcSources = useCallback(async () => {
    setRecalcRunning(true);
    setRecalcMessage(null);
    try {
      const res = await fetch("/api/sources/recalculate", { method: "POST" });
      if (!res.ok) throw new Error("Recalculation failed");
      const body = await res.json();
      setRecalcMessage(`Updated ${body.sourcesUpdated ?? "?"} sources at ${new Date(body.recalculatedAt).toLocaleTimeString()}.`);
    } catch {
      setRecalcMessage("Failed to recalculate source analytics.");
    } finally {
      setRecalcRunning(false);
    }
  }, []);


  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Platform configuration, admin actions, and intelligence reference
        </p>
      </div>

      <Tabs defaultValue="general">
        <TabsList className="w-full justify-start mb-4">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="crawling">Crawling</TabsTrigger>
          <TabsTrigger value="keywords">Keywords</TabsTrigger>
          <TabsTrigger value="system">System</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4">
      {/* ─── Business Focus Mode ─── */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-violet-500" />
              <CardTitle className="text-base font-semibold">Business Focus Mode</CardTitle>
            </div>
            <button
              onClick={toggleBusinessFocus}
              className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
            >
              {businessFocus
                ? <><ToggleRight className="h-5 w-5 text-emerald-500" /> <span className="text-emerald-700">Enabled</span></>
                : <><ToggleLeft className="h-5 w-5 text-muted-foreground" /> <span className="text-muted-foreground">Disabled</span></>
              }
            </button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            When enabled, the dashboard suppresses low-relevance noise and emphasizes opportunities matching the
            window covering, textile, and interior furnishing vertical. This preference is saved in your browser.
          </p>
          <div className="mt-3 flex items-center gap-2 text-xs">
            <Badge className={businessFocus ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-500 border-slate-200"}>
              {businessFocus ? "Relevant + Highly Relevant shown by default" : "All buckets visible"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* ─── Admin Actions ─── */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-500" />
            <CardTitle className="text-base font-semibold">Admin Actions</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border p-4 space-y-3">
              <h3 className="text-sm font-semibold">Run Crawlers</h3>
              <p className="text-xs text-muted-foreground">
                Dispatch crawlers for all active sources. Opportunities are auto-scored against the current keyword model.
              </p>
              <Button onClick={triggerCrawl} disabled={crawlRunning} size="sm">
                {crawlRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                Run All Crawlers
              </Button>
              {crawlMessage && <p className="text-xs text-muted-foreground">{crawlMessage}</p>}
            </div>

            <div className="rounded-lg border p-4 space-y-3">
              <h3 className="text-sm font-semibold">Recalculate Source Analytics</h3>
              <p className="text-xs text-muted-foreground">
                Update yield analytics, health status, and opportunity counts for all sources.
              </p>
              <Button onClick={recalcSources} disabled={recalcRunning} variant="outline" size="sm">
                {recalcRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Recalculate
              </Button>
              {recalcMessage && <p className="text-xs text-muted-foreground">{recalcMessage}</p>}
            </div>
          </div>
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="crawling" className="space-y-4">
      {/* ─── Source Status Overview ─── */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-indigo-500" />
            <CardTitle className="text-base font-semibold">Source Status</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                <h3 className="text-sm font-semibold">SAM.gov</h3>
                <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]">Active</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Primary working source. API-based extraction via public SAM.gov endpoints. Crawls run automatically.
              </p>
            </div>
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                <h3 className="text-sm font-semibold">MERX</h3>
                <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px]">Limited</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Parser and auth framework implemented. Cloud execution limited by source access restrictions.
                Designed for local authenticated connector mode.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50/50 p-3">
            <Info className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
            <p className="text-xs text-blue-800">
              Source details, crawl history, and health metrics are available on the <a href="/dashboard/sources" className="font-medium underline">Sources</a> page.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ─── Crawl Schedule Reference ─── */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Globe className="h-5 w-5 text-blue-500" />
              <CardTitle className="text-base font-semibold">Crawl Schedule Reference</CardTitle>
            </div>
            <Badge variant="outline" className="text-[10px]">Read-only</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="rounded-md bg-red-50 border border-red-200 p-3">
              <p className="font-semibold text-red-700">Critical / High-Fit (≥60)</p>
              <p className="text-red-600 mt-1">Every 6 hours</p>
              <p className="text-muted-foreground">Major aggregators, provincial portals</p>
            </div>
            <div className="rounded-md bg-blue-50 border border-blue-200 p-3">
              <p className="font-semibold text-blue-700">Medium-Fit (30–59)</p>
              <p className="text-blue-600 mt-1">Twice daily</p>
              <p className="text-muted-foreground">Municipal, school board portals</p>
            </div>
            <div className="rounded-md bg-slate-50 border border-slate-200 p-3">
              <p className="font-semibold text-slate-700">Low-Fit (&lt;30)</p>
              <p className="text-slate-600 mt-1">Weekly</p>
              <p className="text-muted-foreground">Niche portals, experimental</p>
            </div>
          </div>
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="keywords" className="space-y-4">
      {/* ─── Industry Keyword Dictionary ─── */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Tags className="h-5 w-5 text-emerald-500" />
              <CardTitle className="text-base font-semibold">Industry Keyword Dictionary</CardTitle>
            </div>
            <Badge variant="outline" className="text-[10px]">Read-only</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-xs text-muted-foreground">
            These keywords are configured in the crawler scoring engine. Contact the admin to modify.
          </p>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-emerald-700">Primary Keywords <span className="font-normal text-muted-foreground">(highest weight)</span></h3>
            <div className="flex flex-wrap gap-1.5">
              {PRIMARY_KEYWORDS.map((kw) => (
                <Badge key={kw} variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">{kw}</Badge>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-blue-700">Secondary Keywords <span className="font-normal text-muted-foreground">(medium weight)</span></h3>
            <div className="flex flex-wrap gap-1.5">
              {SECONDARY_KEYWORDS.map((kw) => (
                <Badge key={kw} variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-xs">{kw}</Badge>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-violet-700">Contextual Terms <span className="font-normal text-muted-foreground">(bonus weight)</span></h3>
            <div className="flex flex-wrap gap-1.5">
              {CONTEXT_KEYWORDS.map((kw) => (
                <Badge key={kw} variant="outline" className="bg-violet-50 text-violet-700 border-violet-200 text-xs">{kw}</Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ─── Negative Keyword Filters ─── */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter className="h-5 w-5 text-red-500" />
              <CardTitle className="text-base font-semibold">Negative Keyword Filters</CardTitle>
            </div>
            <Badge variant="outline" className="text-[10px]">Read-only</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Opportunities containing these terms receive heavy score penalties.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {NEGATIVE_KEYWORDS.map((kw) => (
              <Badge key={kw} variant="outline" className="bg-red-50 text-red-600 border-red-200 text-xs">{kw}</Badge>
            ))}
          </div>
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="system" className="space-y-4">
      {/* ─── Relevance Scoring Reference ─── */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-violet-500" />
              <CardTitle className="text-base font-semibold">Relevance Scoring Model</CardTitle>
            </div>
            <Badge variant="outline" className="text-[10px]">Read-only</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Every opportunity is scored 0–100 using keyword matching, semantic patterns, source fit bonus, title boost, and negative penalties.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="pb-2 pr-4">Bucket</th>
                  <th className="pb-2 pr-4">Score</th>
                  <th className="pb-2 pr-4">Default</th>
                  <th className="pb-2">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y text-xs">
                {[
                  { b: "Highly Relevant", color: "bg-emerald-100 text-emerald-700 border-emerald-200", s: "70–100", d: "Shown", desc: "Direct product keyword in title or description" },
                  { b: "Moderately Relevant", color: "bg-blue-100 text-blue-700 border-blue-200", s: "40–69", d: "Shown", desc: "Secondary keyword or contextual renovation signal" },
                  { b: "Low Relevance", color: "bg-amber-100 text-amber-700 border-amber-200", s: "15–39", d: "Hidden", desc: "Weak contextual signal, broad renovation" },
                  { b: "Irrelevant", color: "bg-slate-100 text-slate-500 border-slate-200", s: "0–14", d: "Hidden", desc: "No match or strong negative signals" },
                ].map(r => (
                  <tr key={r.b}>
                    <td className="py-2 pr-4"><Badge className={`${r.color} text-xs`}>{r.b}</Badge></td>
                    <td className="py-2 pr-4 text-muted-foreground">{r.s}</td>
                    <td className="py-2 pr-4"><Badge variant="outline" className="text-[10px]">{r.d}</Badge></td>
                    <td className="py-2 text-muted-foreground">{r.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ─── System Info ─── */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-slate-500" />
            <CardTitle className="text-base font-semibold">System Information</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-lg border p-4 space-y-2">
              <h3 className="text-sm font-semibold">Safety Rules</h3>
              <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
                <li>Only publicly accessible pages are fetched</li>
                <li>robots.txt is respected for every domain</li>
                <li>Rate limiting enforced (min 2–3s between requests)</li>
                <li>No login, CAPTCHA, or paywall bypass</li>
                <li>All records originate from real fetched pages</li>
                <li>Unsupported sources are documented, not bypassed</li>
              </ul>
            </div>
            <div className="rounded-lg border p-4 space-y-2">
              <h3 className="text-sm font-semibold">Platform Stack</h3>
              <div className="grid grid-cols-2 gap-1.5 text-xs">
                <span className="text-muted-foreground">Frontend</span><span className="font-medium">Next.js 14 + shadcn/ui</span>
                <span className="text-muted-foreground">Auth</span><span className="font-medium">NextAuth.js (Credentials)</span>
                <span className="text-muted-foreground">Database</span><span className="font-medium">PostgreSQL 16 + Prisma</span>
                <span className="text-muted-foreground">Scraper</span><span className="font-medium">Python + FastAPI + Celery</span>
                <span className="text-muted-foreground">Task Queue</span><span className="font-medium">Celery + Redis</span>
                <span className="text-muted-foreground">Deployment</span><span className="font-medium">Docker Compose (DigitalOcean)</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
