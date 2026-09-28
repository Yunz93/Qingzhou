import { describe, expect, it, beforeEach } from "vitest";
import { useAgentStore } from "../../apps/web/src/stores/agent-store.ts";
import type { ServerEvent } from "@qingzhou/protocol";

function baseEvent(partial: Partial<ServerEvent> & Pick<ServerEvent, "type" | "payload">): ServerEvent {
  return {
    eventId: "e1",
    serverInstanceId: "s1",
    taskId: "11111111-1111-4111-8111-111111111111",
    timestamp: new Date().toISOString(),
    sequence: 1,
    ...partial,
  } as ServerEvent;
}

describe("send error visibility", () => {
  beforeEach(() => {
    useAgentStore.setState({
      requestError: null,
      serverError: null,
      lastSeen: {},
      serverInstanceId: "s1",
    });
  });

  it("normalizes empty request.failed into a visible fallback", () => {
    useAgentStore.getState().applyEvent(
      baseEvent({
        type: "request.failed",
        payload: { requestId: "c1", error: "" },
        sequence: 1,
      }),
    );
    expect(useAgentStore.getState().requestError).toBe("发送失败");
  });

  it("keeps a concrete request.failed reason", () => {
    useAgentStore.getState().applyEvent(
      baseEvent({
        type: "request.failed",
        payload: { requestId: "c1", error: "正在排队，请稍等。" },
        sequence: 2,
      }),
    );
    expect(useAgentStore.getState().requestError).toBe("正在排队，请稍等。");
  });

  it("normalizes blank server.error messages", () => {
    useAgentStore.getState().applyEvent(
      baseEvent({
        type: "server.error",
        payload: { code: "pi.prompt", message: "   " },
        sequence: 3,
      }),
    );
    expect(useAgentStore.getState().serverError).toBe("出错了");
  });
});
