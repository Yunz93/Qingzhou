import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../apps/server/src/config.ts";
import { TaskService } from "../../apps/server/src/tasks/task-service.ts";
import { TaskStore } from "../../apps/server/src/tasks/task-store.ts";
import { WorkItemStore } from "../../apps/server/src/tasks/work-item-store.ts";
import type { TaskRecord } from "@qingzhou/protocol";

function task(id: string, cwd: string): TaskRecord {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id,
    title: id,
    cwd,
    sessionPath: null,
    status: "stopped",
    model: null,
    thinkingLevel: "off",
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    archivedAt: null,
    unreadCount: 0,
    errorMessage: null,
    mode: "agent",
    approvalPolicy: "ask",
  };
}

describe("task service process reservations", () => {
  it("edits one queued prompt and replays the queues in order", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mypi-queue-edit-"));
    const store = new TaskStore(root);
    await store.load();
    const taskId = "55555555-5555-4555-8555-555555555555";
    await store.upsert({ ...task(taskId, root), status: "running" });
    const config: AppConfig = {
      host: "127.0.0.1",
      port: 0,
      piBin: "pi",
      piCommand: "pi",
      piPrefixArgs: [],
      piExtraEnv: {},
      dataDir: root,
      allowedRoots: [root],
      maxProcesses: 1,
      mutations: "approval",
      nodeEnv: "test",
      approvalTimeoutMs: 1000,
      allowedOrigins: [],
      webDistDir: root,
      approvalExtensionPath: path.join(root, "approval.ts"),
      homeDir: root,
      piBundled: false,
      piAgentDir: path.join(root, ".pi", "agent"),
      trustProject: false,
    };
    const service = new TaskService(config, store, "test", null);
    vi.spyOn(service.supervisor, "has").mockReturnValue(true);
    const rpc = vi.spyOn(service.supervisor, "rpcData").mockImplementation(async (_id, command) => {
      if (command.type === "clear_queue") {
        return { steering: ["first"], followUp: ["old text", "last"] };
      }
      return {};
    });

    await service.handleCommand({
      id: "queue-edit",
      type: "prompt.queue.edit",
      taskId,
      payload: { kind: "followUp", index: 0, previousMessage: "old text", message: "corrected" },
    });

    expect(rpc.mock.calls.map(([, command]) => command)).toEqual([
      { type: "clear_queue" },
      { type: "steer", message: "first" },
      { type: "follow_up", message: "corrected" },
      { type: "follow_up", message: "last" },
    ]);
    service.dispose();
  });

  it("boots a task once and reserves the process slot before awaiting", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mypi-service-"));
    const store = new TaskStore(root);
    await store.load();
    const firstId = "11111111-1111-4111-8111-111111111111";
    const secondId = "22222222-2222-4222-8222-222222222222";
    await store.upsert(task(firstId, root));
    await store.upsert(task(secondId, root));
    const config: AppConfig = {
      host: "127.0.0.1",
      port: 0,
      piBin: "pi",
      piCommand: "pi",
      piPrefixArgs: [],
      piExtraEnv: {},
      dataDir: root,
      allowedRoots: [root],
      maxProcesses: 1,
      mutations: "approval",
      nodeEnv: "test",
      approvalTimeoutMs: 1000,
      allowedOrigins: [],
      webDistDir: root,
      approvalExtensionPath: path.join(root, "approval.ts"),
      homeDir: root,
      piBundled: false,
      piAgentDir: path.join(root, ".pi", "agent"),
      trustProject: false,
    };
    const service = new TaskService(config, store, "test", null);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const boot = vi.spyOn(service.supervisor, "boot").mockImplementation(async () => {
      await gate;
      return { sessionPath: null, model: null, thinkingLevel: "off" };
    });
    vi.spyOn(service.supervisor, "rpcData").mockResolvedValue({});

    const first = service.activate(firstId);
    const duplicate = service.activate(firstId);
    await vi.waitFor(() => expect(boot).toHaveBeenCalledTimes(1));
    await service.activate(secondId);
    expect(store.get(secondId)?.status).toBe("queued");

    release();
    await Promise.all([first, duplicate]);
  });

  it("stays aborting until Pi settles instead of flipping idle on abort ack", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mypi-abort-"));
    const store = new TaskStore(root);
    await store.load();
    const taskId = "33333333-3333-4333-8333-333333333333";
    await store.upsert({ ...task(taskId, root), status: "running" });
    const config: AppConfig = {
      host: "127.0.0.1",
      port: 0,
      piBin: "pi",
      piCommand: "pi",
      piPrefixArgs: [],
      piExtraEnv: {},
      dataDir: root,
      allowedRoots: [root],
      maxProcesses: 1,
      mutations: "approval",
      nodeEnv: "test",
      approvalTimeoutMs: 1000,
      allowedOrigins: [],
      webDistDir: root,
      approvalExtensionPath: path.join(root, "approval.ts"),
      homeDir: root,
      piBundled: false,
      piAgentDir: path.join(root, ".pi", "agent"),
      trustProject: false,
    };
    const service = new TaskService(config, store, "test", null);
    vi.spyOn(service.supervisor, "has").mockReturnValue(true);
    vi.spyOn(service.supervisor, "rpc").mockResolvedValue({ success: true });

    await service.handleCommand({
      id: "abort-1",
      type: "agent.abort",
      taskId,
      payload: {},
    });
    expect(store.get(taskId)?.status).toBe("aborting");
    service.dispose();
  });

  it("emits tasks.reordered after persisting a cwd group", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mypi-reorder-"));
    const store = new TaskStore(root);
    await store.load();
    const firstId = "11111111-1111-4111-8111-111111111111";
    const secondId = "22222222-2222-4222-8222-222222222222";
    await store.upsert(task(firstId, root));
    await store.upsert(task(secondId, root));
    const config: AppConfig = {
      host: "127.0.0.1",
      port: 0,
      piBin: "pi",
      piCommand: "pi",
      piPrefixArgs: [],
      piExtraEnv: {},
      dataDir: root,
      allowedRoots: [root],
      maxProcesses: 1,
      mutations: "approval",
      nodeEnv: "test",
      approvalTimeoutMs: 1000,
      allowedOrigins: [],
      webDistDir: root,
      approvalExtensionPath: path.join(root, "approval.ts"),
      homeDir: root,
      piBundled: false,
      piAgentDir: path.join(root, ".pi", "agent"),
      trustProject: false,
    };
    const service = new TaskService(config, store, "test", null);
    const emit = vi.spyOn(service, "emit");
    await service.handleCommand({
      id: "reorder-1",
      type: "task.reorder",
      payload: { cwd: root, taskIds: [firstId, secondId] },
    });
    expect(store.listVisible().map((item) => item.id)).toEqual([firstId, secondId]);
    expect(emit).toHaveBeenCalledWith("", "tasks.reordered", { cwd: root, taskIds: [firstId, secondId] });
    service.dispose();
  });

  it("rejects conversation prompts that skip a work item execution record", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mypi-work-prompt-"));
    const store = new TaskStore(root);
    await store.load();
    const taskId = "44444444-4444-4444-8444-444444444444";
    await store.upsert({ ...task(taskId, root), status: "idle" });
    const workItems = new WorkItemStore(root);
    await workItems.load();
    const item = await workItems.create({ title: "board job", cwd: root });
    await workItems.createRun({
      objectiveId: item.id,
      taskId,
      kind: "initial",
      instruction: "do the recorded turn",
    });
    const succeeded = workItems.activeRunForTask(taskId);
    expect(succeeded).toBeTruthy();
    await workItems.updateRun(succeeded!.id, { status: "succeeded" });
    const config: AppConfig = {
      host: "127.0.0.1",
      port: 0,
      piBin: "pi",
      piCommand: "pi",
      piPrefixArgs: [],
      piExtraEnv: {},
      dataDir: root,
      allowedRoots: [root],
      maxProcesses: 1,
      mutations: "approval",
      nodeEnv: "test",
      approvalTimeoutMs: 1000,
      allowedOrigins: [],
      webDistDir: root,
      approvalExtensionPath: path.join(root, "approval.ts"),
      homeDir: root,
      piBundled: false,
      piAgentDir: path.join(root, ".pi", "agent"),
      trustProject: false,
    };
    const service = new TaskService(config, store, "test", null, workItems);
    vi.spyOn(service.supervisor, "has").mockReturnValue(true);
    const rpc = vi.spyOn(service.supervisor, "rpcData").mockResolvedValue({});
    await expect(
      service.handleCommand({
        id: "p1",
        type: "prompt.send",
        taskId,
        payload: { message: "chat anyway" },
      }),
    ).rejects.toThrow(/执行记录/);
    expect(rpc).not.toHaveBeenCalled();
    await expect(
      service.handleCommand({
        id: "c1",
        type: "session.clone",
        taskId,
        payload: {},
      }),
    ).rejects.toThrow(/分叉/);
    service.dispose();
  });
});

describe("task service default model", () => {
  it("writes Pi settings and includes defaultModel on the snapshot", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qingzhou-default-model-svc-"));
    const store = new TaskStore(root);
    await store.load();
    const taskId = "66666666-6666-4666-8666-666666666666";
    await store.upsert(task(taskId, root));
    const agentDir = path.join(root, ".pi", "agent");
    const config: AppConfig = {
      host: "127.0.0.1",
      port: 0,
      piBin: "pi",
      piCommand: "pi",
      piPrefixArgs: [],
      piExtraEnv: {},
      dataDir: root,
      allowedRoots: [root],
      maxProcesses: 1,
      mutations: "approval",
      nodeEnv: "test",
      approvalTimeoutMs: 1000,
      allowedOrigins: [],
      webDistDir: root,
      approvalExtensionPath: path.join(root, "approval.ts"),
      homeDir: root,
      piBundled: false,
      piAgentDir: agentDir,
      trustProject: false,
    };
    const service = new TaskService(config, store, "test", null);
    const result = (await service.handleCommand({
      id: "default",
      type: "model.default.set",
      taskId,
      payload: { provider: "openai", modelId: "gpt-5.4" },
    })) as { ok: true; defaultModel: { provider: string; id: string } };
    expect(result.defaultModel).toEqual({ provider: "openai", id: "gpt-5.4" });
    expect(service.buildSnapshot(taskId).defaultModel).toEqual({ provider: "openai", id: "gpt-5.4" });
    const settings = JSON.parse(await readFile(path.join(agentDir, "settings.json"), "utf8")) as {
      defaultProvider: string;
      defaultModel: string;
    };
    expect(settings.defaultProvider).toBe("openai");
    expect(settings.defaultModel).toBe("gpt-5.4");
    service.dispose();
  });
});
