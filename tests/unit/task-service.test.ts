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

    // activate no longer awaits boot — wait on the boot Promise itself.
    await Promise.all([first, duplicate]);
    await vi.waitFor(() => expect(store.get(firstId)?.status).toBe("booting"));
    release();
    await vi.waitFor(() => expect(store.get(firstId)?.status).toBe("idle"));
    service.dispose();
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

  it.each([false, true])("waits for Pi boot before prompting when runtime already exists: %s", async (runtimeExistsBeforeReady) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mypi-bg-boot-"));
    const store = new TaskStore(root);
    await store.load();
    const config: AppConfig = {
      host: "127.0.0.1",
      port: 0,
      piBin: "pi",
      piCommand: "pi",
      piPrefixArgs: [],
      piExtraEnv: {},
      dataDir: root,
      allowedRoots: [root],
      maxProcesses: 2,
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
    const publishedStatuses: string[] = [];
    service.addSocket({ closed: false, send: (data) => {
      const event = JSON.parse(data);
      if (event.type === "task.updated") publishedStatuses.push(event.payload.task.status);
    } });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let hasRuntime = false;
    vi.spyOn(service.supervisor, "boot").mockImplementation(async () => {
      hasRuntime = runtimeExistsBeforeReady;
      await gate;
      hasRuntime = true;
      return { sessionPath: null, model: null, thinkingLevel: "off" };
    });
    vi.spyOn(service.supervisor, "has").mockImplementation(() => hasRuntime);
    const rpc = vi.spyOn(service.supervisor, "rpcData").mockResolvedValue({});
    vi.spyOn(service.supervisor, "setPendingClientMessageId").mockImplementation(() => undefined);

    const created = (await service.handleCommand({
      id: "create",
      type: "task.create",
      payload: { cwd: root, title: "bg boot" },
    })) as { task: TaskRecord };
    expect(created.task.id).toBeTruthy();
    await vi.waitFor(() => expect(service.supervisor.boot).toHaveBeenCalled());
    expect(hasRuntime).toBe(runtimeExistsBeforeReady);

    const clientMessageId = "77777777-7777-4777-8777-777777777777";
    const promptPromise = service.handleCommand({
      id: "prompt",
      type: "prompt.send",
      taskId: created.task.id,
      payload: { message: "hello after create", clientMessageId },
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(rpc).not.toHaveBeenCalled();
    release();
    await expect(promptPromise).resolves.toEqual({ ok: true });
    expect(publishedStatuses).toContain("booting");
    const readyIndex = publishedStatuses.indexOf("idle");
    expect(readyIndex).toBeGreaterThanOrEqual(0);
    expect(publishedStatuses.slice(readyIndex + 1)).not.toContain("booting");
    expect(service.listTasks().find((item) => item.id === created.task.id)?.status).toBe("running");
    expect(rpc).toHaveBeenCalledWith(
      created.task.id,
      expect.objectContaining({ type: "prompt", message: expect.stringContaining("hello after create") }),
    );
    expect(service.supervisor.setPendingClientMessageId).toHaveBeenCalledWith(created.task.id, clientMessageId);
    service.dispose();
  });

  it("archives without waiting on drainQueue boot and ignores late boot updates", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mypi-archive-"));
    const store = new TaskStore(root);
    await store.load();
    const activeId = "77777777-7777-4777-8777-777777777777";
    const queuedId = "88888888-8888-4888-8888-888888888888";
    await store.upsert({ ...task(activeId, root), status: "idle" });
    await store.upsert({ ...task(queuedId, root), status: "queued" });
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
    (service as unknown as { queue: string[] }).queue.push(queuedId);
    vi.spyOn(service.supervisor, "has").mockReturnValue(true);
    const stop = vi.spyOn(service.supervisor, "stop").mockResolvedValue(undefined);
    let releaseBoot!: () => void;
    const bootGate = new Promise<void>((resolve) => {
      releaseBoot = resolve;
    });
    const boot = vi.spyOn(service.supervisor, "boot").mockImplementation(async () => {
      await bootGate;
      return { sessionPath: null, model: null, thinkingLevel: "off" };
    });
    const events: Array<{ type: string }> = [];
    service.addSocket({
      closed: false,
      send: (raw) => {
        const parsed = JSON.parse(String(raw)) as { type?: string };
        if (parsed.type) events.push({ type: parsed.type });
      },
    });

    const archived = await service.handleCommand({
      id: "arch-1",
      type: "task.archive",
      taskId: activeId,
      payload: {},
    });
    expect(archived).toEqual({ ok: true });
    expect(store.get(activeId)?.archivedAt).toBeTruthy();
    expect(events.some((event) => event.type === "task.archived")).toBe(true);
    // stop + drainQueue run in the background after the RPC returns.
    await vi.waitFor(() => expect(stop).toHaveBeenCalledWith(activeId));
    await vi.waitFor(() => expect(boot).toHaveBeenCalledTimes(1));
    releaseBoot();
    await vi.waitFor(() => expect(store.get(queuedId)?.status).toBe("idle"));
    expect(store.get(activeId)?.archivedAt).toBeTruthy();
    service.dispose();
  });
});

describe("task / work-item archive linkage", () => {
  function baseConfig(root: string): AppConfig {
    return {
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
  }

  it("archives the linked work item when the work session is archived", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qingzhou-archive-link-task-"));
    const store = new TaskStore(root);
    await store.load();
    const workItems = new WorkItemStore(root);
    await workItems.load();
    const taskId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await store.upsert({ ...task(taskId, root), status: "idle", title: "fix login" });
    const item = await workItems.create({ title: "fix login", cwd: root });
    await workItems.createRun({
      objectiveId: item.id,
      taskId,
      kind: "initial",
      instruction: "do it",
    });
    expect(workItems.get(item.id)?.taskId).toBe(taskId);

    const service = new TaskService(baseConfig(root), store, "test", null, workItems);
    vi.spyOn(service.supervisor, "stop").mockResolvedValue(undefined);
    vi.spyOn(service.supervisor, "has").mockReturnValue(false);

    await service.handleCommand({ id: "arch", type: "task.archive", taskId, payload: {} });
    expect(store.get(taskId)?.archivedAt).toBeTruthy();
    expect(workItems.get(item.id)?.state).toBe("archived");
    expect(workItems.get(item.id)?.archivedAt).toBeTruthy();
    service.dispose();
  });

  it("archives the linked work session when the work item is archived", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qingzhou-archive-link-item-"));
    const store = new TaskStore(root);
    await store.load();
    const workItems = new WorkItemStore(root);
    await workItems.load();
    const taskId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await store.upsert({ ...task(taskId, root), status: "idle", title: "ship docs" });
    const item = await workItems.create({ title: "ship docs", cwd: root });
    await workItems.createRun({
      objectiveId: item.id,
      taskId,
      kind: "initial",
      instruction: "write docs",
    });
    await workItems.setState(item.id, "completed");

    const service = new TaskService(baseConfig(root), store, "test", null, workItems);
    vi.spyOn(service.supervisor, "stop").mockResolvedValue(undefined);
    vi.spyOn(service.supervisor, "has").mockReturnValue(false);

    await service.handleCommand({ id: "arch-item", type: "workItem.archive", payload: { id: item.id } });
    expect(workItems.get(item.id)?.state).toBe("archived");
    expect(store.get(taskId)?.archivedAt).toBeTruthy();
    expect(service.listTasks().some((entry) => entry.id === taskId)).toBe(false);
    service.dispose();
  });

  it("restores the linked work item when the work session is restored", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qingzhou-archive-link-restore-"));
    const store = new TaskStore(root);
    await store.load();
    const workItems = new WorkItemStore(root);
    await workItems.load();
    const taskId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await store.upsert({ ...task(taskId, root), status: "idle" });
    const item = await workItems.create({ title: "paired restore", cwd: root });
    await workItems.createRun({
      objectiveId: item.id,
      taskId,
      kind: "initial",
      instruction: "go",
    });
    await workItems.setState(item.id, "completed");

    const service = new TaskService(baseConfig(root), store, "test", null, workItems);
    vi.spyOn(service.supervisor, "stop").mockResolvedValue(undefined);
    vi.spyOn(service.supervisor, "has").mockReturnValue(false);

    await service.handleCommand({ id: "arch", type: "task.archive", taskId, payload: {} });
    expect(workItems.get(item.id)?.state).toBe("archived");

    await service.handleCommand({ id: "restore", type: "task.restore", taskId, payload: {} });
    expect(store.get(taskId)?.archivedAt).toBeNull();
    expect(workItems.get(item.id)?.state).toBe("completed");
    expect(workItems.get(item.id)?.archivedAt).toBeNull();
    service.dispose();
  });

  it("restores the linked work session when the work item is reopened", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qingzhou-archive-link-reopen-"));
    const store = new TaskStore(root);
    await store.load();
    const workItems = new WorkItemStore(root);
    await workItems.load();
    const taskId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    await store.upsert({ ...task(taskId, root), status: "idle" });
    const item = await workItems.create({ title: "reopen restores session", cwd: root });
    await workItems.createRun({
      objectiveId: item.id,
      taskId,
      kind: "initial",
      instruction: "go",
    });

    const service = new TaskService(baseConfig(root), store, "test", null, workItems);
    vi.spyOn(service.supervisor, "stop").mockResolvedValue(undefined);
    vi.spyOn(service.supervisor, "has").mockReturnValue(false);

    await service.handleCommand({ id: "arch-item", type: "workItem.archive", payload: { id: item.id } });
    expect(store.get(taskId)?.archivedAt).toBeTruthy();

    await service.handleCommand({ id: "reopen", type: "workItem.reopen", payload: { id: item.id } });
    expect(workItems.get(item.id)?.state).toBe("open");
    expect(store.get(taskId)?.archivedAt).toBeNull();
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

it("restores an archived conversation without starting Pi and persists its identity", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "qingzhou-restore-"));
  const store = new TaskStore(root);
  await store.load();
  const id = "11111111-1111-4111-8111-111111111111";
  const original = { ...task(id, root), title: "保留的会话", sessionPath: path.join(root, "session.jsonl"), archivedAt: new Date().toISOString() };
  await store.upsert(original);
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
  const boot = vi.spyOn(service.supervisor, "boot");
  await expect(service.handleCommand({ id: "archived", type: "task.listArchived", payload: {} })).resolves.toEqual({ tasks: [original] });
  let finishFirstStop!: () => void;
  const delayedStop = new Promise<void>((resolve) => { finishFirstStop = resolve; });
  vi.spyOn(service.supervisor, "stop").mockImplementationOnce(() => delayedStop).mockResolvedValue(undefined);
  const slowRestore = service.handleCommand({ id: "slow-restore", type: "task.restore", taskId: id, payload: {} });
  await service.handleCommand({ id: "restore", type: "task.restore", taskId: id, payload: {} });
  expect(store.listVisible()).toEqual([expect.objectContaining({ id, title: original.title, sessionPath: original.sessionPath, archivedAt: null, status: "stopped" })]);
  await store.upsert({ ...store.get(id)!, title: "新的标题", approvalPolicy: "read_only", status: "running" });
  finishFirstStop();
  await slowRestore;
  expect(store.get(id)).toMatchObject({ title: "新的标题", approvalPolicy: "read_only", status: "running" });
  expect(boot).not.toHaveBeenCalled();
  await expect(service.handleCommand({ id: "archived-empty", type: "task.listArchived", payload: {} })).resolves.toEqual({ tasks: [] });
  await store.flushSync();
  const reloaded = new TaskStore(root);
  await reloaded.load();
  expect(reloaded.listVisible()[0]?.id).toBe(id);
  await expect(service.handleCommand({ id: "missing", type: "task.restore", taskId: "missing", payload: {} })).rejects.toThrow("找不到");
});

it("handles optional resource scan failures after boot without an unhandled rejection", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "qingzhou-resource-failure-"));
  const store = new TaskStore(root);
  await store.load();
  const id = "22222222-2222-4222-8222-222222222222";
  await store.upsert(task(id, root));
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
  const scan = vi.spyOn(service as unknown as { emitResources: (id: string) => Promise<unknown> }, "emitResources").mockRejectedValue(new Error("scan failed"));
  vi.spyOn(service.supervisor, "boot").mockResolvedValue({ sessionPath: null, model: null, thinkingLevel: "off" });
  vi.spyOn(service.supervisor, "snapshot").mockReturnValue(null);
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    await service.handleCommand({ id: "activate", type: "task.activate", taskId: id, payload: {} });
    await vi.waitFor(() => expect(scan).toHaveBeenCalledWith(id));
    await vi.waitFor(() => expect(warning).toHaveBeenCalled());
    expect(store.get(id)?.status).toBe("idle");
  } finally { warning.mockRestore(); service.dispose(); }
});
