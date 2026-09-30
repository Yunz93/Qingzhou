import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { serverFrameSchema } from "@qingzhou/protocol";
import { createApp } from "../../apps/server/src/index.ts";

const fakePi = fileURLToPath(new URL("../fixtures/fake-pi.mjs", import.meta.url));

type EventMsg = {
  type: string;
  taskId?: string;
  payload?: {
    error?: string;
    requestId?: string;
    data?: { task?: { id: string }; nodes?: Array<{ id: string; role: string }>; autoCompaction?: boolean };
    approval?: { requestId: string };
    tool?: { status?: string; isError?: boolean };
    task?: { id: string };
    status?: string;
    messages?: Array<{ text: string }>;
    message?: string;
    authHint?: boolean;
  };
};

async function listen(env: NodeJS.ProcessEnv) {
  const { app, config, service } = await createApp({ ...env, QINGZHOU_SKIP_PI_TOOLS_FETCH: "1" });
  await app.listen({ host: config.host, port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return { app, service, config, base: `http://${config.host}:${address.port}` };
}

async function openSocket(base: string) {
  const health = await fetch(`${base}/health`);
  const cookie = health.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("missing session cookie");
  const ws = new WebSocket(base.replace("http", "ws") + "/ws", {
    headers: { Origin: base, Cookie: cookie },
  });
  const events: EventMsg[] = [];
  ws.on("message", (data) => {
    const frame = serverFrameSchema.parse(JSON.parse(String(data)));
    events.push(...("__batch" in frame ? frame.events : [frame]));
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  let cursor = 0;
  const waitFor = async (type: string, timeout = 12_000, after = cursor) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const match = events.slice(after).find((event) => event.type === type);
      if (match) {
        cursor = events.indexOf(match) + 1;
        return match;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`Timed out waiting for ${type}`);
  };
  const send = (body: object) => ws.send(JSON.stringify(body));
  const waitForRequest = async (id: string, timeout = 8000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const match = events.find(
        (event) =>
          (event.type === "request.succeeded" || event.type === "request.failed") &&
          event.payload?.requestId === id,
      );
      if (match) return match;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`Timed out waiting for request ${id}`);
  };
  return { ws, events, waitFor, waitForRequest, send, cookie };
}

describe("integration fake-pi", () => {
  const root = { current: "" };
  let ctx: Awaited<ReturnType<typeof listen>>;

  beforeAll(async () => {
    root.current = await mkdtemp(path.join(os.tmpdir(), "qingzhou-int-"));
    const project = path.join(root.current, "project");
    await mkdir(project);
    await writeFile(path.join(project, "README.md"), "hello");
    ctx = await listen({
      HOST: "127.0.0.1",
      PORT: "0",
      NODE_ENV: "test",
      PI_BIN: fakePi,
      QINGZHOU_DATA_DIR: path.join(root.current, "data"),
      QINGZHOU_ALLOWED_ROOTS: root.current,
      QINGZHOU_MAX_PROCESSES: "3",
      QINGZHOU_MUTATIONS: "approval",
      QINGZHOU_HOME_DIR: root.current,
    });
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it("streams prompt output, approvals, queue, crash, abort, and restore", async () => {
    const project = path.join(root.current, "project");
    const sock = await openSocket(ctx.base);
    await sock.waitFor("snapshot");

    sock.send({ id: "bad", type: "not-a-command", payload: {} });
    const failed = await sock.waitFor("request.failed");
    expect(failed.payload?.error).toMatch(/版本不一致/);

    sock.send({
      id: "c1",
      type: "task.create",
      payload: { cwd: project, title: "Stream" },
    });
    const created = await sock.waitFor("request.succeeded");
    const taskId = created?.payload?.data?.task?.id as string;

    sock.send({
      id: "skill-check",
      type: "resources.skill.updates",
      taskId,
      payload: {},
    });
    const skillCheck = await sock.waitForRequest("skill-check", 8000);
    expect(skillCheck.type).toBe("request.succeeded");

    sock.send({
      id: "ask-policy",
      type: "task.policy.set",
      taskId,
      payload: { mode: "agent", approvalPolicy: "ask" },
    });
    await sock.waitForRequest("ask-policy");

    const waitUntilIdle = () => vi.waitFor(() => {
      expect(ctx.service.listTasks().find((task) => task.id === taskId)?.status).toBe("idle");
    }, { timeout: 5000 });
    sock.send({ id: "p1", type: "prompt.send", taskId, payload: { message: "hello world stream this slowly" } });
    await sock.waitFor("message.delta");
    sock.send({ id: "s1", type: "prompt.steer", taskId, payload: { message: "turn left" } });
    const steered = await sock.waitForRequest("s1");
    expect(steered.type, steered.payload?.error).toBe("request.succeeded");
    await vi.waitFor(() => {
      const messages = ctx.service.buildSnapshot(taskId).messages as Array<{ text: string }>;
      expect(messages.some((message) => message.text.includes("Steered: turn left"))).toBe(true);
      expect(ctx.service.listTasks().find((task) => task.id === taskId)?.status).toBe("idle");
    }, { timeout: 5000 });

    sock.send({ id: "w1", type: "prompt.send", taskId, payload: { message: "WRITE:secret.txt:nope" } });
    const approval = await sock.waitFor("approval.requested");
    sock.send({
      id: "deny1",
      type: "approval.respond",
      taskId,
      payload: { requestId: approval.payload?.approval?.requestId ?? "", allow: false },
    });
    await sock.waitFor("tool.completed");
    await waitUntilIdle();
    await expect(import("node:fs/promises").then((fs) => fs.access(path.join(project, "secret.txt")))).rejects.toThrow();

    sock.send({ id: "b1", type: "prompt.send", taskId, payload: { message: "BASH:echo hi" } });
    const bashApproval = await sock.waitFor("approval.requested");
    sock.send({
      id: "deny2",
      type: "approval.respond",
      taskId,
      payload: { requestId: bashApproval.payload?.approval?.requestId ?? "", allow: false },
    });
    const blocked = await sock.waitFor("tool.completed");
    expect(blocked.payload?.tool?.status === "blocked" || blocked.payload?.tool?.isError).toBeTruthy();
    await waitUntilIdle();

    sock.ws.close();
    const sock2 = await openSocket(ctx.base);
    await sock2.waitFor("snapshot");
    sock2.send({ id: "act-old", type: "task.activate", taskId, payload: {} });
    sock2.send({ id: "snap", type: "snapshot.request", payload: { taskId } });
    const snap = await sock2.waitFor("snapshot");
    expect(snap.payload?.messages?.some((message) => message.text.includes("hello"))).toBe(true);

    const extraIds: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      sock2.send({
        id: `t${i}`,
        type: "task.create",
        payload: { cwd: project, title: `Queued ${i}` },
      });
      const created = await sock2.waitForRequest(`t${i}`);
      const id = created.payload?.data?.task?.id;
      if (id && id !== taskId) extraIds.push(id);
    }
    for (const id of extraIds) {
      sock2.send({ id: `act-${id}`, type: "task.activate", taskId: id, payload: {} });
    }
    const queuedDeadline = Date.now() + 4_000;
    let queued = ctx.service.listTasks().filter((task) => task.status === "queued");
    while (queued.length < 1 && Date.now() < queuedDeadline) {
      await new Promise((r) => setTimeout(r, 50));
      queued = ctx.service.listTasks().filter((task) => task.status === "queued");
    }
    expect(queued.length).toBeGreaterThanOrEqual(1);

    for (const id of extraIds) {
      sock2.send({ id: `arch-${id}`, type: "task.archive", taskId: id, payload: {} });
    }
    const archivedDeadline = Date.now() + 4_000;
    while (Date.now() < archivedDeadline) {
      const busy = extraIds.some((id) => {
        const status = ctx.service.listTasks().find((task) => task.id === id)?.status;
        return status === "queued" || status === "running" || status === "starting";
      });
      if (!busy) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    sock2.send({ id: "crash-task", type: "task.create", payload: { cwd: project, title: "Crash" } });
    const crashCreated = await sock2.waitForRequest("crash-task");
    const crashId = crashCreated.payload?.data?.task?.id as string;
    sock2.send({ id: "p-crash", type: "prompt.send", taskId: crashId, payload: { message: "CRASH" } });
    const crashed = await new Promise<EventMsg>((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        const match = sock2.events.find(
          (event) => event.type === "agent.status" && event.taskId === crashId && event.payload?.status === "error",
        );
        if (match) return resolve(match);
        if (Date.now() - start > 4000) return reject(new Error("crash not observed"));
        setTimeout(tick, 40);
      };
      tick();
    });
    expect(crashed.payload?.status).toBe("error");
    expect(String(crashed.payload?.errorMessage ?? "")).toMatch(/进程退出|Pi/);
    const crashErrors = sock2.events.filter(
      (event) => event.type === "server.error" && event.taskId === crashId,
    );
    expect(crashErrors.some((event) => String(event.payload?.message ?? "").match(/进程退出|Pi/))).toBe(
      true,
    );
    sock2.ws.close();
  }, 20_000);

  it("surfaces HTTP 401 from Pi as a visible server.error", async () => {
    const isolated = await listen({
      HOST: "127.0.0.1",
      PORT: "0",
      NODE_ENV: "test",
      PI_BIN: fakePi,
      QINGZHOU_DATA_DIR: path.join(root.current, "data-401"),
      QINGZHOU_ALLOWED_ROOTS: root.current,
      QINGZHOU_MAX_PROCESSES: "1",
      QINGZHOU_MUTATIONS: "approval",
      QINGZHOU_HOME_DIR: root.current,
    });
    try {
      const project = path.join(root.current, "project");
      const sock = await openSocket(isolated.base);
      await sock.waitFor("snapshot");
      sock.send({
        id: "c-401",
        type: "task.create",
        payload: { cwd: project, title: "Auth 401" },
      });
      const created = await sock.waitFor("request.succeeded");
      const taskId = created?.payload?.data?.task?.id as string;

      sock.send({ id: "p-401", type: "prompt.send", taskId, payload: { message: "FAIL401" } });
      const error = await sock.waitFor("server.error");
      expect(error.payload?.message).toMatch(/401|登录已失效/);
      expect(error.payload?.authHint).not.toBe(true);

      await new Promise<void>((resolve, reject) => {
        const start = Date.now();
        const tick = () => {
          const match = sock.events.find(
            (event) =>
              event.type === "agent.status" && event.taskId === taskId && event.payload?.status === "idle",
          );
          if (match) return resolve();
          if (Date.now() - start > 4000) return reject(new Error("401 turn did not settle"));
          setTimeout(tick, 25);
        };
        tick();
      });
      const afterSettle = sock.events.filter((event) => event.type === "server.error");
      expect(afterSettle.some((event) => event.payload?.message?.match(/401|登录已失效/))).toBe(true);
      sock.ws.close();
    } finally {
      await isolated.app.close();
    }
  }, 15_000);

  it("surfaces provider API failures with the original reason", async () => {
    const isolated = await listen({
      HOST: "127.0.0.1",
      PORT: "0",
      NODE_ENV: "test",
      PI_BIN: fakePi,
      QINGZHOU_DATA_DIR: path.join(root.current, "data-429"),
      QINGZHOU_ALLOWED_ROOTS: root.current,
      QINGZHOU_MAX_PROCESSES: "1",
      QINGZHOU_MUTATIONS: "approval",
      QINGZHOU_HOME_DIR: root.current,
    });
    try {
      const project = path.join(root.current, "project");
      const sock = await openSocket(isolated.base);
      await sock.waitFor("snapshot");
      sock.send({
        id: "c-429",
        type: "task.create",
        payload: { cwd: project, title: "Rate limit" },
      });
      const created = await sock.waitForRequest("c-429");
      const taskId = created?.payload?.data?.task?.id as string;
      sock.send({ id: "p-429", type: "prompt.send", taskId, payload: { message: "FAIL429" } });
      const error = await sock.waitFor("server.error");
      expect(error.payload?.message).toMatch(/API 请求失败|429|rate_limit/);
      expect(error.payload?.message).not.toMatch(/\[object Object\]/);
      sock.ws.close();
    } finally {
      await isolated.app.close();
    }
  }, 15_000);

  it("starts a second turn after idle instead of queuing a dead follow_up", async () => {
    const project = path.join(root.current, "project");
    const sock = await openSocket(ctx.base);
    await sock.waitFor("snapshot");
    sock.send({
      id: "c-second",
      type: "task.create",
      payload: { cwd: project, title: "Second turn" },
    });
    const created = await sock.waitFor("request.succeeded");
    const taskId = created?.payload?.data?.task?.id as string;

    sock.send({ id: "p-first", type: "prompt.send", taskId, payload: { message: "first turn" } });
    await sock.waitFor("message.delta");
    await new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        const match = sock.events.find(
          (event) =>
            event.type === "agent.status" && event.taskId === taskId && event.payload?.status === "idle",
        );
        if (match) return resolve();
        if (Date.now() - start > 4000) return reject(new Error("first turn did not settle"));
        setTimeout(tick, 25);
      };
      tick();
    });

    const before = sock.events.length;
    sock.send({
      id: "p-second",
      type: "prompt.followUp",
      taskId,
      payload: { message: "second turn please" },
    });
    const result = await sock.waitForRequest("p-second");
    expect(result.type).toBe("request.succeeded");
    const delta = await new Promise<EventMsg>((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        const match = sock.events.slice(before).find(
          (event) => event.type === "message.delta" && event.taskId === taskId,
        );
        if (match) return resolve(match);
        if (Date.now() - start > 4000) return reject(new Error("second turn did not stream"));
        setTimeout(tick, 25);
      };
      tick();
    });
    expect(delta.type).toBe("message.delta");
    sock.ws.close();
  }, 15_000);

  it("auto-allows workspace file edits and can fork a user turn", async () => {
    const project = path.join(root.current, "project-policy");
    await mkdir(project);
    const isolated = await listen({
      HOST: "127.0.0.1",
      PORT: "0",
      NODE_ENV: "test",
      PI_BIN: fakePi,
      QINGZHOU_DATA_DIR: path.join(root.current, "data-policy"),
      QINGZHOU_ALLOWED_ROOTS: root.current,
      QINGZHOU_MAX_PROCESSES: "1",
      QINGZHOU_MUTATIONS: "approval",
      QINGZHOU_HOME_DIR: root.current,
    });
    try {
      const sock = await openSocket(isolated.base);
      await sock.waitFor("snapshot");
      sock.send({
        id: "c-policy",
        type: "task.create",
        payload: { cwd: project, title: "Policy" },
      });
      const created = await sock.waitForRequest("c-policy");
      const taskId = created?.payload?.data?.task?.id as string;

      sock.send({
        id: "set-policy",
        type: "task.policy.set",
        taskId,
        payload: { mode: "agent", approvalPolicy: "workspace" },
      });
      await sock.waitForRequest("set-policy");
      sock.send({ id: "auto-write", type: "prompt.send", taskId, payload: { message: "WRITE:auto.txt:hello" } });
      const completed = await sock.waitFor("tool.completed", 15_000);
      expect(completed.payload?.tool?.isError).toBeFalsy();
      const written = await import("node:fs/promises").then((fs) => fs.readFile(path.join(project, "auto.txt"), "utf8"));
      expect(written).toBe("hello");
      await new Promise<void>((resolve, reject) => {
        const start = Date.now();
        const tick = () => {
          const match = sock.events.find(
            (event) => event.type === "agent.status" && event.taskId === taskId && event.payload?.status === "idle",
          );
          if (match) return resolve();
          if (Date.now() - start > 4000) return reject(new Error("auto-write did not settle"));
          setTimeout(tick, 25);
        };
        tick();
      });

      sock.send({
        id: "set-ask",
        type: "task.policy.set",
        taskId,
        payload: { mode: "ask", approvalPolicy: "ask" },
      });
      await sock.waitForRequest("set-ask");
      sock.send({ id: "ask-write", type: "prompt.send", taskId, payload: { message: "WRITE:blocked-ask.txt:nope" } });
      await sock.waitFor("approval.requested");
      await sock.waitFor("tool.completed");
      await expect(import("node:fs/promises").then((fs) => fs.access(path.join(project, "blocked-ask.txt")))).rejects.toThrow();
      await new Promise((r) => setTimeout(r, 400));

      sock.send({ id: "plain", type: "prompt.send", taskId, payload: { message: "fork source hello" } });
      await sock.waitFor("message.completed");
      sock.send({ id: "snap-fork", type: "snapshot.request", payload: { taskId } });
      const snap = await sock.waitFor("snapshot");
      const user = snap.payload?.messages?.find((message) => message.text.includes("fork source hello"));
      expect(user?.text).toBeTruthy();
      const snapshotData = isolated.service.buildSnapshot(taskId) as {
        messages: Array<{ id: string; role: string; text: string }>;
      };
      const userMessage = snapshotData.messages.find(
        (message) => message.role === "user" && message.text.includes("fork source hello"),
      );
      expect(userMessage).toBeTruthy();
      sock.send({
        id: "fork",
        type: "session.fork",
        taskId,
        payload: { messageId: userMessage!.id, message: "after fork" },
      });
      await sock.waitForRequest("fork");
      sock.ws.close();
    } finally {
      await isolated.app.close();
    }
  }, 20_000);

  it("lists Pi resources, session tree, resume, and runtime flags", async () => {
    const isolated = await listen({
      HOST: "127.0.0.1",
      PORT: "0",
      NODE_ENV: "test",
      PI_BIN: fakePi,
      QINGZHOU_DATA_DIR: path.join(root.current, "data-mvp"),
      QINGZHOU_ALLOWED_ROOTS: root.current,
      QINGZHOU_MAX_PROCESSES: "3",
      QINGZHOU_MUTATIONS: "approval",
      QINGZHOU_HOME_DIR: root.current,
    });
    const project = path.join(root.current, "project");
    await writeFile(path.join(project, "AGENTS.md"), "# project agents");
    await mkdir(path.join(root.current, ".pi", "agent", "skills", "demo"), { recursive: true });
    await writeFile(path.join(root.current, ".pi", "agent", "skills", "demo", "SKILL.md"), "# demo");
    await mkdir(path.join(root.current, ".pi", "agent", "extensions"), { recursive: true });
    await writeFile(path.join(root.current, ".pi", "agent", "extensions", "demo-ext.ts"), "export default function() {}");
    const sessionDir = path.join(root.current, ".pi", "agent", "sessions", "project");
    await mkdir(sessionDir, { recursive: true });
    const sessionPath = path.join(sessionDir, "resume.jsonl");
    await writeFile(
      sessionPath,
      [
        JSON.stringify({ type: "session", id: "resume-1", cwd: project }),
        JSON.stringify({
          type: "message",
          message: { role: "user", content: [{ type: "text", text: "resumed hello" }] },
        }),
      ].join("\n"),
    );

    try {
      const sock = await openSocket(isolated.base);
      await sock.waitFor("snapshot");
      sock.send({ id: "c-mvp", type: "task.create", payload: { cwd: project, title: "MVP" } });
      const created = await sock.waitForRequest("c-mvp");
      const taskId = created.payload?.data?.task?.id as string;

      sock.send({ id: "res", type: "resources.list", taskId, payload: {} });
      const resources = await sock.waitFor("resources.updated");
      expect(JSON.stringify(resources.payload)).toMatch(/AGENTS\.md/);
      expect(JSON.stringify(resources.payload)).toMatch(/demo/);
      expect(JSON.stringify(resources.payload)).toMatch(/demo-ext/);

      const beforePrompt = sock.events.length;
      sock.send({ id: "p-tree", type: "prompt.send", taskId, payload: { message: "branch source" } });
      await new Promise<void>((resolve, reject) => {
        const start = Date.now();
        const tick = () => {
          const match = sock.events.slice(beforePrompt).find(
            (event) =>
              event.type === "agent.status" && event.taskId === taskId && event.payload?.status === "idle",
          );
          if (match) return resolve();
          if (Date.now() - start > 4000) return reject(new Error("tree prompt did not settle"));
          setTimeout(tick, 25);
        };
        tick();
      });
      sock.send({ id: "tree", type: "session.tree", taskId, payload: {} });
      const tree = await sock.waitForRequest("tree");
      const userNode = (
        tree.payload?.data as { nodes?: Array<{ id: string; role: string }> } | undefined
      )?.nodes?.find((node) => node.role === "user");
      expect(userNode?.id).toBeTruthy();
      sock.send({
        id: "branch",
        type: "session.branch",
        taskId,
        payload: { entryId: userNode!.id, message: "after branch" },
      });
      await sock.waitForRequest("branch");

      const beforeRuntimeSet = sock.events.length;
      // Keep an old metadata event in the buffer while applying the settings.
      isolated.service.supervisor.patchRuntime(taskId, {});
      await sock.waitFor("runtime.status", 12_000, beforeRuntimeSet);
      sock.send({ id: "rt", type: "runtime.set", taskId, payload: { autoCompaction: false, autoRetry: false, fastMode: true } });
      const runtimeSet = await sock.waitForRequest("rt");
      expect(runtimeSet.type, runtimeSet.payload?.error).toBe("request.succeeded");
      await vi.waitFor(() => {
        const runtime = sock.events.slice(beforeRuntimeSet)
          .filter((event) => event.type === "runtime.status" && event.taskId === taskId)
          .at(-1);
        expect(runtime?.payload).toMatchObject({
          autoCompaction: false, autoRetry: false, fastModeEnabled: true, fastModeActive: true,
        });
      }, { timeout: 5000 });

      sock.send({ id: "list", type: "sessions.list", payload: {} });
      const listed = await sock.waitFor("sessions.listed");
      expect(JSON.stringify(listed.payload)).toMatch(/resumed hello/);
      sock.send({
        id: "resume",
        type: "session.resume",
        payload: { sessionPath, cwd: project, title: "Resumed" },
      });
      const resumed = await sock.waitForRequest("resume");
      expect(resumed.type).toBe("request.succeeded");
      sock.ws.close();
    } finally {
      await isolated.app.close();
    }
  }, 20_000);

  it("rejects foreign origins", async () => {
    const health = await fetch(`${ctx.base}/health`);
    const cookie = health.headers.get("set-cookie")?.split(";")[0] ?? "";
    const ws = new WebSocket(ctx.base.replace("http", "ws") + "/ws", {
      headers: { Origin: "http://evil.example", Cookie: cookie },
    });
    const code = await new Promise<number>((resolve) => {
      ws.on("close", (value) => resolve(value));
      ws.on("error", () => resolve(1008));
    });
    expect(code === 1008 || code === 1006).toBe(true);
  });

  it("times out pending approvals and ignores events after abort", async () => {
    const timed = await listen({
      HOST: "127.0.0.1",
      PORT: "0",
      NODE_ENV: "test",
      PI_BIN: fakePi,
      QINGZHOU_DATA_DIR: path.join(root.current, "data-timeout"),
      QINGZHOU_ALLOWED_ROOTS: root.current,
      QINGZHOU_MAX_PROCESSES: "3",
      QINGZHOU_MUTATIONS: "approval",
      QINGZHOU_APPROVAL_TIMEOUT_MS: "200",
    });
    try {
      const project = path.join(root.current, "project");
      const sock = await openSocket(timed.base);
      await sock.waitFor("snapshot");
      sock.send({ id: "c", type: "task.create", payload: { cwd: project, title: "Timeout" } });
      const created = await sock.waitFor("request.succeeded");
      const taskId = created?.payload?.data?.task?.id as string;
      sock.send({
        id: "ask-policy",
        type: "task.policy.set",
        taskId,
        payload: { mode: "agent", approvalPolicy: "ask" },
      });
      await sock.waitForRequest("ask-policy");
      sock.send({ id: "w", type: "prompt.send", taskId, payload: { message: "WRITE:late.txt:nope" } });
      await sock.waitFor("approval.requested");
      const resolved = await sock.waitFor("approval.resolved", 4000);
      expect(resolved.payload).toBeTruthy();
      await sock.waitFor("tool.completed", 4000);
      await new Promise((r) => setTimeout(r, 300));
      await expect(import("node:fs/promises").then((fs) => fs.access(path.join(project, "late.txt")))).rejects.toThrow();

      sock.send({ id: "p", type: "prompt.send", taskId, payload: { message: "hello from abort path please stream slowly" } });
      await sock.waitFor("message.delta");
      const beforeAbort = sock.events.length;
      sock.send({ id: "ab", type: "agent.abort", taskId, payload: {} });
      const idle = await new Promise<EventMsg>((resolve, reject) => {
        const start = Date.now();
        const tick = () => {
          const match = sock.events.slice(beforeAbort).find(
            (event) =>
              event.type === "agent.status" &&
              event.taskId === taskId &&
              (event.payload?.status === "idle" || event.payload?.status === "stopped"),
          );
          if (match) return resolve(match);
          if (Date.now() - start > 2000) return reject(new Error("abort did not settle"));
          setTimeout(tick, 20);
        };
        tick();
      });
    expect(idle.payload?.status).toBe("idle");
    sock.ws.close();
    } finally {
      await timed.app.close();
    }
  }, 15_000);

  it("refreshes model list on warm activate without requiring a prompt", async () => {
    const isolated = await listen({
      HOST: "127.0.0.1",
      PORT: "0",
      NODE_ENV: "test",
      PI_BIN: fakePi,
      QINGZHOU_DATA_DIR: path.join(root.current, "data-models-refresh"),
      QINGZHOU_ALLOWED_ROOTS: root.current,
      QINGZHOU_MAX_PROCESSES: "3",
      QINGZHOU_MUTATIONS: "approval",
      QINGZHOU_HOME_DIR: root.current,
    });
    const project = path.join(root.current, "project");
    try {
      const sock = await openSocket(isolated.base);
      await sock.waitFor("snapshot");
      sock.send({
        id: "c-models",
        type: "task.create",
        payload: { cwd: project, title: "Models" },
      });
      const created = await sock.waitForRequest("c-models");
      const taskId = (created.payload?.data as { task?: { id: string } } | undefined)?.task?.id as string;
      expect(taskId).toBeTruthy();

      const firstModels = await sock.waitFor("models.updated");
      expect(
        ((firstModels.payload as { models?: unknown[] } | undefined)?.models ?? []).length,
      ).toBeGreaterThan(0);

      const beforeWarm = sock.events.length;
      sock.send({ id: "act-warm", type: "task.activate", taskId, payload: {} });
      await sock.waitForRequest("act-warm");
      const warmModels = await new Promise<EventMsg>((resolve, reject) => {
        const start = Date.now();
        const tick = () => {
          const match = sock.events.slice(beforeWarm).find((event) => event.type === "models.updated");
          if (match) return resolve(match);
          if (Date.now() - start > 8000) return reject(new Error("warm activate did not refresh models"));
          setTimeout(tick, 25);
        };
        tick();
      });
      expect(((warmModels.payload as { models?: unknown[] } | undefined)?.models ?? []).length).toBeGreaterThan(0);
      sock.ws.close();
    } finally {
      await isolated.app.close();
    }
  }, 20_000);

  it("attaches @file contents, queues follow_up, and round-trips select/input/notify", async () => {
    const isolated = await listen({
      HOST: "127.0.0.1",
      PORT: "0",
      NODE_ENV: "test",
      PI_BIN: fakePi,
      QINGZHOU_DATA_DIR: path.join(root.current, "data-gui"),
      QINGZHOU_ALLOWED_ROOTS: root.current,
      QINGZHOU_MAX_PROCESSES: "3",
      QINGZHOU_MUTATIONS: "approval",
      QINGZHOU_HOME_DIR: root.current,
    });
    const project = path.join(root.current, "project");
    try {
    const sock = await openSocket(isolated.base);
    await sock.waitFor("snapshot");
    sock.send({ id: "c-gui", type: "task.create", payload: { cwd: project, title: "GUI phases" } });
    const created = await sock.waitFor("request.succeeded");
    const taskId = created?.payload?.data?.task?.id as string;

    sock.send({ id: "p-file", type: "prompt.send", taskId, payload: { message: "please read @README.md" } });
    expect((await sock.waitForRequest("p-file")).type).toBe("request.succeeded");
    const attached = await new Promise<EventMsg>((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        const match = sock.events.find(
          (event) =>
            event.type === "message.completed" &&
            JSON.stringify(event.payload).includes("Attached file: README.md") &&
            JSON.stringify(event.payload).includes("hello"),
        );
        if (match) return resolve(match);
        if (Date.now() - start > 6000) return reject(new Error("@file contents were not attached"));
        setTimeout(tick, 25);
      };
      tick();
    });
    expect(JSON.stringify(attached.payload)).toMatch(/README\.md/);
    await new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        const match = sock.events.find(
          (event) =>
            event.type === "agent.status" && event.taskId === taskId && event.payload?.status === "idle",
        );
        if (match) return resolve();
        if (Date.now() - start > 6000) return reject(new Error("@file turn did not settle"));
        setTimeout(tick, 25);
      };
      tick();
    });

    sock.send({
      id: "p-slow",
      type: "prompt.send",
      taskId,
      payload: { message: "please stream this slowly keep going now" },
    });
    await sock.waitFor("message.delta");
    sock.send({ id: "fu", type: "prompt.followUp", taskId, payload: { message: "queued next" } });
    const follow = await sock.waitForRequest("fu");
    expect(follow.type).toBe("request.succeeded");
    await new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        const match = sock.events.find((event) => JSON.stringify(event.payload).includes("Follow-up: queued next"));
        if (match) return resolve();
        if (Date.now() - start > 8000) return reject(new Error("follow_up did not run"));
        setTimeout(tick, 25);
      };
      tick();
    });

    await new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        const match = sock.events.find(
          (event) =>
            event.type === "agent.status" && event.taskId === taskId && event.payload?.status === "idle",
        );
        if (match) return resolve();
        if (Date.now() - start > 10_000) return reject(new Error("follow_up turn did not settle"));
        setTimeout(tick, 25);
      };
      tick();
    });

    sock.send({ id: "p-sel", type: "prompt.send", taskId, payload: { message: "SELECT:alpha|beta" } });
    const requested = await sock.waitFor("interaction.requested");
    const requestId = (requested.payload as { interaction?: { requestId?: string } } | undefined)?.interaction
      ?.requestId;
    expect(requestId).toBeTruthy();
    sock.send({
      id: "sel",
      type: "interaction.respond",
      taskId,
      payload: { requestId, value: "alpha" },
    });
    const afterSelect = sock.events.length;
    await sock.waitForRequest("sel");
    await new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        const match = sock.events.find((event) => JSON.stringify(event.payload).includes("Selected: alpha"));
        if (match) return resolve();
        if (Date.now() - start > 6000) return reject(new Error("select did not complete"));
        setTimeout(tick, 25);
      };
      tick();
    });
    await new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        const match = sock.events.slice(afterSelect).find(
          (event) =>
            event.type === "agent.status" && event.taskId === taskId && event.payload?.status === "idle",
        );
        if (match) return resolve();
        if (Date.now() - start > 6000) return reject(new Error("select turn did not settle"));
        setTimeout(tick, 25);
      };
      tick();
    });

    sock.send({ id: "p-in", type: "prompt.send", taskId, payload: { message: "INPUT:your name" } });
    const inputRequested = await sock.waitFor("interaction.requested");
    const inputId = (inputRequested.payload as { interaction?: { requestId?: string } } | undefined)?.interaction
      ?.requestId;
    expect(inputId).toBeTruthy();
    sock.send({
      id: "in",
      type: "interaction.respond",
      taskId,
      payload: { requestId: inputId, value: "Ada" },
    });
    const afterInput = sock.events.length;
    await sock.waitForRequest("in");
    await new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        const match = sock.events.find((event) => JSON.stringify(event.payload).includes("Input: Ada"));
        if (match) return resolve();
        if (Date.now() - start > 6000) return reject(new Error("input did not complete"));
        setTimeout(tick, 25);
      };
      tick();
    });
    await new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        const match = sock.events.slice(afterInput).find(
          (event) =>
            event.type === "agent.status" && event.taskId === taskId && event.payload?.status === "idle",
        );
        if (match) return resolve();
        if (Date.now() - start > 6000) return reject(new Error("input turn did not settle"));
        setTimeout(tick, 25);
      };
      tick();
    });

    const beforeNotify = sock.events.length;
    sock.send({ id: "p-note", type: "prompt.send", taskId, payload: { message: "NOTIFY:heads-up" } });
    await new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        const shown = sock.events.slice(beforeNotify).find(
          (event) =>
            event.type === "notification.shown" &&
            (event.payload as { message?: string } | undefined)?.message === "heads-up",
        );
        const echoed = sock.events.slice(beforeNotify).find((event) =>
          JSON.stringify(event.payload).includes("Notified: heads-up"),
        );
        if (shown && echoed) return resolve();
        if (Date.now() - start > 6000) return reject(new Error("notify did not complete"));
        setTimeout(tick, 25);
      };
      tick();
    });

    sock.send({ id: "open", type: "files.open", taskId, payload: { path: "README.md" } });
    const opened = await sock.waitForRequest("open");
    expect(opened.type).toBe("request.succeeded");
    sock.send({ id: "reload", type: "resources.reload", taskId, payload: {} });
    await sock.waitForRequest("reload");
    sock.ws.close();
    } finally {
      await isolated.app.close();
    }
  }, 35_000);

  it("runs a work objective and leaves it waiting for human acceptance", async () => {
    const isolated = await listen({
      HOST: "127.0.0.1",
      PORT: "0",
      NODE_ENV: "test",
      PI_BIN: fakePi,
      QINGZHOU_DATA_DIR: path.join(root.current, "data-board"),
      QINGZHOU_ALLOWED_ROOTS: root.current,
      QINGZHOU_MAX_PROCESSES: "2",
      QINGZHOU_MUTATIONS: "approval",
      QINGZHOU_HOME_DIR: root.current,
    });
    try {
      const project = path.join(root.current, "project");
      const sock = await openSocket(isolated.base);
      await sock.waitFor("snapshot");
      sock.send({
        id: "wi-create",
        type: "workItem.create",
        payload: {
          title: "board job",
          cwd: project,
          description: "do the thing",
          acceptanceCriteria: "report the result",
          start: true,
        },
      });
      const created = await sock.waitForRequest("wi-create");
      const itemId = (created.payload?.data as { item?: { id: string; state: string } } | undefined)?.item?.id;
      expect(itemId).toBeTruthy();
      expect((created.payload?.data as { item?: { state: string } } | undefined)?.item?.state).toBe("open");

      const start = Date.now();
      let waitingForAcceptance = false;
      while (Date.now() - start < 12_000) {
        const hasPrompt = JSON.stringify(sock.events).includes("请完成下面这个工作目标");
        const listed = sock.events.filter((event) => event.type === "workItems.updated");
        const latest = listed.at(-1)?.payload as
          | { items?: Array<{ id: string; state: string; latestRun: { status: string } | null }> }
          | undefined;
        const item = latest?.items?.find((entry) => entry.id === itemId);
        const settled = sock.events.some(
          (event) => event.type === "agent.status" && (event.payload as { status?: string } | undefined)?.status === "idle",
        );
        if (hasPrompt && item?.state === "open" && item.latestRun?.status === "succeeded" && settled) {
          waitingForAcceptance = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(JSON.stringify(sock.events)).toMatch(/请完成下面这个工作目标/);
      expect(waitingForAcceptance).toBe(true);

      sock.send({ id: "wi-accept", type: "workItem.accept", payload: { id: itemId } });
      const accepted = await sock.waitForRequest("wi-accept");
      expect((accepted.payload?.data as { item?: { state: string } } | undefined)?.item?.state).toBe("completed");
      sock.ws.close();
    } finally {
      await isolated.app.close();
    }
  }, 20_000);
});
