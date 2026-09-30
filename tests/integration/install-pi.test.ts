import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../apps/server/src/index.ts";
import { pathEnvKey, runOfficialPiInstall } from "../../apps/server/src/setup/install-pi.ts";

const FAKE_INSTALL_SH = `#!/bin/sh
mkdir -p "$HOME/.pi/agent/bin"
cat > "$HOME/.pi/agent/bin/pi" <<'EOF'
#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "0.0.0-test"
  exit 0
fi
exit 1
EOF
chmod +x "$HOME/.pi/agent/bin/pi"
echo "No terminal detected; continuing without confirmation."
echo "Pi was installed successfully."
`;

async function windowsInstallerEnv(env: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  const home = env.QINGZHOU_HOME_DIR!;
  const bin = path.join(home, "fake npm tools");
  await mkdir(bin, { recursive: true });
  const script = path.join(bin, "npm.cjs");
  await writeFile(script, `
const fs = require('node:fs');
const path = require('node:path');
const home = process.env.HOME;
const prefix = path.join(home, '.pi', 'agent', 'bin');
if (process.argv[2] === 'prefix') {
  console.log(prefix);
} else if (process.argv[2] === 'install' && process.env.QINGZHOU_TEST_NPM_HANG === '1') {
  fs.writeFileSync(path.join(home, 'npm-pid.txt'), String(process.pid));
  setInterval(() => {}, 1000);
} else if (process.argv[2] === 'install') {
  const pkg = path.join(prefix, 'node_modules', '@earendil-works', 'pi-coding-agent');
  fs.mkdirSync(path.join(pkg, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'dist', 'cli.js'), "console.log('0.0.0-test');");
  fs.writeFileSync(path.join(prefix, 'pi.cmd'), '@echo off\\r\\n');
  fs.appendFileSync(path.join(home, 'npm-installs.txt'), 'installed\\n');
  console.log('Pi was installed successfully.');
} else {
  process.exitCode = 1;
}
`);
  await writeFile(path.join(bin, "npm.cmd"), `@echo off\r\n"${process.execPath}" "%~dp0npm.cjs" %*\r\n`);
  const key = pathEnvKey(process.env);
  return { ...process.env, ...env, [key]: `${bin};${process.env[key] ?? ""}` };
}

async function windowsInstallCount(home: string): Promise<number> {
  try {
    return (await readFile(path.join(home, "npm-installs.txt"), "utf8")).trim().split("\n").length;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

async function listen(
  env: NodeJS.ProcessEnv,
): Promise<{
  app: Awaited<ReturnType<typeof createApp>>["app"];
  service: Awaited<ReturnType<typeof createApp>>["service"];
  base: string;
  close: () => Promise<void>;
}> {
  env = { ...env, QINGZHOU_SKIP_PI_TOOLS_FETCH: "1" };
  if (process.platform === "win32") env = await windowsInstallerEnv(env);
  const { app, config, service } = await createApp(env);
  await app.listen({ host: config.host, port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return {
    app,
    service,
    base: `http://${config.host}:${address.port}`,
    close: async () => {
      await app.close();
    },
  };
}

async function sessionCookie(base: string): Promise<string> {
  const health = await fetch(`${base}/health`);
  const cookie = health.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("missing session cookie");
  return cookie;
}

describe("POST /api/setup/install-pi", () => {
  const root = { current: "" };
  let scriptServer: http.Server | null = null;
  let scriptUrl = "";

  beforeAll(async () => {
    root.current = await mkdtemp(path.join(os.tmpdir(), "qingzhou-install-pi-"));
    scriptServer = http.createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      response.end(FAKE_INSTALL_SH);
    });
    await new Promise<void>((resolve) => {
      scriptServer?.listen(0, "127.0.0.1", () => resolve());
    });
    const address = scriptServer.address() as AddressInfo;
    scriptUrl = `http://127.0.0.1:${address.port}/install.sh`;
  });

  afterAll(async () => {
    scriptServer?.close();
    await rm(root.current, { recursive: true, force: true });
  });

  it.runIf(process.platform === "win32")("terminates npm's child process before retrying a timed-out Windows install", async () => {
    const home = path.join(root.current, "home-timeout");
    await mkdir(home);
    const env = await windowsInstallerEnv({ QINGZHOU_HOME_DIR: home, QINGZHOU_TEST_NPM_HANG: "1" });
    const pending = runOfficialPiInstall({ homeDir: home, env, timeoutMs: 5000 })
      .then(() => "unexpected success", (error: Error) => error.message);
    const pid = await vi.waitFor(async () => Number(await readFile(path.join(home, "npm-pid.txt"), "utf8")), { timeout: 4000 });
    expect(pid).toBeGreaterThan(0);
    expect(await pending).toMatch(/安装 Pi 超时/);
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
    const retried = await runOfficialPiInstall({ homeDir: home, env: { ...env, QINGZHOU_TEST_NPM_HANG: "0" } });
    expect(retried.ok).toBe(true);
    expect(await windowsInstallCount(home)).toBe(1);
  });

  it("runs the official install script and then finds Pi", async () => {
    const home = path.join(root.current, "home-ok");
    await mkdir(home);
    const ctx = await listen({
      HOST: "127.0.0.1",
      PORT: "0",
      NODE_ENV: "test",
      PI_BIN: path.join(home, "missing-pi"),
      QINGZHOU_DATA_DIR: path.join(home, "data"),
      QINGZHOU_HOME_DIR: home,
      QINGZHOU_ALLOWED_ROOTS: home,
      QINGZHOU_PI_INSTALL_SCRIPT_URL: scriptUrl,
    });
    try {
      const cookie = await sessionCookie(ctx.base);
      const before = await fetch(`${ctx.base}/api/setup`, { headers: { cookie } });
      const beforeJson = (await before.json()) as { piAvailable: boolean; canInstallPi: boolean };
      expect(beforeJson.piAvailable).toBe(false);
      expect(beforeJson.canInstallPi).toBe(true);

      const installed = await fetch(`${ctx.base}/api/setup/install-pi`, {
        method: "POST",
        headers: { cookie },
      });
      const json = (await installed.json()) as {
        piAvailable: boolean;
        piVersion: string | null;
        log?: string;
        error?: string;
      };
      expect(installed.ok, json.error ?? json.log).toBe(true);
      expect(json.piAvailable).toBe(true);
      expect(json.piVersion).toBe("0.0.0-test");
      expect(json.log).toContain("Pi was installed successfully");

      const health = await fetch(`${ctx.base}/health`, { headers: { cookie } });
      const healthJson = (await health.json()) as { piVersion: string | null };
      expect(healthJson.piVersion).toBe("0.0.0-test");
    } finally {
      await ctx.close();
    }
  });

  it("refuses to replace a bundled desktop Pi", async () => {
    const home = path.join(root.current, "home-bundled");
    await mkdir(home);
    const ctx = await listen({
      HOST: "127.0.0.1",
      PORT: "0",
      NODE_ENV: "test",
      PI_BIN: path.join(home, "missing-pi"),
      QINGZHOU_PI_ENTRY: path.join(home, "missing-entry.js"),
      QINGZHOU_DATA_DIR: path.join(home, "data"),
      QINGZHOU_HOME_DIR: home,
      QINGZHOU_ALLOWED_ROOTS: home,
      QINGZHOU_PI_INSTALL_SCRIPT_URL: scriptUrl,
    });
    try {
      const cookie = await sessionCookie(ctx.base);
      const installed = await fetch(`${ctx.base}/api/setup/install-pi`, {
        method: "POST",
        headers: { cookie },
      });
      expect(installed.status).toBe(400);
      const json = (await installed.json()) as { error: string };
      expect(json.error).toMatch(/内置 Pi/);
    } finally {
      await ctx.close();
    }
  });

  it("does not rerun the installer when Pi is already available", async () => {
    const fakePi = fileURLToPath(new URL("../fixtures/fake-pi.mjs", import.meta.url));
    const home = path.join(root.current, "home-ready");
    await mkdir(home);
    let hits = 0;
    const counting = http.createServer((_request, response) => {
      hits += 1;
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      response.end(FAKE_INSTALL_SH);
    });
    await new Promise<void>((resolve) => counting.listen(0, "127.0.0.1", () => resolve()));
    const countingUrl = `http://127.0.0.1:${(counting.address() as AddressInfo).port}/install.sh`;
    const ctx = await listen({
      HOST: "127.0.0.1",
      PORT: "0",
      NODE_ENV: "test",
      PI_BIN: fakePi,
      QINGZHOU_DATA_DIR: path.join(home, "data"),
      QINGZHOU_HOME_DIR: home,
      QINGZHOU_ALLOWED_ROOTS: home,
      QINGZHOU_PI_INSTALL_SCRIPT_URL: countingUrl,
    });
    try {
      const cookie = await sessionCookie(ctx.base);
      const installed = await fetch(`${ctx.base}/api/setup/install-pi`, {
        method: "POST",
        headers: { cookie },
      });
      const json = (await installed.json()) as { piAvailable: boolean; log?: string };
      expect(installed.ok).toBe(true);
      expect(json.piAvailable).toBe(true);
      expect(hits).toBe(0);
      if (process.platform === "win32") expect(await windowsInstallCount(home)).toBe(0);
    } finally {
      await ctx.close();
      counting.close();
    }
  });

  it("reports a newer Pi version from the npm latest document", async () => {
    const fakePi = fileURLToPath(new URL("../fixtures/fake-pi.mjs", import.meta.url));
    const home = path.join(root.current, "home-latest");
    await mkdir(home);
    const registry = http.createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ version: "9.9.9" }));
    });
    await new Promise<void>((resolve) => registry.listen(0, "127.0.0.1", () => resolve()));
    const latestUrl = `http://127.0.0.1:${(registry.address() as AddressInfo).port}/latest`;
    const ctx = await listen({
      HOST: "127.0.0.1",
      PORT: "0",
      NODE_ENV: "test",
      PI_BIN: fakePi,
      QINGZHOU_DATA_DIR: path.join(home, "data"),
      QINGZHOU_HOME_DIR: home,
      QINGZHOU_ALLOWED_ROOTS: home,
      QINGZHOU_PI_NPM_LATEST_URL: latestUrl,
    });
    try {
      const cookie = await sessionCookie(ctx.base);
      const response = await fetch(`${ctx.base}/api/setup/pi-latest`, { headers: { cookie } });
      const json = (await response.json()) as {
        current: string | null;
        latest: string | null;
        updateAvailable: boolean;
        canUpdate: boolean;
        error: string | null;
      };
      expect(response.ok).toBe(true);
      expect(json.current).toBe("0.0.0-fake");
      expect(json.latest).toBe("9.9.9");
      expect(json.updateAvailable).toBe(true);
      expect(json.canUpdate).toBe(true);
      expect(json.error).toBeNull();
    } finally {
      await ctx.close();
      registry.close();
    }
  });

  it("re-runs the installer when force is set", async () => {
    const fakePi = fileURLToPath(new URL("../fixtures/fake-pi.mjs", import.meta.url));
    const home = path.join(root.current, "home-force");
    await mkdir(home);
    let hits = 0;
    const counting = http.createServer((_request, response) => {
      hits += 1;
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      response.end(FAKE_INSTALL_SH);
    });
    await new Promise<void>((resolve) => counting.listen(0, "127.0.0.1", () => resolve()));
    const countingUrl = `http://127.0.0.1:${(counting.address() as AddressInfo).port}/install.sh`;
    const ctx = await listen({
      HOST: "127.0.0.1",
      PORT: "0",
      NODE_ENV: "test",
      PI_BIN: fakePi,
      QINGZHOU_DATA_DIR: path.join(home, "data"),
      QINGZHOU_HOME_DIR: home,
      QINGZHOU_ALLOWED_ROOTS: home,
      QINGZHOU_PI_INSTALL_SCRIPT_URL: countingUrl,
    });
    try {
      const cookie = await sessionCookie(ctx.base);
      const installed = await fetch(`${ctx.base}/api/setup/install-pi`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      const json = (await installed.json()) as { piAvailable: boolean; error?: string; log?: string };
      expect(installed.ok, json.error ?? json.log).toBe(true);
      expect(json.piAvailable).toBe(true);
      if (process.platform === "win32") expect(await windowsInstallCount(home)).toBe(1);
      else expect(hits).toBe(1);
    } finally {
      await ctx.close();
      counting.close();
    }
  });

  it("saves and then updates an API key", async () => {
    const fakePi = fileURLToPath(new URL("../fixtures/fake-pi.mjs", import.meta.url));
    const home = path.join(root.current, "home-key");
    await mkdir(home);
    const ctx = await listen({
      HOST: "127.0.0.1",
      PORT: "0",
      NODE_ENV: "test",
      PI_BIN: fakePi,
      QINGZHOU_DATA_DIR: path.join(home, "data"),
      QINGZHOU_HOME_DIR: home,
      QINGZHOU_ALLOWED_ROOTS: home,
    });
    try {
      const cookie = await sessionCookie(ctx.base);
      const saved = await fetch(`${ctx.base}/api/setup/api-key`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ provider: "anthropic", apiKey: "sk-ant-first-key-123456" }),
      });
      const first = (await saved.json()) as { authEntries?: Array<{ id: string; kind: string }> };
      expect(saved.ok).toBe(true);
      expect(first.authEntries?.some((entry) => entry.id === "anthropic" && entry.kind === "api_key")).toBe(true);

      const updated = await fetch(`${ctx.base}/api/setup/api-key`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ provider: "openai", apiKey: "sk-openai-second-key" }),
      });
      const second = (await updated.json()) as { configuredProviders?: string[] };
      expect(updated.ok).toBe(true);
      expect(second.configuredProviders).toEqual(expect.arrayContaining(["anthropic", "openai"]));
    } finally {
      await ctx.close();
    }
  });
});

describe("GET /api/setup", () => {
  it("reloads restored auth.json into live setup hints", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "qingzhou-setup-refresh-"));
    await mkdir(path.join(home, ".pi", "agent"), { recursive: true });
    const authPath = path.join(home, ".pi", "agent", "auth.json");
    await writeFile(authPath, JSON.stringify({ github: { type: "oauth" } }));
    const fakePi = fileURLToPath(new URL("../fixtures/fake-pi.mjs", import.meta.url));
    const ctx = await listen({
      HOST: "127.0.0.1",
      PORT: "0",
      NODE_ENV: "test",
      PI_BIN: fakePi,
      QINGZHOU_DATA_DIR: path.join(home, "data"),
      QINGZHOU_HOME_DIR: home,
      QINGZHOU_ALLOWED_ROOTS: home,
    });
    try {
      const cookie = await sessionCookie(ctx.base);
      const logout = await fetch(`${ctx.base}/api/setup/logout`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ provider: "github" }),
      });
      expect(logout.ok).toBe(true);
      const afterLogout = ctx.service.buildSnapshot(null).authEntries as Array<{ id: string }>;
      expect(afterLogout.some((entry) => entry.id === "github")).toBe(false);

      await writeFile(authPath, JSON.stringify({ github: { type: "oauth" } }));
      const refreshed = await fetch(`${ctx.base}/api/setup`, { headers: { cookie } });
      const json = (await refreshed.json()) as { authEntries: Array<{ id: string; kind: string }> };
      expect(json.authEntries.some((entry) => entry.id === "github" && entry.kind === "oauth")).toBe(true);
      const hints = ctx.service.buildSnapshot(null).authEntries as Array<{ id: string }>;
      expect(hints.some((entry) => entry.id === "github")).toBe(true);
    } finally {
      await ctx.close();
      await rm(home, { recursive: true, force: true });
    }
  });
});
