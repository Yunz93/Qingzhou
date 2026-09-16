import { describe, expect, it } from "vitest";
import {
  PROMPT_MESSAGE_MAX,
  clientCommandSchema,
  formatClientCommandError,
  normalizeSessionStats,
  piResourcesSchema,
  serverEventSchema,
  serverFrameSchema,
  type ServerEvent,
  type TaskRecord,
} from "../../packages/protocol/src/index.ts";
import { useAgentStore } from "../../apps/web/src/stores/agent-store.ts";

describe("protocol", () => {
  it("rejects illegal websocket payloads", () => {
    const result = clientCommandSchema.safeParse({ type: "prompt.send", payload: { message: "hi" } });
    expect(result.success).toBe(false);
  });

  it("accepts image-only prompts and rejects oversized text", () => {
    expect(
      clientCommandSchema.parse({
        id: "img",
        type: "prompt.send",
        taskId: "11111111-1111-4111-8111-111111111111",
        payload: { message: "", imageIds: ["up-1"] },
      }).payload.imageIds,
    ).toEqual(["up-1"]);
    expect(
      clientCommandSchema.safeParse({
        id: "empty",
        type: "prompt.send",
        taskId: "11111111-1111-4111-8111-111111111111",
        payload: { message: "   " },
      }).success,
    ).toBe(false);
    expect(
      clientCommandSchema.safeParse({
        id: "huge",
        type: "prompt.send",
        taskId: "11111111-1111-4111-8111-111111111111",
        payload: { message: "x".repeat(PROMPT_MESSAGE_MAX + 1) },
      }).success,
    ).toBe(false);
  });

  it("validates edits to queued prompts", () => {
    const command = {
      id: "queue-edit",
      type: "prompt.queue.edit",
      taskId: "11111111-1111-4111-8111-111111111111",
      payload: {
        kind: "followUp",
        index: 1,
        previousMessage: "old text",
        message: "corrected text",
      },
    };
    expect(clientCommandSchema.parse(command).payload).toEqual(command.payload);
    expect(
      clientCommandSchema.safeParse({ ...command, payload: { ...command.payload, message: "   " } }).success,
    ).toBe(false);
  });

  it("accepts pi mvp session and runtime commands", () => {
    expect(
      clientCommandSchema.parse({
        id: "casual",
        type: "task.create",
        payload: { title: "随便聊聊" },
      }).payload,
    ).toEqual({ title: "随便聊聊" });
    expect(
      clientCommandSchema.parse({
        id: "1",
        type: "session.resume",
        payload: { sessionPath: "/tmp/session.jsonl" },
      }).type,
    ).toBe("session.resume");
    expect(
      clientCommandSchema.parse({
        id: "2",
        type: "runtime.set",
        taskId: "11111111-1111-4111-8111-111111111111",
        payload: { autoCompaction: false, fastMode: true },
      }).payload,
    ).toEqual({ autoCompaction: false, fastMode: true });
    expect(
      clientCommandSchema.parse({
        id: "2b",
        type: "model.default.set",
        taskId: "11111111-1111-4111-8111-111111111111",
        payload: { provider: "openai", modelId: "gpt-5.4" },
      }).payload,
    ).toEqual({ provider: "openai", modelId: "gpt-5.4" });
    expect(
      clientCommandSchema.parse({
        id: "3",
        type: "session.stats",
        taskId: "11111111-1111-4111-8111-111111111111",
      }).type,
    ).toBe("session.stats");
    expect(
      clientCommandSchema.parse({
        id: "4",
        type: "git.commit",
        taskId: "11111111-1111-4111-8111-111111111111",
        payload: { message: "save work" },
      }).type,
    ).toBe("git.commit");
    expect(
      clientCommandSchema.parse({
        id: "4b",
        type: "git.restore",
        taskId: "11111111-1111-4111-8111-111111111111",
        payload: { path: "src/app.ts" },
      }).payload,
    ).toEqual({ path: "src/app.ts" });
    expect(
      clientCommandSchema.parse({
        id: "4c",
        type: "git.restore",
        taskId: "11111111-1111-4111-8111-111111111111",
        payload: {},
      }).payload,
    ).toEqual({});
    expect(
      clientCommandSchema.parse({
        id: "5",
        type: "interaction.respond",
        taskId: "11111111-1111-4111-8111-111111111111",
        payload: { requestId: "ui-1", value: "alpha" },
      }).payload,
    ).toEqual({ requestId: "ui-1", value: "alpha" });
    expect(
      clientCommandSchema.parse({
        id: "6",
        type: "checkpoint.restore",
        taskId: "11111111-1111-4111-8111-111111111111",
        payload: { path: "note.txt" },
      }).payload,
    ).toEqual({ path: "note.txt" });
    expect(
      clientCommandSchema.parse({
        id: "7",
        type: "term.run",
        taskId: "11111111-1111-4111-8111-111111111111",
        payload: { command: "echo hi" },
      }).payload,
    ).toEqual({ command: "echo hi" });
    expect(
      clientCommandSchema.parse({
        id: "7b",
        type: "task.reorder",
        payload: {
          cwd: "/tmp/project",
          taskIds: ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"],
        },
      }).payload,
    ).toEqual({
      cwd: "/tmp/project",
      taskIds: ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"],
    });
    expect(
      clientCommandSchema.parse({
        id: "8",
        type: "term.interrupt",
        taskId: "11111111-1111-4111-8111-111111111111",
      }).type,
    ).toBe("term.interrupt");
    expect(
      clientCommandSchema.parse({
        id: "8b",
        type: "term.openNative",
        taskId: "11111111-1111-4111-8111-111111111111",
      }).type,
    ).toBe("term.openNative");
    expect(
      clientCommandSchema.parse({
        id: "9",
        type: "resources.skill.set",
        taskId: "11111111-1111-4111-8111-111111111111",
        payload: { path: "/tmp/SKILL.md", enabled: false },
      }).payload,
    ).toEqual({ path: "/tmp/SKILL.md", enabled: false });
    expect(
      clientCommandSchema.parse({
        id: "9b",
        type: "resources.extension.set",
        taskId: "11111111-1111-4111-8111-111111111111",
        payload: { path: "/tmp/demo.ts", enabled: false },
      }).payload,
    ).toEqual({ path: "/tmp/demo.ts", enabled: false });
    expect(
      clientCommandSchema.parse({
        id: "9c",
        type: "resources.package.install",
        taskId: "11111111-1111-4111-8111-111111111111",
        payload: { ids: ["pi-web-access"] },
      }).payload,
    ).toEqual({ ids: ["pi-web-access"] });
    expect(
      clientCommandSchema.parse({
        id: "9d",
        type: "resources.skill.updates",
        taskId: "11111111-1111-4111-8111-111111111111",
        payload: {},
      }).type,
    ).toBe("resources.skill.updates");
    expect(formatClientCommandError(clientCommandSchema.safeParse({ id: "x", type: "nope" }).error!)).toMatch(
      /版本不一致/,
    );
    expect(
      formatClientCommandError(
        clientCommandSchema.safeParse({ id: "x", type: "resources.skill.updates", payload: {} }).error!,
      ),
    ).toMatch(/没有对话/);
    expect(
      clientCommandSchema.parse({
        id: "9e",
        type: "resources.skill.update",
        taskId: "11111111-1111-4111-8111-111111111111",
        payload: { paths: ["/tmp/SKILL.md"] },
      }).payload,
    ).toEqual({ paths: ["/tmp/SKILL.md"] });
    expect(
      piResourcesSchema.parse({
        agentsFiles: [],
        skills: [],
        templates: [],
        trustProject: false,
      }),
    ).toMatchObject({ extensions: [], packages: [] });
    expect(
      clientCommandSchema.parse({
        id: "10",
        type: "workItem.create",
        payload: {
          title: "fix login",
          cwd: "/tmp/project",
          description: "handle 401",
          acceptanceCriteria: "tests pass",
          start: true,
        },
      }).payload,
    ).toMatchObject({
      title: "fix login",
      cwd: "/tmp/project",
      description: "handle 401",
      acceptanceCriteria: "tests pass",
      start: true,
    });
    expect(
      clientCommandSchema.parse({
        id: "11",
        type: "workItem.feedback",
        payload: { id: "11111111-1111-4111-8111-111111111111", text: "also handle 403" },
      }).payload,
    ).toEqual({ id: "11111111-1111-4111-8111-111111111111", text: "also handle 403" });
    expect(
      clientCommandSchema.parse({
        id: "12",
        type: "workItem.accept",
        payload: { id: "11111111-1111-4111-8111-111111111111" },
      }).type,
    ).toBe("workItem.accept");
  });

  it("accepts partial Pi session stats and fills context usage", () => {
    const stats = normalizeSessionStats(
      { totalMessages: 4, tokens: { total: 1200 } },
      { toolCalls: 2, contextWindow: 100_000 },
    );
    expect(stats.totalMessages).toBe(4);
    expect(stats.toolCalls).toBe(2);
    expect(stats.contextUsage?.tokens).toBe(1200);
    expect(stats.contextUsage?.contextWindow).toBe(100_000);
    expect(stats.contextUsage?.percent).toBe(1.2);
  });
});

describe("event sequence dedup", () => {
  it("ignores duplicate taskId+sequence pairs", () => {
    const store = useAgentStore.getState();
    store.applyEvent({
      eventId: "a",
      serverInstanceId: "server-a",
      taskId: "t1",
      timestamp: new Date().toISOString(),
      sequence: 1,
      type: "server.error",
      payload: { code: "x", message: "one" },
    });
    store.applyEvent({
      eventId: "b",
      serverInstanceId: "server-a",
      taskId: "t1",
      timestamp: new Date().toISOString(),
      sequence: 1,
      type: "server.error",
      payload: { code: "x", message: "two" },
    });
    expect(useAgentStore.getState().serverError).toBe("one");
  });

  it("accepts lower sequences from a restarted server", () => {
    const store = useAgentStore.getState();
    const event = (serverInstanceId: string, sequence: number, message: string): ServerEvent => ({
      eventId: `${serverInstanceId}-${sequence}`,
      serverInstanceId,
      taskId: "restart-task",
      timestamp: new Date().toISOString(),
      sequence,
      type: "server.error",
      payload: { code: "restart", message },
    });
    store.applyEvent(event("old-server", 20, "old"));
    store.applyEvent(event("new-server", 1, "new"));
    expect(useAgentStore.getState().serverError).toBe("new");
  });

  it("validates batched websocket frames", () => {
    const event: ServerEvent = {
      eventId: "frame-1",
      serverInstanceId: "server-frame",
      taskId: "",
      timestamp: new Date().toISOString(),
      sequence: 1,
      type: "connection.status",
      payload: { status: "connected" },
    };
    expect(serverFrameSchema.parse({ __batch: true, events: [event] }).events).toHaveLength(1);
  });

  it("keeps a provider 401 visible after an empty assistant message starts", () => {
    const store = useAgentStore.getState();
    store.setActiveTask("t-401");
    const base = {
      serverInstanceId: "server-401",
      taskId: "t-401",
      timestamp: new Date().toISOString(),
    };
    store.applyEvent({
      ...base,
      eventId: "e1",
      sequence: 1,
      type: "server.error",
      payload: {
        code: "pi.retry",
        message: "登录已失效或密钥不正确（HTTP 401）。打开设置检查 API Key，或重新登录。",
      },
    });
    store.applyEvent({
      ...base,
      eventId: "e2",
      sequence: 2,
      type: "message.started",
      payload: {
        message: {
          id: "asst-empty",
          role: "assistant",
          text: "",
          createdAt: base.timestamp,
          streaming: true,
        },
      },
    });
    expect(useAgentStore.getState().serverError).toMatch(/401/);

    store.applyEvent({
      ...base,
      eventId: "e3",
      sequence: 3,
      type: "message.started",
      payload: {
        message: {
          id: "user-retry",
          role: "user",
          text: "再试一次",
          createdAt: base.timestamp,
          streaming: false,
        },
      },
    });
    expect(useAgentStore.getState().serverError).toBeNull();
  });

  it("applies tasks.reordered without moving other projects", () => {
    const now = new Date().toISOString();
    const task = (id: string, cwd: string, title: string): TaskRecord => ({
      schemaVersion: 1,
      id,
      title,
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
      mode: "agent",
      approvalPolicy: "ask",
    });
    const a1 = task("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "/tmp/alpha", "a1");
    const a2 = task("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "/tmp/alpha", "a2");
    const b1 = task("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "/tmp/beta", "b1");
    useAgentStore.setState({ tasks: [a2, b1, a1] });
    const event = serverEventSchema.parse({
      eventId: "reorder-1",
      serverInstanceId: "server-reorder",
      taskId: "",
      timestamp: now,
      sequence: 1,
      type: "tasks.reordered",
      payload: { cwd: "/tmp/alpha", taskIds: [a1.id, a2.id] },
    });
    useAgentStore.getState().applyEvent(event);
    expect(useAgentStore.getState().tasks.map((item) => item.id)).toEqual([a1.id, b1.id, a2.id]);
  });
});
