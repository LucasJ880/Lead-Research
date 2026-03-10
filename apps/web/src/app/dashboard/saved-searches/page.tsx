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
import { formatDate } from "@/lib/utils";
import type { SavedSearch } from "@/types";

const FILTER_LABELS: Record<string, string> = {
  keyword: "Keyword",
  bucket: "Relevance",
  status: "Status",
  country: "Country",
  workflow: "Stage",
  tag: "Tag",
  sort: "Sort",
  minRelevance: "Min Score",
  closingAfter: "Closing After",
  closingBefore: "Closing Before",
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
      alert("Failed to save search. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/saved-searches/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete search");
      fetchSearches();
    } catch {
      alert("Failed to delete search. Please try again.");
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
          <h1 className="text-2xl font-bold tracking-tight">Saved Searches</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Save filter combinations to quickly access them later
          </p>
        </div>
        <Button size="sm" onClick={() => setShowForm(!showForm)}>
          <Plus className="mr-2 h-4 w-4" />
          New Search
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1">
                <label className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">Name *</label>
                <Input
                  placeholder="e.g. Ontario Window Coverings"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                />
              </div>
              <div className="space-y-1">
                <label className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">Keyword</label>
                <Input
                  placeholder="e.g. blinds, shades"
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">Relevance</label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                  value={newBucket}
                  onChange={(e) => setNewBucket(e.target.value)}
                >
                  <option value="">Any</option>
                  <option value="highly_relevant">Highly Relevant</option>
                  <option value="moderately_relevant">Moderately Relevant</option>
                  <option value="low_relevance">Low Relevance</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">Country</label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                  value={newCountry}
                  onChange={(e) => setNewCountry(e.target.value)}
                >
                  <option value="">Any</option>
                  <option value="US">United States</option>
                  <option value="CA">Canada</option>
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Button onClick={handleSave} disabled={!newName.trim() || saving} size="sm">
                {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Bookmark className="mr-2 h-3.5 w-3.5" />}
                Save Search
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setShowForm(false); setNewName(""); setNewKeyword(""); setNewBucket(""); setNewCountry(""); }}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
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
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-2xs font-medium uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Filters</th>
                <th className="px-4 py-3 whitespace-nowrap">Created</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {searches.map((search) => {
                const chips = formatFilterDisplay(search.filters);
                return (
                  <tr key={search.id} className="hover:bg-muted/50 transition-colors group">
                    <td className="px-4 py-3 font-medium">
                      <div className="flex items-center gap-2">
                        <Bookmark className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        {search.name}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {chips.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {chips.map((c, i) => (
                            <Badge key={i} variant="outline" className="text-2xs gap-1">
                              <span className="text-muted-foreground">{c.label}:</span> {c.value}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">All opportunities</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(search.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          onClick={() => handleApply(search)}
                        >
                          <ExternalLink className="h-3 w-3" />
                          Apply
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
                    </td>
                  </tr>
                );
              })}
              {!loading && searches.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center">
                    <Search className="mx-auto h-8 w-8 text-muted-foreground/40 mb-2" />
                    <p className="text-sm text-muted-foreground">No saved searches yet.</p>
                    <p className="text-xs text-muted-foreground mt-1">Create a search above with your common filter combinations.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
