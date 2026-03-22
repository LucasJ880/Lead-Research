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
      setRecalcMessage(`已在 ${new Intl.DateTimeFormat("zh-CN", { timeZone: "America/Toronto", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true }).format(new Date(body.recalculatedAt))} 更新 ${body.sourcesUpdated ?? "?"} 个数据源。`);
    } catch {
      setRecalcMessage("Failed to recalculate source analytics.");
    } finally {
      setRecalcRunning(false);
    }
  }, []);


  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold tracking-tight">设置</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          平台配置、管理操作和情报参考
        </p>
      </div>

      <Tabs defaultValue="general">
        <TabsList className="w-full justify-start mb-4">
          <TabsTrigger value="general">通用</TabsTrigger>
          <TabsTrigger value="crawling">抓取</TabsTrigger>
          <TabsTrigger value="keywords">关键词</TabsTrigger>
          <TabsTrigger value="system">系统</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4">
      {/* ─── Business Focus Mode ─── */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-violet-500" />
              <CardTitle className="text-base font-semibold">业务聚焦模式</CardTitle>
            </div>
            <button
              onClick={toggleBusinessFocus}
              className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
            >
              {businessFocus
                ? <><ToggleRight className="h-5 w-5 text-emerald-500" /> <span className="text-emerald-700">已启用</span></>
                : <><ToggleLeft className="h-5 w-5 text-muted-foreground" /> <span className="text-muted-foreground">已禁用</span></>
              }
            </button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            启用后，仪表盘将抑制低关联度噪音，突出显示与窗帘、纺织品和室内装饰相关的机会。此偏好保存在浏览器中。
          </p>
          <div className="mt-3 flex items-center gap-2 text-xs">
            <Badge className={businessFocus ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-500 border-slate-200"}>
              {businessFocus ? "默认显示相关和高关联" : "显示全部分类"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* ─── Admin Actions ─── */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-500" />
            <CardTitle className="text-base font-semibold">管理操作</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border p-4 space-y-3">
              <h3 className="text-sm font-semibold">运行抓取器</h3>
              <p className="text-xs text-muted-foreground">
                对所有活跃数据源启动抓取。机会将根据当前关键词模型自动评分。
              </p>
              <Button onClick={triggerCrawl} disabled={crawlRunning} size="sm">
                {crawlRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                运行全部抓取
              </Button>
              {crawlMessage && <p className="text-xs text-muted-foreground">{crawlMessage}</p>}
            </div>

            <div className="rounded-lg border p-4 space-y-3">
              <h3 className="text-sm font-semibold">重新计算数据源分析</h3>
              <p className="text-xs text-muted-foreground">
                更新所有数据源的转化率分析、健康状态和机会计数。
              </p>
              <Button onClick={recalcSources} disabled={recalcRunning} variant="outline" size="sm">
                {recalcRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                重新计算
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
            <CardTitle className="text-base font-semibold">数据源状态</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                <h3 className="text-sm font-semibold">SAM.gov</h3>
                <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]">活跃</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                主要工作源。通过 SAM.gov 公共端点进行 API 提取。自动运行抓取。
              </p>
            </div>
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                <h3 className="text-sm font-semibold">MERX</h3>
                <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px]">受限</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                解析器和认证框架已实现。云端执行受源访问限制。设计为本地认证连接模式。
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50/50 p-3">
            <Info className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
            <p className="text-xs text-blue-800">
              数据源详情、抓取历史和健康指标请访问 <a href="/dashboard/sources" className="font-medium underline">数据源</a> 页面。
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
              <CardTitle className="text-base font-semibold">抓取调度参考</CardTitle>
            </div>
            <Badge variant="outline" className="text-[10px]">只读</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="rounded-md bg-red-50 border border-red-200 p-3">
              <p className="font-semibold text-red-700">关键 / 高匹配 (≥60)</p>
              <p className="text-red-600 mt-1">每 6 小时</p>
              <p className="text-muted-foreground">主要聚合器、省级门户</p>
            </div>
            <div className="rounded-md bg-blue-50 border border-blue-200 p-3">
              <p className="font-semibold text-blue-700">中匹配 (30–59)</p>
              <p className="text-blue-600 mt-1">每天两次</p>
              <p className="text-muted-foreground">市政、教育委员会门户</p>
            </div>
            <div className="rounded-md bg-slate-50 border border-slate-200 p-3">
              <p className="font-semibold text-slate-700">低匹配 (&lt;30)</p>
              <p className="text-slate-600 mt-1">每周</p>
              <p className="text-muted-foreground">小众门户、实验性</p>
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
              <CardTitle className="text-base font-semibold">行业关键词字典</CardTitle>
            </div>
            <Badge variant="outline" className="text-[10px]">只读</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-xs text-muted-foreground">
            这些关键词在抓取器评分引擎中配置。如需修改请联系管理员。
          </p>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-emerald-700">主要关键词 <span className="font-normal text-muted-foreground">(最高权重)</span></h3>
            <div className="flex flex-wrap gap-1.5">
              {PRIMARY_KEYWORDS.map((kw) => (
                <Badge key={kw} variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">{kw}</Badge>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-blue-700">次要关键词 <span className="font-normal text-muted-foreground">(中等权重)</span></h3>
            <div className="flex flex-wrap gap-1.5">
              {SECONDARY_KEYWORDS.map((kw) => (
                <Badge key={kw} variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-xs">{kw}</Badge>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-violet-700">上下文术语 <span className="font-normal text-muted-foreground">(加分权重)</span></h3>
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
              <CardTitle className="text-base font-semibold">负面关键词过滤</CardTitle>
            </div>
            <Badge variant="outline" className="text-[10px]">只读</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">
            包含这些术语的机会将受到严重扣分。
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
              <CardTitle className="text-base font-semibold">关联度评分模型</CardTitle>
            </div>
            <Badge variant="outline" className="text-[10px]">只读</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            每个机会按 0–100 评分，使用关键词匹配、语义模式、数据源匹配奖励、标题加成和负面惩罚。
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="pb-2 pr-4">分类</th>
                  <th className="pb-2 pr-4">分数</th>
                  <th className="pb-2 pr-4">默认</th>
                  <th className="pb-2">说明</th>
                </tr>
              </thead>
              <tbody className="divide-y text-xs">
                {[
                  { b: "高关联", color: "bg-emerald-100 text-emerald-700 border-emerald-200", s: "70–100", d: "显示", desc: "标题或描述中有直接产品关键词" },
                  { b: "中关联", color: "bg-blue-100 text-blue-700 border-blue-200", s: "40–69", d: "显示", desc: "次要关键词或上下文装修信号" },
                  { b: "低关联", color: "bg-amber-100 text-amber-700 border-amber-200", s: "15–39", d: "隐藏", desc: "弱上下文信号，广泛装修" },
                  { b: "无关联", color: "bg-slate-100 text-slate-500 border-slate-200", s: "0–14", d: "隐藏", desc: "无匹配或强负面信号" },
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
            <CardTitle className="text-base font-semibold">系统信息</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-lg border p-4 space-y-2">
              <h3 className="text-sm font-semibold">安全规则</h3>
              <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
                <li>仅抓取可公开访问的页面</li>
                <li>尊重每个域名的 robots.txt</li>
                <li>强制执行速率限制（请求间隔至少 2–3 秒）</li>
                <li>不绕过登录、验证码或付费墙</li>
                <li>所有记录均来自真实抓取的页面</li>
                <li>不支持的来源仅作记录，不予绕过</li>
              </ul>
            </div>
            <div className="rounded-lg border p-4 space-y-2">
              <h3 className="text-sm font-semibold">技术栈</h3>
              <div className="grid grid-cols-2 gap-1.5 text-xs">
                <span className="text-muted-foreground">前端</span><span className="font-medium">Next.js 14 + shadcn/ui</span>
                <span className="text-muted-foreground">认证</span><span className="font-medium">NextAuth.js (Credentials)</span>
                <span className="text-muted-foreground">数据库</span><span className="font-medium">PostgreSQL 16 + Prisma</span>
                <span className="text-muted-foreground">抓取器</span><span className="font-medium">Python + FastAPI + Celery</span>
                <span className="text-muted-foreground">任务队列</span><span className="font-medium">Celery + Redis</span>
                <span className="text-muted-foreground">部署</span><span className="font-medium">Docker Compose (DigitalOcean)</span>
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
