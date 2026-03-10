import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const UNAUTHORIZED = NextResponse.json(
  { error: "Unauthorized" },
  { status: 401 }
);

export async function requireAuth() {
  const session = await getServerSession(authOptions);
  if (!session) return { session: null, error: UNAUTHORIZED };
  return { session, error: null };
}
