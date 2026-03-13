"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useCallback, type ReactNode } from "react";
import { useSession, signOut } from "next-auth/react";
import {
  LayoutDashboard,
  FileSearch,
  Globe,
  Bookmark,
  Settings,
  ChevronLeft,
  ChevronRight,
  Search,
  LogOut,
  Sparkles,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_SECTIONS = [
  {
    label: "Intelligence",
    items: [
      { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
      { href: "/dashboard/opportunities", label: "Opportunities", icon: FileSearch },
      { href: "/dashboard/intelligence", label: "AI Analysis", icon: Sparkles },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/dashboard/sources", label: "Sources", icon: Globe },
      { href: "/dashboard/logs", label: "Crawl Logs", icon: Activity },
      { href: "/dashboard/saved-searches", label: "Saved Searches", icon: Bookmark },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/dashboard/settings", label: "Settings", icon: Settings },
    ],
  },
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

  const [showExpiryWarning, setShowExpiryWarning] = useState(false);

  const checkSessionTimeout = useCallback(() => {
    const s = session as unknown as { lastActivity?: number; inactivityTimeout?: number } | null;
    if (!s?.lastActivity || !s?.inactivityTimeout) return;
    const elapsed = Math.floor(Date.now() / 1000) - s.lastActivity;
    const remaining = s.inactivityTimeout - elapsed;
    if (remaining <= 5 * 60 && remaining > 0) {
      setShowExpiryWarning(true);
    } else {
      setShowExpiryWarning(false);
    }
    if (remaining <= 0) {
      signOut({ callbackUrl: "/login?expired=inactivity" });
    }
  }, [session]);

  useEffect(() => {
    const interval = setInterval(checkSessionTimeout, 30_000);
    return () => clearInterval(interval);
  }, [checkSessionTimeout]);

  function isActive(href: string) {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside
        className={cn(
          "flex flex-col bg-sidebar transition-all duration-200 ease-in-out border-r border-sidebar-border",
          collapsed ? "w-[60px]" : "w-60"
        )}
      >
        {/* Brand */}
        <div className="flex h-14 items-center gap-2.5 px-4 shrink-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" className="h-5 w-5">
              <rect x="6" y="6" width="14" height="3.5" rx="1.2" fill="#fff" opacity="0.35"/>
              <rect x="6" y="11.5" width="17" height="3.5" rx="1.2" fill="#fff" opacity="0.55"/>
              <rect x="6" y="17" width="17" height="3.5" rx="1.2" fill="#fff" opacity="0.85"/>
              <path d="M13 23.5l5.5-2.5-5.5-2.5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          {!collapsed && (
            <span className="text-base font-bold text-white tracking-tight">
              BidToGo
            </span>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto scrollbar-thin px-2 py-2">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label} className="mb-4">
              {!collapsed && (
                <div className="px-3 mb-1.5">
                  <span className="text-2xs font-semibold uppercase tracking-widest text-sidebar-muted">
                    {section.label}
                  </span>
                </div>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "group flex items-center gap-2.5 rounded-md px-3 py-[7px] text-[13px] font-medium transition-colors relative",
                        active
                          ? "bg-sidebar-accent text-white"
                          : "text-sidebar-foreground/60 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground"
                      )}
                      title={collapsed ? item.label : undefined}
                    >
                      {active && (
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-full bg-blue-400" />
                      )}
                      <item.icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span>{item.label}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* User + Collapse */}
        <div className="border-t border-sidebar-border px-2 py-2 shrink-0 space-y-1">
          {!collapsed && session?.user?.email && (
            <div className="px-3 py-1.5 mb-1">
              <p className="text-xs font-medium text-sidebar-foreground/80 truncate">
                {session.user.name ?? "Admin"}
              </p>
              <p className="text-2xs text-sidebar-muted truncate">
                {session.user.email}
              </p>
            </div>
          )}
          <div className="flex items-center justify-between">
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="flex items-center gap-2 rounded-md px-3 py-1.5 text-2xs text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent/40 transition-colors"
              title="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
              {!collapsed && <span>Sign out</span>}
            </button>
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="rounded-md p-1.5 text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent/40 transition-colors"
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top header */}
        <header className="flex h-12 shrink-0 items-center justify-between border-b bg-background px-5">
          {/* Breadcrumb */}
          <div className="flex items-center gap-1.5 text-xs min-w-0">
            <Link href="/dashboard" className="text-muted-foreground hover:text-foreground transition-colors font-medium shrink-0">
              BidToGo
            </Link>
            {(() => {
              const segments = pathname.replace("/dashboard", "").split("/").filter(Boolean);
              if (segments.length === 0) return null;
              const labels: Record<string, string> = {
                opportunities: "Opportunities", intelligence: "AI Analysis", sources: "Sources",
                logs: "Crawl Logs", settings: "Settings", "saved-searches": "Saved Searches",
              };
              const isDetailPage = segments.length >= 2 && segments[0] === "opportunities";
              return (
                <>
                  <span className="text-muted-foreground/40">/</span>
                  {isDetailPage ? (
                    <>
                      <Link href="/dashboard/opportunities" className="text-muted-foreground hover:text-foreground transition-colors font-medium shrink-0">
                        Opportunities
                      </Link>
                      <span className="text-muted-foreground/40">/</span>
                      <span className="font-medium truncate max-w-[300px]">Detail</span>
                    </>
                  ) : (
                    <span className="font-medium">{labels[segments[0]] || segments[0].replace(/-/g, " ")}</span>
                  )}
                </>
              );
            })()}
          </div>

          {/* Search */}
          <form onSubmit={handleSearch} className="flex items-center">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-7 w-52 rounded-md border border-input bg-muted/40 pl-8 pr-8 text-xs placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring focus:bg-background transition-colors"
              />
              <kbd className="absolute right-2 top-1/2 -translate-y-1/2 hidden sm:inline-flex h-4 items-center rounded border border-input bg-muted px-1 text-2xs text-muted-foreground font-mono">
                /
              </kbd>
            </div>
          </form>
        </header>

        {/* Session expiry warning */}
        {showExpiryWarning && (
          <div className="flex items-center justify-between bg-amber-50 border-b border-amber-200 px-5 py-2 shrink-0">
            <p className="text-xs text-amber-800 font-medium">
              Your session will expire soon due to inactivity. Interact with the page to stay signed in.
            </p>
            <button
              onClick={() => { setShowExpiryWarning(false); fetch("/api/auth/session"); }}
              className="rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 transition-colors shrink-0"
            >
              Stay Signed In
            </button>
          </div>
        )}

        {/* Page content */}
        <main className="flex-1 overflow-y-auto bg-muted/20 p-5 scrollbar-thin">
          <div className="animate-fade-in">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
