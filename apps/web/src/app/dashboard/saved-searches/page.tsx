"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Bookmark,
  Plus,
  Trash2,
  Loader2,
  Search,
  ExternalLink,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import type { SavedSearch } from "@/types";

const FILTER_LABELS: Record<string, string> = {
  keyword: "关键词",
  bucket: "关联度",
  status: "状态",
  country: "国家",
  workflow: "阶段",
  tag: "标签",
  sort: "排序",
  minRelevance: "最低评分",
  closingAfter: "截止日期之后",
  closingBefore: "截止日期之前",
};

function formatFilterDisplay(filters: Record<string, string | number>): { label: string; value: string }[] {
  return Object.entries(filters)
    .filter(([, v]) => v !== "" && v !== 0 && v !== "relevant")
    .map(([k, v]) => ({ label: FILTER_LABELS[k] || k, value: String(v) }));
}

function buildQueryString(filters: Record<string, string | number>): string {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== "" && v !== 0) params.set(k, String(v));
  });
  return params.toString();
}

export default function SavedSearchesPage() {
  const router = useRouter();
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKeyword, setNewKeyword] = useState("");
  const [newBucket, setNewBucket] = useState("");
  const [newCountry, setNewCountry] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const fetchSearches = useCallback(() => {
    setLoading(true);
    fetch("/api/saved-searches")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load saved searches");
        return res.json();
      })
      .then((data: SavedSearch[]) => {
        setSearches(data);
        setError(null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchSearches();
  }, [fetchSearches]);

  async function handleSave() {
    if (!newName.trim()) return;
    setSaveError(null);
    setSaving(true);
    const filters: Record<string, string> = {};
    if (newKeyword.trim()) filters.keyword = newKeyword.trim();
    if (newBucket) filters.bucket = newBucket;
    if (newCountry) filters.country = newCountry;
    try {
      const res = await fetch("/api/saved-searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), filters }),
      });
      if (!res.ok) throw new Error("Failed to save search");
      setNewName("");
      setNewKeyword("");
      setNewBucket("");
      setNewCountry("");
      setShowForm(false);
      fetchSearches();
    } catch {
      setSaveError("保存失败，请重试。");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setSaveError(null);
    setDeletingId(id);
    try {
      const res = await fetch(`/api/saved-searches/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete search");
      fetchSearches();
    } catch {
      setSaveError("删除失败，请重试。");
    } finally {
      setDeletingId(null);
    }
  }

  function handleApply(search: SavedSearch) {
    const qs = buildQueryString(search.filters);
    router.push(`/dashboard/opportunities${qs ? `?${qs}` : ""}`);
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">保存搜索</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            保存筛选组合以便快速访问
          </p>
        </div>
        <Button size="sm" onClick={() => setShowForm(!showForm)}>
          <Plus className="mr-2 h-4 w-4" />
          新建搜索
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1">
                <label className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">名称 *</label>
                <Input
                  placeholder="例如：安大略窗帘"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                />
              </div>
              <div className="space-y-1">
                <label className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">关键词</label>
                <Input
                  placeholder="例如：百叶窗、遮光帘"
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">关联度</label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                  value={newBucket}
                  onChange={(e) => setNewBucket(e.target.value)}
                >
                  <option value="">任意</option>
                  <option value="highly_relevant">高关联</option>
                  <option value="moderately_relevant">中关联</option>
                  <option value="low_relevance">低关联</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">国家</label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                  value={newCountry}
                  onChange={(e) => setNewCountry(e.target.value)}
                >
                  <option value="">任意</option>
                  <option value="US">美国</option>
                  <option value="CA">加拿大</option>
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Button onClick={handleSave} disabled={!newName.trim() || saving} size="sm">
                {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Bookmark className="mr-2 h-3.5 w-3.5" />}
                保存搜索
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setShowForm(false); setNewName(""); setNewKeyword(""); setNewBucket(""); setNewCountry(""); }}>
                取消
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {saveError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive flex items-center justify-between">
          <span>{saveError}</span>
          <button onClick={() => setSaveError(null)} className="text-xs font-medium hover:underline">关闭</button>
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="p-6 text-center text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <Card>
        <div className="overflow-x-auto relative">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow className="border-b text-left text-2xs font-medium uppercase tracking-wider text-muted-foreground">
                <TableHead className="px-4 py-3">名称</TableHead>
                <TableHead className="px-4 py-3">筛选条件</TableHead>
                <TableHead className="px-4 py-3 whitespace-nowrap">创建时间</TableHead>
                <TableHead className="px-4 py-3 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y">
              {searches.map((search) => {
                const chips = formatFilterDisplay(search.filters);
                return (
                  <TableRow key={search.id} className="hover:bg-muted/50 transition-colors group">
                    <TableCell className="px-4 py-3 font-medium">
                      <div className="flex items-center gap-2">
                        <Bookmark className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        {search.name}
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      {chips.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {chips.map((c, i) => (
                            <Badge key={i} variant="outline" className="text-2xs gap-1">
                              <span className="text-muted-foreground">{c.label}:</span> {c.value}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">全部机会</span>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(search.createdAt)}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          onClick={() => handleApply(search)}
                        >
                          <ExternalLink className="h-3 w-3" />
                          应用
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => handleDelete(search.id)}
                          disabled={deletingId === search.id}
                        >
                          {deletingId === search.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!loading && searches.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="px-4 py-12 text-center">
                    <Search className="mx-auto h-8 w-8 text-muted-foreground/40 mb-2" />
                    <p className="text-sm text-muted-foreground">暂无保存搜索。</p>
                    <p className="text-xs text-muted-foreground mt-1">在上方创建常用筛选组合的搜索。</p>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
