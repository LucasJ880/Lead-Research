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
  User,
  ChevronsUpDown,
  Bell,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";

const NAV_SECTIONS = [
  {
    label: "智能分析",
    items: [
      { href: "/dashboard", label: "概览", icon: LayoutDashboard },
      { href: "/dashboard/opportunities", label: "招标机会", icon: FileSearch },
      { href: "/dashboard/intelligence", label: "AI 分析", icon: Sparkles },
    ],
  },
  {
    label: "运营",
    items: [
      { href: "/dashboard/sources", label: "数据源", icon: Globe },
      { href: "/dashboard/logs", label: "抓取日志", icon: Activity },
      { href: "/dashboard/saved-searches", label: "保存搜索", icon: Bookmark },
    ],
  },
  {
    label: "系统",
    items: [
      { href: "/dashboard/settings", label: "设置", icon: Settings },
    ],
  },
];

function getBreadcrumbs(pathname: string) {
  const labels: Record<string, string> = {
    opportunities: "招标机会",
    intelligence: "AI 分析",
    sources: "数据源",
    logs: "抓取日志",
    settings: "设置",
    "saved-searches": "保存搜索",
  };
  const segments = pathname.replace("/dashboard", "").split("/").filter(Boolean);
  if (segments.length === 0) return [{ label: "概览", href: "/dashboard" }];

  const crumbs: { label: string; href?: string }[] = [];
  if (segments[0] === "opportunities") {
    crumbs.push({ label: "招标机会", href: "/dashboard/opportunities" });
    if (segments.length >= 2) {
      crumbs.push({ label: `#${segments[1].slice(0, 8)}` });
    }
  } else {
    crumbs.push({ label: labels[segments[0]] || segments[0].replace(/-/g, " ") });
  }
  return crumbs;
}

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

  const breadcrumbs = getBreadcrumbs(pathname);
  const userInitials = session?.user?.name
    ? session.user.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
    : "AD";

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside
        className={cn(
          "flex flex-col bg-sidebar transition-all duration-200 ease-in-out border-r border-sidebar-border",
          collapsed ? "w-[56px]" : "w-[220px]"
        )}
      >
        {/* Brand */}
        <div className={cn("flex h-14 items-center shrink-0 border-b border-sidebar-border", collapsed ? "justify-center px-2" : "gap-2.5 px-4")}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-blue-600">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" className="h-5 w-5">
              <rect x="6" y="6" width="14" height="3.5" rx="1.2" fill="#fff" opacity="0.35"/>
              <rect x="6" y="11.5" width="17" height="3.5" rx="1.2" fill="#fff" opacity="0.55"/>
              <rect x="6" y="17" width="17" height="3.5" rx="1.2" fill="#fff" opacity="0.85"/>
              <path d="M13 23.5l5.5-2.5-5.5-2.5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <span className="text-sm font-bold text-white tracking-tight block">BidToGo</span>
              <span className="text-[10px] text-sidebar-muted leading-none">采购情报</span>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto scrollbar-thin px-2 py-3">
          {NAV_SECTIONS.map((section, si) => (
            <div key={section.label} className={cn(si > 0 && "mt-4")}>
              {!collapsed && (
                <div className="px-3 mb-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-sidebar-muted">
                    {section.label}
                  </span>
                </div>
              )}
              {collapsed && si > 0 && (
                <Separator className="mx-auto mb-2 w-6 bg-sidebar-border" />
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "group flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] font-medium transition-colors relative",
                        collapsed && "justify-center px-0",
                        active
                          ? "bg-sidebar-accent text-white"
                          : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                      )}
                      title={collapsed ? item.label : undefined}
                    >
                      {active && (
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-full bg-blue-400" />
                      )}
                      <item.icon className={cn("h-4 w-4 shrink-0", active && "text-blue-400")} />
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
          {!collapsed ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-sidebar-accent/50 transition-colors">
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="bg-blue-600 text-[10px] font-bold text-white">{userInitials}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-sidebar-foreground/80 truncate">
                      {session?.user?.name ?? "Admin"}
                    </p>
                    <p className="text-[10px] text-sidebar-muted truncate">
                      {session?.user?.email ?? ""}
                    </p>
                  </div>
                  <ChevronsUpDown className="h-3.5 w-3.5 text-sidebar-muted shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col">
                    <p className="text-sm font-medium">{session?.user?.name ?? "Admin"}</p>
                    <p className="text-xs text-muted-foreground">{session?.user?.email ?? ""}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/dashboard/settings" className="cursor-pointer">
                    <Settings className="mr-2 h-4 w-4" />
                    设置
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  className="text-red-600 focus:text-red-600 cursor-pointer"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="mx-auto flex items-center justify-center rounded-md p-1.5 hover:bg-sidebar-accent/50 transition-colors">
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="bg-blue-600 text-[10px] font-bold text-white">{userInitials}</AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col">
                    <p className="text-sm font-medium">{session?.user?.name ?? "Admin"}</p>
                    <p className="text-xs text-muted-foreground">{session?.user?.email ?? ""}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/dashboard/settings" className="cursor-pointer">
                    <Settings className="mr-2 h-4 w-4" />
                    设置
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  className="text-red-600 focus:text-red-600 cursor-pointer"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={cn(
              "flex items-center justify-center rounded-md p-1.5 text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent/40 transition-colors",
              collapsed ? "mx-auto" : "ml-auto"
            )}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top header */}
        <header className="flex h-12 shrink-0 items-center justify-between border-b bg-card px-5">
          {/* Breadcrumb */}
          <div className="flex items-center gap-1.5 text-sm min-w-0">
            <Link href="/dashboard" className="text-muted-foreground hover:text-foreground transition-colors font-medium shrink-0">
              BidToGo
            </Link>
            {breadcrumbs.map((crumb, i) => (
              <span key={i} className="flex items-center gap-1.5">
                <span className="text-muted-foreground/40">/</span>
                {crumb.href ? (
                  <Link href={crumb.href} className="text-muted-foreground hover:text-foreground transition-colors font-medium shrink-0">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="font-medium truncate max-w-[300px]">{crumb.label}</span>
                )}
              </span>
            ))}
          </div>

          {/* Right header area */}
          <div className="flex items-center gap-3">
            <form onSubmit={handleSearch} className="flex items-center">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="搜索招标机会..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 w-56 rounded-md border bg-muted/40 pl-8 pr-8 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring focus:bg-background transition-colors"
                />
                <kbd className="absolute right-2 top-1/2 -translate-y-1/2 hidden sm:inline-flex h-5 items-center rounded border bg-muted px-1.5 text-[10px] text-muted-foreground font-mono">
                  /
                </kbd>
              </div>
            </form>
            <button className="relative rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <Bell className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Session expiry warning */}
        {showExpiryWarning && (
          <div className="flex items-center justify-between bg-amber-50 border-b border-amber-200 px-5 py-2 shrink-0">
            <p className="text-xs text-amber-800 font-medium">
              由于长时间未操作，您的会话即将过期。
            </p>
            <button
              onClick={() => { setShowExpiryWarning(false); fetch("/api/auth/session"); }}
              className="rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 transition-colors shrink-0"
            >
              保持登录
            </button>
          </div>
        )}

        {/* Page content */}
        <main className="flex-1 overflow-y-auto bg-background p-5 scrollbar-thin">
          <div className="animate-fade-in">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
