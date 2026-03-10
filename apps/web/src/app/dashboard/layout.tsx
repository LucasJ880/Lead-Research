"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useSession, signOut } from "next-auth/react";
import {
  LayoutDashboard,
  FileSearch,
  Globe,
  Bookmark,
  ScrollText,
  Settings,
  ChevronLeft,
  ChevronRight,
  User,
  Search,
  LogOut,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/opportunities", label: "Opportunities", icon: FileSearch },
  { href: "/dashboard/intelligence", label: "AI Intelligence", icon: Sparkles },
  { href: "/dashboard/sources", label: "Sources", icon: Globe },
  { href: "/dashboard/saved-searches", label: "Saved Searches", icon: Bookmark },
  { href: "/dashboard/logs", label: "Logs", icon: ScrollText },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const { data: session } = useSession();

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/dashboard/opportunities?keyword=${encodeURIComponent(searchQuery.trim())}`);
      setSearchQuery("");
    }
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside
        className={cn(
          "flex flex-col bg-sidebar text-sidebar-foreground transition-all duration-300 ease-in-out",
          collapsed ? "w-16" : "w-64"
        )}
      >
        {/* Brand */}
        <div className="flex h-16 items-center gap-3 border-b border-white/10 px-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" className="h-5 w-5">
              <path d="M8 7h10l4 4v12a2 2 0 01-2 2H8a2 2 0 01-2-2V9a2 2 0 012-2z" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round"/>
              <path d="M18 7v4h4" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round"/>
              <circle cx="14" cy="17" r="4" fill="none" stroke="#fff" strokeWidth="2"/>
              <line x1="17" y1="20" x2="21" y2="24" stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>
          {!collapsed && (
            <span className="text-lg font-semibold tracking-tight">
              BidToGo
            </span>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-4 scrollbar-thin">
          {NAV_ITEMS.map((item) => {
            const isActive =
              item.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-white"
                    : "text-slate-300 hover:bg-sidebar-accent/50 hover:text-white"
                )}
                title={collapsed ? item.label : undefined}
              >
                <item.icon className="h-5 w-5 shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex h-12 items-center justify-center border-t border-white/10 text-slate-400 hover:text-white transition-colors"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      </aside>

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top header */}
        <header className="flex h-16 shrink-0 items-center justify-between border-b bg-background px-6">
          <form onSubmit={handleSearch} className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search opportunities…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 w-72 rounded-md border border-input bg-muted/50 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </form>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                <User className="h-4 w-4" />
              </div>
              <div className="hidden text-sm sm:block">
                <p className="font-medium leading-none">
                  {session?.user?.name ?? "Admin"}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {session?.user?.email ?? ""}
                </p>
              </div>
            </div>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              title="Logout"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto bg-muted/30 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
