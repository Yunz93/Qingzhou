import { randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

export const SESSION_COOKIE = "qingzhou_session";

/** Sliding session lifetime for loopback cookie auth (ms). */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

type SessionEntry = { expiresAt: number };

const sessions = new Map<string, SessionEntry>();

function pruneExpired(now = Date.now()): void {
  for (const [token, entry] of sessions) {
    if (entry.expiresAt <= now) sessions.delete(token);
  }
}

function touchSession(token: string, now = Date.now()): void {
  sessions.set(token, { expiresAt: now + SESSION_TTL_MS });
}

export function createSessionToken(now = Date.now()): string {
  pruneExpired(now);
  const token = randomBytes(32).toString("hex");
  touchSession(token, now);
  return token;
}

export function hasSession(token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const entry = sessions.get(token);
  if (!entry) return false;
  if (entry.expiresAt <= now) {
    sessions.delete(token);
    return false;
  }
  touchSession(token, now);
  return true;
}

export function ensureSessionCookie(request: FastifyRequest, reply: FastifyReply): string {
  const existing = request.cookies[SESSION_COOKIE];
  if (existing && hasSession(existing)) {
    return existing;
  }
  const token = createSessionToken();
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    secure: false,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return token;
}

export function readSessionToken(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  const parts = cookieHeader.split(";").map((part) => part.trim());
  for (const part of parts) {
    if (part.startsWith(`${SESSION_COOKIE}=`)) {
      return part.slice(SESSION_COOKIE.length + 1);
    }
  }
  return undefined;
}

/** Test helper: drop all in-memory sessions. */
export function clearSessionsForTests(): void {
  sessions.clear();
}

/** Test helper: force-expire a token without waiting. */
export function expireSessionForTests(token: string): void {
  const entry = sessions.get(token);
  if (entry) entry.expiresAt = 0;
}
