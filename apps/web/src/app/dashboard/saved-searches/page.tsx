"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Bookmark,
  Plus,
  Trash2,
  Bell,
  BellOff,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import type { SavedSearch } from "@/types";

export default function SavedSearchesPage() {
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
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
    try {
      const res = await fetch("/api/saved-searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), filters: {} }),
      });
      if (!res.ok) throw new Error("Failed to save search");
      setNewName("");
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
      const res = await fetch(`/api/saved-searches/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete search");
      fetchSearches();
    } catch {
      alert("Failed to delete search. Please try again.");
    } finally {
      setDeletingId(null);
    }
  }

  function formatFilters(filters: Record<string, string | number>): string {
    const entries = Object.entries(filters).filter(
      ([, v]) => v !== "" && v !== 0
    );
    if (entries.length === 0) return "No filters";
    return entries
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Saved Searches</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your saved search filters and notifications
          </p>
        </div>
        <Button size="sm" onClick={() => setShowForm(!showForm)}>
          <Plus className="mr-2 h-4 w-4" />
          Save Current Search
        </Button>
      </div>

      {/* Inline save form */}
      {showForm && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-end gap-3">
              <div className="flex-1 space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Search Name
                </label>
                <Input
                  placeholder="e.g. Ontario Window Coverings"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSave();
                  }}
                />
              </div>
              <Button onClick={handleSave} disabled={!newName.trim() || saving}>
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Bookmark className="mr-2 h-4 w-4" />
                )}
                Save
              </Button>
              <Button variant="outline" onClick={() => { setShowForm(false); setNewName(""); }}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {error && (
        <Card>
          <CardContent className="p-6 text-center text-sm text-destructive">
            {error}
          </CardContent>
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
              <tr className="border-b text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Filters</th>
                <th className="px-4 py-3 text-center">Notify</th>
                <th className="px-4 py-3 text-center">Results</th>
                <th className="px-4 py-3 whitespace-nowrap">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {searches.map((search) => (
                <tr key={search.id} className="hover:bg-muted/50 transition-colors">
                  <td className="px-4 py-3 font-medium">
                    <div className="flex items-center gap-2">
                      <Bookmark className="h-4 w-4 text-muted-foreground shrink-0" />
                      {search.name}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground max-w-[300px]">
                    <span className="line-clamp-1 text-xs">
                      {formatFilters(search.filters)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {search.notify ? (
                      <Badge variant="success" className="text-xs">
                        <Bell className="mr-1 h-3 w-3" /> On
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs">
                        <BellOff className="mr-1 h-3 w-3" /> Off
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center text-muted-foreground">
                    {search.resultCount ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {formatDate(search.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDelete(search.id)}
                      disabled={deletingId === search.id}
                    >
                      {deletingId === search.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </td>
                </tr>
              ))}
              {!loading && searches.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    No saved searches yet. Use the button above to save your first search.
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
