// Run with pnpm exec tsx tests/integration/gemini-runtime-smoke.ts <bundled-runtime-directory>.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(import.meta.url);
const runtime = path.resolve(process.argv[2] ?? "");
const home = process.argv[3];
if (!home) {
  assert(process.argv[2], "Pass the bundled runtime directory");
  const directory = await mkdtemp(path.join(os.tmpdir(), "mowen-gemini-"));
  try {
    execFileSync(process.execPath, ["--import", import.meta.resolve("tsx"), script, runtime, directory], {
      cwd: directory, stdio: "inherit", timeout: 90_000,
      env: {
        PATH: [path.join(runtime, "tools"), path.join(runtime, "bin"), process.env.PATH].join(path.delimiter),
        HOME: directory, USERPROFILE: directory, TMPDIR: directory, TEMP: directory, TMP: directory,
        ...(process.platform === "win32" ? {
          SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, ComSpec: process.env.ComSpec,
          PATHEXT: process.env.PATHEXT, SystemDrive: process.env.SystemDrive,
          APPDATA: path.join(directory, "AppData/Roaming"), LOCALAPPDATA: path.join(directory, "AppData/Local"),
        } : {}),
        PI_OFFLINE: "1", NODE_ENV: "test", QINGZHOU_HOME_DIR: directory,
        QINGZHOU_ALLOWED_ROOTS: directory, QINGZHOU_SKIP_PI_TOOLS_FETCH: "1",
        QINGZHOU_PI_ENTRY: path.join(runtime, "pi/node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
        QINGZHOU_NODE_BIN: path.join(runtime, "bin", process.platform === "win32" ? "node.exe" : "node"),
      },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
} else {
  await verify();
}

async function verify() {
  const mockKey = "fixture-google-api-key";
  const requestModels: string[] = [];
  const marker = "MOWEN_GEMINI_STREAM";
  let failNext = false;
  const google = createServer(async (req, res) => {
    const model = req.url?.match(/^\/v1beta\/models\/(.+):streamGenerateContent\?alt=sse$/)?.[1];
    let data = "";
    for await (const chunk of req) data += chunk;
    if (!model || req.headers["x-goog-api-key"] !== mockKey || !JSON.parse(data).contents?.length) {
      res.writeHead(400).end();
      return;
    }
    requestModels.push(model);
    if (failNext) {
      failNext = false;
      res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({
        error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" },
      }));
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const [text, last] of [["MOWEN_GEMINI_", false], ["STREAM", true]] as const) {
      res.write(`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text }] }, ...(last ? { finishReason: "STOP" } : {}) }] })}\n\n`);
    }
    res.end();
  });
  await new Promise<void>((resolve, reject) => google.once("error", reject).listen(0, "127.0.0.1", resolve));
  const addr = google.address();
  assert(addr && typeof addr === "object");
  const project = path.join(home, "project");
  await mkdir(project);
  const agent = path.join(home, ".pi/agent");
  await mkdir(agent, { recursive: true });
  await writeFile(path.join(agent, "models.json"), JSON.stringify({ providers: {
    google: { baseUrl: `http://127.0.0.1:${addr.port}/v1beta` },
  } }));
  const { createApp } = await import("../../apps/server/src/app.ts");
  const { app, service } = await createApp();
  const surfacedErrors: string[] = [];
  service.addSocket({ closed: false, send: (line) => {
    const frame = JSON.parse(line);
    if (frame.type === "server.error") surfacedErrors.push(String(frame.payload?.message ?? ""));
  } });
  try {
    const session = await app.inject({ url: "/api/session" });
    const cookie = session.cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
    assert.equal(session.json().setup.needsSetup, true);
    const workspace = await app.inject({ method: "POST", url: "/api/setup/workspace", headers: { cookie }, payload: { path: project } });
    assert.equal(workspace.statusCode, 200);
    assert.equal(workspace.json().needsSetup, false);
    assert.equal(workspace.json().ready, false);
    assert.equal((await app.inject({ url: "/api/setup", headers: { cookie } })).json().needsSetup, false);
    const create = async () => {
      const result = await service.handleCommand({ id: "create", type: "task.create", payload: { cwd: project } }) as { task: { id: string } };
      await until(() => service.buildSnapshot(result.task.id).status === "idle", "task ready");
      return result.task.id;
    };
    const active = await create();
    const snap = () => service.buildSnapshot(active);
    assert(!snap().models.some((m) => m.provider === "google"));
    const destination = session.json().setup.geminiTarget;
    assert.equal(destination.kind, "custom");
    assert.deepEqual(destination.origins, [`http://127.0.0.1:${addr.port}`]);
    const unconfirmed = await app.inject({ method: "POST", url: "/api/setup/api-key", headers: { cookie }, payload: { provider: "google", apiKey: mockKey } });
    assert.equal(unconfirmed.statusCode, 409);
    const saved = await app.inject({ method: "POST", url: "/api/setup/api-key", headers: { cookie },
      payload: { provider: "google", apiKey: mockKey, confirmedGeminiTarget: destination.revision } });
    assert.equal(saved.statusCode, 200, saved.body.replaceAll(mockKey, "[fixture]"));
    assert(!saved.body.includes(mockKey));
    await until(() => snap().models.some((m) => m.provider === "google"), "existing session Gemini catalog");
    const model = snap().models.find((m) => m.provider === "google" && m.id.includes("flash") && !m.id.includes("live"));
    assert(model);
    const payload = { provider: "google", modelId: model.id };
    await service.handleCommand({ id: "model", type: "model.set", taskId: active, payload });
    await service.handleCommand({ id: "default", type: "model.default.set", taskId: active, payload });
    const send = async (taskId: string, message: string) => service.handleCommand({
      id: "send", type: "prompt.send", taskId, payload: { message },
    });
    await send(active, "回复测试标记");
    await until(() => snap().messages?.some((m) => m.role === "assistant" && m.text === marker) === true, "existing session streamed reply");
    const fresh = await create();
    const freshSnap = () => service.buildSnapshot(fresh);
    assert.equal(freshSnap().tasks.find((task) => task.id === fresh)?.model?.id, model.id);
    await send(fresh, "回复测试标记");
    await until(() => freshSnap().messages?.some((m) => m.role === "assistant" && m.text === marker) === true, "default model streamed reply");
    await until(() => freshSnap().status === "idle", "generation settled");
    failNext = true;
    await send(fresh, "无效凭据回归");
    await until(() => requestModels.length >= 3 && (freshSnap().status === "idle" || freshSnap().status === "error"), "provider error settled");
    assert(surfacedErrors.some((text) => text.includes("Google AI Studio")) ||
      freshSnap().messages?.some((m) => m.isError && m.text.includes("Google AI Studio")), "Actionable Gemini error must reach the conversation");
    await send(fresh, "重试测试标记");
    await until(() => freshSnap().messages?.filter((m) => m.role === "assistant" && m.text === marker).length === 2, "recovered reply");
    failNext = true;
    const { item } = await service.handleCommand({ id: "work", type: "workItem.create",
      payload: { title: "异常回复回归", description: "回复测试标记", acceptanceCriteria: "返回标记", cwd: project, start: true } }) as { item: { id: string } };
    await until(() => service.buildSnapshot(fresh).workItems?.find((entry) => entry.id === item.id)?.latestRun?.status === "failed", "failed project run");
    const removed = await app.inject({ method: "POST", url: "/api/setup/logout", headers: { cookie }, payload: { provider: "google" } });
    assert.equal(removed.statusCode, 200);
    await until(() => !snap().models.some((m) => m.provider === "google") && !freshSnap().models.some((m) => m.provider === "google"), "removed provider");
    assert.deepEqual(requestModels, Array(5).fill(model.id));
    console.log(`Pi ${snap().piVersion} · google/${model.id} · warm session, saved default, SSE, failed reply, retry, failed project run and removal passed`);
  } finally {
    await app.close();
    google.closeAllConnections();
    await new Promise<void>((resolve) => google.close(() => resolve()));
  }
}

async function until(condition: () => boolean, label: string) {
  const deadline = Date.now() + 12_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await sleep(50);
  }
}
