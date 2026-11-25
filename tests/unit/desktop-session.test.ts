import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import { createDesktopSession } from "../../apps/server/src/security/desktop-session";
import { clearSessionsForTests, SESSION_COOKIE } from "../../apps/server/src/security/session-cookie";

const requireFromServer = createRequire(new URL("../../apps/server/package.json", import.meta.url));
const Fastify = requireFromServer("fastify") as typeof import("fastify").default;
const cookie = requireFromServer("@fastify/cookie") as typeof import("@fastify/cookie").default;

const HOST = "127.0.0.1:42123";
const TICKET = "a".repeat(32);
const BOOTSTRAP = `/_desktop/bootstrap?ticket=${TICKET}`;

async function setup() {
  const app = Fastify();
  const session = createDesktopSession(TICKET);
  session.bind(`http://${HOST}`);
  await app.register(cookie);
  app.addHook("onRequest", async (request, reply) => session.protect(request, reply));
  app.get("/", () => "workbench");
  return app;
}

afterEach(clearSessionsForTests);

describe("desktop loopback authentication", () => {
  it("exchanges a single-use ticket for a session and denies anonymous requests", async () => {
    const app = await setup();
    try {
      expect((await app.inject({ url: "/", headers: { host: HOST } })).statusCode).toBe(401);
      const bootstrap = await app.inject({ url: BOOTSTRAP, headers: { host: HOST } });
      expect(bootstrap.statusCode).toBe(200);
      expect(bootstrap.headers["content-type"]).toContain("text/html");
      expect(bootstrap.body).toContain('content="0; url=/"');
      expect(bootstrap.headers["cache-control"]).toBe("no-store");
      expect(bootstrap.headers["referrer-policy"]).toBe("no-referrer");
      expect(bootstrap.headers["set-cookie"]).toMatch(/SameSite=Strict/i);
      const token = bootstrap.cookies.find(({ name }) => name === SESSION_COOKIE);
      expect(token?.httpOnly).toBe(true);
      expect((await app.inject({ url: BOOTSTRAP, headers: { host: HOST } })).statusCode).toBe(403);
      const authorized = await app.inject({ url: "/", headers: { host: HOST }, cookies: { [SESSION_COOKIE]: token!.value } });
      expect(authorized.body).toBe("workbench");
    } finally {
      await app.close();
    }
  });

  it("binds the ticket and cookie to the exact desktop service origin", async () => {
    const app = await setup();
    try {
      expect((await app.inject({ url: BOOTSTRAP, headers: { host: "localhost:42123" } })).statusCode).toBe(403);
      expect((await app.inject({ url: BOOTSTRAP, headers: { host: HOST, origin: "http://127.0.0.1:5173" } })).statusCode).toBe(403);
      expect((await app.inject({ url: BOOTSTRAP, headers: { host: HOST } })).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
