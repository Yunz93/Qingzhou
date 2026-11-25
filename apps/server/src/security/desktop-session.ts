import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ensureSessionCookie, hasSession, SESSION_COOKIE } from "./session-cookie.js";

export function createDesktopSession(initialTicket: string) {
  let ticket: string | undefined = initialTicket;
  let origin: URL | undefined;

  return {
    bind(address: string) {
      origin = new URL(address);
    },
    rotateTicket(next: string) {
      ticket = next;
    },
    protect(request: FastifyRequest, reply: FastifyReply) {
      if (!origin || request.headers.host !== origin.host) {
        return reply.code(403).send({ error: "host denied" });
      }
      if (request.headers.origin && request.headers.origin !== origin.origin) {
        return reply.code(403).send({ error: "origin denied" });
      }

      const target = new URL(request.url, origin);
      if (request.method === "GET" && target.pathname === "/_desktop/bootstrap") {
        const candidate = target.searchParams.get("ticket");
        if (!ticket || !candidate || candidate.length !== ticket.length ||
            Buffer.byteLength(candidate) !== Buffer.byteLength(ticket) ||
            !timingSafeEqual(Buffer.from(candidate), Buffer.from(ticket))) {
          return reply.code(403).send({ error: "invalid desktop ticket" });
        }
        ticket = undefined;
        ensureSessionCookie(request, reply);
        // WKWebView omits the Strict cookie on cross-site HTTP redirect chains.
        // Commit a loopback document before navigating to the workbench.
        return reply.header("Cache-Control", "no-store")
          .header("Referrer-Policy", "no-referrer")
          .type("text/html; charset=utf-8")
          .send('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=/"><title>墨问</title><a href="/">进入工作台</a></html>');
      }

      if (!hasSession(request.cookies[SESSION_COOKIE])) {
        return reply.code(401).send({ error: "desktop session required" });
      }
    },
  };
}

export type DesktopSession = ReturnType<typeof createDesktopSession>;
