"use client";

import { Suspense, useState, useEffect } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Lock, Mail, ShieldCheck, Zap, BarChart3 } from "lucide-react";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";
  const expired = searchParams.get("expired");

  useEffect(() => {
    if (status === "authenticated") {
      router.replace(callbackUrl);
    }
  }, [status, router, callbackUrl]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError("邮箱或密码错误");
      return;
    }

    router.push(callbackUrl);
    router.refresh();
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[hsl(222,47%,5%)]">
      {/* Animated gradient background */}
      <div className="absolute inset-0">
        <div className="absolute -left-40 -top-40 h-[600px] w-[600px] rounded-full bg-blue-600/10 blur-[120px]" />
        <div className="absolute -bottom-32 -right-32 h-[500px] w-[500px] rounded-full bg-indigo-600/8 blur-[100px]" />
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[800px] w-[800px] rounded-full bg-blue-500/5 blur-[150px]" />
        <div className="grid-pattern absolute inset-0 opacity-30" />
      </div>

      {/* Main card */}
      <div className="relative z-10 w-full max-w-[420px] px-4">
        {/* Branding */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg shadow-blue-500/25">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" className="h-8 w-8">
              <rect x="6" y="6" width="14" height="3.5" rx="1.2" fill="#fff" opacity="0.35"/>
              <rect x="6" y="11.5" width="17" height="3.5" rx="1.2" fill="#fff" opacity="0.55"/>
              <rect x="6" y="17" width="17" height="3.5" rx="1.2" fill="#fff" opacity="0.85"/>
              <path d="M13 23.5l5.5-2.5-5.5-2.5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">BidToGo</h1>
          <p className="mt-1 text-sm text-slate-400">采购情报平台</p>
        </div>

        {/* Login card */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-8 shadow-2xl backdrop-blur-xl">
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-white">欢迎回来</h2>
            <p className="mt-1 text-sm text-slate-400">
              登录您的情报仪表盘
            </p>
          </div>

          {expired === "inactivity" && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-300">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              会话因长时间未操作已过期
            </div>
          )}

          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
              <Lock className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-sm font-medium text-slate-300">
                邮箱地址
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <Input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  className="h-11 border-white/10 bg-white/5 pl-10 text-white placeholder:text-slate-500 focus:border-blue-500/50 focus:ring-blue-500/30"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm font-medium text-slate-300">
                密码
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <Input
                  id="password"
                  type="password"
                  placeholder="输入密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-11 border-white/10 bg-white/5 pl-10 text-white placeholder:text-slate-500 focus:border-blue-500/50 focus:ring-blue-500/30"
                />
              </div>
            </div>

            <Button
              type="submit"
              className="h-11 w-full bg-blue-600 font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  登录中...
                </>
              ) : (
                "登录"
              )}
            </Button>
          </form>
        </div>

        {/* Feature pills */}
        <div className="mt-6 flex items-center justify-center gap-4">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Zap className="h-3.5 w-3.5 text-blue-400" />
            <span>AI 驱动</span>
          </div>
          <div className="h-3 w-px bg-slate-700" />
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <BarChart3 className="h-3.5 w-3.5 text-emerald-400" />
            <span>实时数据</span>
          </div>
          <div className="h-3 w-px bg-slate-700" />
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5 text-amber-400" />
            <span>企业级</span>
          </div>
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-slate-600">
          &copy; {new Date().getFullYear()} BidToGo · 北美采购情报
        </p>
      </div>
    </div>
  );
}
