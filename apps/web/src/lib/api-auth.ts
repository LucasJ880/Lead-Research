import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import type { UserRole } from "@/types";

const UNAUTHORIZED = NextResponse.json(
  { error: "Unauthorized" },
  { status: 401 }
);

export async function requireAuth() {
  const session = await getServerSession(authOptions);
  if (!session) return { session: null, error: UNAUTHORIZED };
  return { session, error: null };
}

export function getSessionUser(session: unknown): {
  id: string | null;
  role: UserRole | null;
  name: string | null;
} {
  const s = session as {
    user?: {
      id?: string;
      role?: UserRole;
      name?: string;
    };
  } | null;
  return {
    id: s?.user?.id ?? null,
    role: s?.user?.role ?? null,
    name: s?.user?.name ?? null,
  };
}

export function hasRole(role: UserRole | null, allowed: UserRole[]): boolean {
  if (!role) return false;
  return allowed.includes(role);
}

export async function requireRole(allowed: UserRole[]) {
  const { session, error } = await requireAuth();
  if (error || !session) return { session: null, error: error ?? UNAUTHORIZED };
  const user = getSessionUser(session);
  if (!hasRole(user.role, allowed)) {
    return {
      session,
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { session, error: null };
}
