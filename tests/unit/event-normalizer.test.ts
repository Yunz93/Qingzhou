import { describe, expect, it } from "vitest";
import { normalizePiEvent, piMessagesToTimeline } from "../../apps/server/src/pi/event-normalizer.ts";

describe("event normalizer", () => {
  it("keeps assistant start and end on the same id", () => {
    const timestamp = 1786666243568;
    const started = normalizePiEvent({
      type: "message_start",
      message: { role: "assistant", content: [], timestamp },
    });
    const ended = normalizePiEvent({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "hello world from the agent" }],
        timestamp,
      },
    });
    expect(started.kind).toBe("message.started");
    expect(ended.kind).toBe("message.completed");
    if (started.kind === "message.started" && ended.kind === "message.completed") {
      expect(started.message.id).toBe(ended.message.id);
    }
  });

  it("preserves partial output and a readable provider failure in live and restored replies", () => {
    const message = { role: "assistant", timestamp: 12, content: [{ type: "text", text: "未完成" }],
      stopReason: "error", errorMessage: "400 API_KEY_INVALID: API key not valid." };
    const restored = piMessagesToTimeline([message]);
    expect(restored[0]).toMatchObject({ isError: true, text: expect.stringMatching(/未完成[\s\S]*Google AI Studio/) });
    expect(normalizePiEvent({ type: "message_end", message })).toEqual({ kind: "message.completed", message: restored[0], error: expect.stringContaining("Google AI Studio") });
    expect(piMessagesToTimeline([{ ...message, stopReason: "aborted" }])[0]).toMatchObject({ isError: false, text: "未完成" });
  });

  it("marks denied tool results as blocked", () => {
    const event = normalizePiEvent({
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "bash",
      isError: true,
      result: { content: [{ type: "text", text: "Denied by user or timed out" }] },
    });
    expect(event.kind).toBe("tool.completed");
    if (event.kind === "tool.completed") {
      expect(event.tool.status).toBe("blocked");
    }
  });

  it("maps compaction, retry, and queue events", () => {
    expect(normalizePiEvent({ type: "compaction_start", reason: "threshold" })).toEqual({
      kind: "runtime.compaction",
      phase: "start",
      reason: "threshold",
    });
    expect(normalizePiEvent({ type: "auto_retry_start", attempt: 1, maxAttempts: 3, errorMessage: "529" })).toEqual({
      kind: "runtime.retry",
      phase: "start",
      attempt: 1,
      maxAttempts: 3,
      error: "529",
    });
    expect(
      normalizePiEvent({
        type: "auto_retry_end",
        success: false,
        attempt: 1,
        finalError: "HTTP 401 Unauthorized",
      }),
    ).toEqual({
      kind: "runtime.retry",
      phase: "end",
      attempt: 1,
      error: "HTTP 401 Unauthorized",
    });
    expect(normalizePiEvent({ type: "queue_update", steering: ["go left"], followUp: ["then summarize"] })).toEqual({
      kind: "runtime.queue",
      steering: ["go left"],
      followUp: ["then summarize"],
    });
    expect(
      normalizePiEvent({
        type: "agent_error",
        error: "EACCES: permission denied, open '/Users/yunz/.pi/agent/auth.json'",
      }),
    ).toEqual({
      kind: "agent_error",
      error: "EACCES: permission denied, open '/Users/yunz/.pi/agent/auth.json'",
    });
    expect(
      normalizePiEvent({
        type: "agent_error",
        error: { type: "rate_limit_error", message: "Request would exceed rate limit" },
      }),
    ).toEqual({
      kind: "agent_error",
      error: "rate_limit_error: Request would exceed rate limit",
    });
    expect(
      normalizePiEvent({
        type: "auto_retry_end",
        success: false,
        attempt: 2,
        finalError: { error: { message: "HTTP 429 Too Many Requests" } },
      }),
    ).toEqual({
      kind: "runtime.retry",
      phase: "end",
      attempt: 2,
      error: "HTTP 429 Too Many Requests",
    });
  });

  it("restores user and assistant messages from Pi history", () => {
    const messages = piMessagesToTimeline([
      { role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: "hi" }], timestamp: 2 },
    ]);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.text).toBe("hello");
    expect(messages[1]?.text).toBe("hi");
  });

  it("turns Pi model_change entries into system notices", () => {
    const messages = piMessagesToTimeline([
      {
        role: "model_change",
        provider: "openai",
        modelId: "gpt-5.6-sol",
        previousModel: "openai/gpt-5.4",
        timestamp: 3,
      },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.text).toBe("模型已从 gpt-5.4 更改为 gpt-5.6-sol。");
    const started = normalizePiEvent({
      type: "message_start",
      message: {
        role: "model_change",
        model: "openai/gpt-5.6-sol",
        previousModel: "openai/gpt-5.4",
        timestamp: 4,
      },
    });
    expect(started.kind).toBe("message.started");
    if (started.kind === "message.started") {
      expect(started.message.role).toBe("system");
      expect(started.message.text).toContain("更改为");
    }
  });

  it("extracts image blocks from user content", () => {
    const started = normalizePiEvent({
      type: "message_start",
      message: {
        role: "user",
        content: [
          { type: "text", text: "look" },
          { type: "image", mimeType: "image/png", data: "abc123", name: "shot.png" },
        ],
        timestamp: 9,
      },
    });
    expect(started.kind).toBe("message.started");
    if (started.kind === "message.started") {
      expect(started.message.images).toEqual([
        { mimeType: "image/png", name: "shot.png", dataUrl: "data:image/png;base64,abc123" },
      ]);
    }
  });

  it("keeps select/input/notify fields on extension UI requests", () => {
    expect(
      normalizePiEvent({
        type: "extension_ui_request",
        id: "ui-1",
        method: "select",
        title: "Choose",
        message: "Pick",
        options: ["alpha", "beta"],
      }),
    ).toMatchObject({
      kind: "approval.ui",
      method: "select",
      options: ["alpha", "beta"],
    });
    expect(
      normalizePiEvent({
        type: "extension_ui_request",
        id: "ui-2",
        method: "input",
        placeholder: "Name",
      }),
    ).toMatchObject({ kind: "approval.ui", method: "input", placeholder: "Name" });
    expect(
      normalizePiEvent({
        type: "extension_ui_request",
        id: "ui-3",
        method: "notify",
        message: "done",
        notifyType: "warning",
      }),
    ).toMatchObject({ kind: "approval.ui", method: "notify", notifyType: "warning" });
  });
});
