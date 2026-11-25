import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createConnection, type Socket } from "node:net";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));

it.each(["source", "bundle"])("%s starts one managed desktop service and shuts down from stdin", async (kind) => {
  const directory = await mkdtemp(path.join(tmpdir(), "qingzhou-desktop-"));
  const home = path.join(directory, "home");
  const web = path.join(directory, "web");
  await mkdir(home);
  await mkdir(web);
  await writeFile(path.join(web, "index.html"), "<!doctype html><title>轻舟</title>");

  let command = ["--import", "tsx", "apps/server/src/desktop-main.ts"];
  if (kind === "bundle") {
    const requireDesktop = createRequire(new URL("../../apps/desktop/package.json", import.meta.url));
    const esbuild = requireDesktop("esbuild") as typeof import("esbuild");
    const bundle = path.join(directory, "service.mjs");
    await esbuild.build({
      absWorkingDir: root, entryPoints: ["apps/server/src/desktop-main.ts"], outfile: bundle,
      alias: { "@qingzhou/protocol": path.join(root, "packages/protocol/src/index.ts") },
      bundle: true, format: "esm", platform: "node", external: ["node-pty"],
      banner: { js: "import { createRequire as bundleRequire } from 'node:module'; import { fileURLToPath as bundlePath } from 'node:url'; const require = bundleRequire(import.meta.url); const __dirname = bundlePath(new URL('.', import.meta.url));" },
    });
    command = [bundle];
  }
  const ticket = "a".repeat(32);
  const start = () => spawn(process.execPath, command, {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "production",
      QINGZHOU_HOME_DIR: home,
      QINGZHOU_DATA_DIR: path.join(directory, "data"),
      QINGZHOU_WEB_DIST: web,
      QINGZHOU_ALLOWED_ROOTS: home,
      QINGZHOU_DESKTOP_TICKET: ticket,
      PI_BIN: path.join(root, "tests/fixtures/fake-pi.mjs"),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const child = start();
  const output = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  let stderr = "";
  let stdout = "";
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
  const closed = once(child, "close");
  async function readEvent(prefix: string) {
    for (;;) {
      const next = await output.next();
      if (next.done) throw new Error(`桌面服务停止输出，未收到 ${prefix}\n${stderr}`);
      if (next.value.startsWith(prefix)) return next.value.slice(prefix.length);
    }
  }

  let socket: WebSocket | undefined;
  let pendingHttp: Socket | undefined;
  try {
    const origin = await readEvent("QINGZHOU_READY ");
    const duplicate = start();
    let duplicateOutput = "";
    duplicate.stdout.on("data", (chunk: Buffer) => { duplicateOutput += chunk.toString(); });
    duplicate.stderr.resume();
    expect(await once(duplicate, "close")).toEqual([1, null]);
    expect(duplicateOutput).toContain("QINGZHOU_PROFILE_BUSY");
    expect(duplicateOutput).not.toContain("QINGZHOU_READY");
    const api = `${origin}/api/session`;
    expect((await fetch(api)).status).toBe(401);
    const bootstrap = await fetch(`${origin}/_desktop/bootstrap?ticket=${ticket}`, { redirect: "manual" });
    expect(bootstrap.status).toBe(200);
    const cookie = bootstrap.headers.get("set-cookie")?.split(";", 1)[0];
    expect(cookie).toBeTruthy();
    expect((await fetch(api, { headers: { Cookie: cookie! } })).status).toBe(200);
    expect((await fetch(api, { headers: { Cookie: cookie!, Origin: "http://127.0.0.1:5173" } })).status).toBe(403);

    const preferences = `${origin}/api/desktop/ui`;
    const save = (key: string, value: string) => fetch(preferences, {
      method: "PUT", headers: { Cookie: cookie!, "Content-Type": "application/json" }, body: JSON.stringify({ key, value }),
    });
    const images = JSON.stringify([{ id: "attachment", name: "preview.png", previewUrl: "data:image/png;base64,aGVsbG8=" }]);
    const saved = await Promise.all([save("qingzhou.theme", "dark"), save("qingzhou:shared-draft:conversation-a", "未发送的草稿"), save("qingzhou:shared-images:conversation-a", images)]);
    expect(saved.map((response) => response.status)).toEqual([204, 204, 204]);
    expect(await fetch(preferences, { headers: { Cookie: cookie! } }).then((response) => response.json())).toEqual({
      "qingzhou.theme": "dark", "qingzhou:shared-draft:conversation-a": "未发送的草稿", "qingzhou:shared-images:conversation-a": images,
    });
    const storage = path.join(directory, "data/desktop-ui.json");
    const before = await readFile(storage, "utf8");
    expect(before).toContain("未发送的草稿");
    await writeFile(storage, "{{损坏草稿");
    expect((await save("qingzhou.theme", "light")).status).toBe(500);
    expect(await readFile(storage, "utf8")).toBe("{{损坏草稿");
    await writeFile(storage, before);
    const recovery = "b".repeat(32);
    const restoredImages = JSON.stringify([{ id: "offline", name: "offline.png", previewUrl: "data:image/png;base64,aGVsbG8=" }]);
    child.stdin.write(`restore-ui ${recovery} ${JSON.stringify([
      { key: "qingzhou:shared-draft:conversation-a", value: "断线\n恢复\u2028草稿" },
      { key: "qingzhou:shared-images:conversation-a", value: restoredImages },
      { key: "qingzhou.theme", value: null },
    ])}\n`);
    await readEvent(`QINGZHOU_UI_SAVED ${recovery}`);
    const restored = JSON.parse(await readFile(storage, "utf8"));
    expect(restored).toEqual({ "qingzhou:shared-draft:conversation-a": "断线\n恢复\u2028草稿" });

    socket = new WebSocket(`${origin.replace("http:", "ws:")}/ws`, { origin, headers: { Cookie: cookie! } });
    const [frame] = await once(socket, "message");
    expect(JSON.parse(frame.toString()).type).toBe("snapshot");
    const disconnected = once(socket, "close");
    socket.pause();
    const address = new URL(origin);
    const incomplete = createConnection(Number(address.port), address.hostname);
    pendingHttp = incomplete;
    await once(incomplete, "connect");
    const httpClosed = new Promise<void>((resolve) => incomplete.once("close", () => resolve()));
    incomplete.on("error", () => undefined);
    incomplete.write(`POST /api/update/preferences HTTP/1.1\r\nHost: ${address.host}\r\nCookie: ${cookie}\r\nContent-Type: application/json\r\nContent-Length: 20\r\n\r\n{`);
    child.stdin.write("shutdown\n");
    const stopped = Promise.all([readEvent("QINGZHOU_STOPPED"), closed, httpClosed]);
    const outcome = await Promise.race([stopped, delay(8000, "桌面服务未退出", { ref: false })]);
    expect(outcome).toEqual(["", [0, null], undefined]);
    socket.resume();
    await disconnected;
    expect(stdout.match(/Server listening at/g)).toHaveLength(1);

    const reopened = start();
    const restarted = once(reopened, "close");
    const lines = createInterface({ input: reopened.stdout });
    reopened.stderr.resume();
    try {
      for await (const line of lines) {
        if (!line.startsWith("QINGZHOU_READY ")) continue;
        const address = line.slice("QINGZHOU_READY ".length);
        const bootstrap = await fetch(`${address}/_desktop/bootstrap?ticket=${ticket}`, { redirect: "manual" });
        const session = bootstrap.headers.get("set-cookie")?.split(";", 1)[0];
        expect(await fetch(`${address}/api/desktop/ui`, { headers: { Cookie: session! } }).then((response) => response.json())).toEqual({
          ...restored, "qingzhou:shared-images:conversation-a": restoredImages,
        });
        break;
      }
      reopened.stdin.write("shutdown\n");
      expect(await restarted).toEqual([0, null]);
    } finally {
      lines.close();
      if (reopened.exitCode === null && reopened.signalCode === null) reopened.kill();
      await restarted;
    }
  } finally {
    pendingHttp?.destroy();
    socket?.terminate();
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);
