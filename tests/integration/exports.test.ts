import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../apps/server/src/index.ts";

const fakePi = fileURLToPath(new URL("../fixtures/fake-pi.mjs", import.meta.url));

describe("html export route", () => {
  const root = { current: "" };
  let app: Awaited<ReturnType<typeof createApp>>["app"];
  let base = "";
  let dataDir = "";

  beforeAll(async () => {
    root.current = await mkdtemp(path.join(os.tmpdir(), "qingzhou-export-"));
    const project = path.join(root.current, "project");
    await mkdir(project);
    dataDir = path.join(root.current, "data");
    const created = await createApp({
      HOST: "127.0.0.1",
      PORT: "0",
      NODE_ENV: "test",
      PI_BIN: fakePi,
      QINGZHOU_DATA_DIR: dataDir,
      QINGZHOU_ALLOWED_ROOTS: root.current,
      QINGZHOU_MAX_PROCESSES: "1",
      QINGZHOU_MUTATIONS: "approval",
      QINGZHOU_HOME_DIR: root.current,
      QINGZHOU_SKIP_PI_TOOLS_FETCH: "1",
    });
    app = created.app;
    await app.listen({ host: created.config.host, port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    base = `http://${created.config.host}:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  async function cookieHeader(): Promise<string> {
    const health = await fetch(`${base}/health`);
    const cookie = health.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new Error("missing session cookie");
    return cookie;
  }

  it("serves html inside the data dir and rejects other files", async () => {
    const htmlPath = path.join(dataDir, "session.html");
    await writeFile(htmlPath, "<html><body>exported session</body></html>");
    const cookie = await cookieHeader();

    const ok = await fetch(`${base}/api/exports?path=${encodeURIComponent(htmlPath)}`, {
      headers: { cookie },
    });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toMatch(/text\/html/);
    const policy = ok.headers.get("content-security-policy") ?? "";
    expect(policy).toContain("sandbox allow-scripts");
    expect(policy).not.toContain("allow-same-origin");
    expect(policy).toContain("connect-src 'none'");
    expect(await ok.text()).toContain("exported session");

    const txtPath = path.join(dataDir, "notes.txt");
    await writeFile(txtPath, "not html");
    const deniedType = await fetch(`${base}/api/exports?path=${encodeURIComponent(txtPath)}`, {
      headers: { cookie },
    });
    expect(deniedType.status).toBe(400);

    const missing = await fetch(`${base}/api/exports?path=${encodeURIComponent(path.join(dataDir, "gone.html"))}`, {
      headers: { cookie },
    });
    expect(missing.status).toBe(404);
  });

  it("rejects DNS-rebinding Host headers and foreign Origins", async () => {
    const deniedHost = await app.inject({ url: "/health", headers: { host: "evil.example" } });
    expect(deniedHost.statusCode).toBe(403);
    expect(deniedHost.json()).toMatchObject({ error: "host denied" });

    const deniedOrigin = await app.inject({
      method: "POST",
      url: "/api/setup/complete",
      headers: { host: "127.0.0.1", origin: "https://evil.example" },
    });
    expect(deniedOrigin.statusCode).toBe(403);
    expect(deniedOrigin.json()).toMatchObject({ error: "origin denied" });
  });
});
