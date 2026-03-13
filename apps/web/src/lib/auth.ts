import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export const INACTIVITY_TIMEOUT_S = 30 * 60; // 30 minutes
const SESSION_MAX_AGE_S = 8 * 60 * 60; // 8 hours

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });

        if (!user) return null;

        const valid = await bcrypt.compare(
          credentials.password,
          user.passwordHash
        );

        if (!valid) return null;

        logAuthEvent(user.id, "login").catch(() => {});

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        };
      },
    }),
  ],
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_S },
  pages: { signIn: "/login" },
  callbacks: {
    async jwt({ token, user }) {
      const now = Math.floor(Date.now() / 1000);
      if (user) {
        token.id = user.id;
        token.role = (user as unknown as { role: string }).role;
        token.lastActivity = now;
      }

      if (token.lastActivity && now - (token.lastActivity as number) > INACTIVITY_TIMEOUT_S) {
        token.expired = true;
      } else {
        token.lastActivity = now;
      }

      return token;
    },
    async session({ session, token }) {
      if (token.expired) {
        throw new Error("Session expired due to inactivity");
      }
      if (session.user) {
        (session.user as unknown as { id: string }).id = token.id as string;
        (session.user as unknown as { role: string }).role =
          token.role as string;
      }
      (session as unknown as { lastActivity: number }).lastActivity =
        token.lastActivity as number;
      (session as unknown as { inactivityTimeout: number }).inactivityTimeout =
        INACTIVITY_TIMEOUT_S;
      return session;
    },
  },
  events: {
    async signOut({ token }) {
      if (token?.id) {
        logAuthEvent(token.id as string, "logout").catch(() => {});
      }
    },
  },
};

async function logAuthEvent(userId: string, action: string, metadata?: Record<string, unknown>) {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        entityType: "session",
        metadata: (metadata ?? {}) as Record<string, string>,
      },
    });
  } catch {
    // Non-critical — don't break auth flow
  }
}
