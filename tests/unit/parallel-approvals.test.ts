import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../apps/server/src/config.ts";
import { ProcessSupervisor } from "../../apps/server/src/pi/process-supervisor.ts";

describe("parallel agent UI request identity", () => {
  it("routes identical raw approval IDs back to their originating process", () => {
    const supervisor = new ProcessSupervisor({ approvalTimeoutMs: 10000 } as AppConfig, () => {}, () => {}, () => {}, () => {});
    const internals = supervisor as unknown as { runtimes: Map<string, unknown>; handlePiEvent: (taskId: string, generation: number, event: object) => void };
    const clients = [vi.fn(), vi.fn()];
    for (const [index, sendUiResponse] of clients.entries()) {
      const taskId = `task-${index}`;
      internals.runtimes.set(taskId, { generation: 1, client: { sendUiResponse }, tools: new Map(), approval: null });
      internals.handlePiEvent(taskId, 1, { type: "extension_ui_request", id: "same-id", method: "confirm", title: "Allow write?", message: "file" });
    }
    const approvals = supervisor.listApprovals();
    expect(approvals).toHaveLength(2); expect(approvals[0]!.requestId).not.toBe(approvals[1]!.requestId);
    expect(supervisor.respondApproval(approvals[0]!.requestId, true)).toBe(true);
    expect(supervisor.respondApproval(approvals[1]!.requestId, false)).toBe(true);
    expect(clients[0]).toHaveBeenCalledWith({ id: "same-id", confirmed: true });
    expect(clients[1]).toHaveBeenCalledWith({ id: "same-id", confirmed: false, cancelled: true });
    expect(supervisor.listApprovals()).toHaveLength(0);
  });
  it("isolates identical input request IDs and returns the original RPC IDs", () => {
    const supervisor = new ProcessSupervisor({ approvalTimeoutMs: 10000 } as AppConfig, () => {}, () => {}, () => {}, () => {});
    const internals = supervisor as unknown as { runtimes: Map<string, unknown>; handlePiEvent: (taskId: string, generation: number, event: object) => void };
    const clients = [vi.fn(), vi.fn()];
    for (const [index, sendUiResponse] of clients.entries()) {
      const taskId = `task-${index}`;
      internals.runtimes.set(taskId, { generation: 1, client: { sendUiResponse }, tools: new Map() });
      internals.handlePiEvent(taskId, 1, { type: "extension_ui_request", id: "same-id", method: "input", title: "question" });
    }
    const requests = supervisor.listInteractions(); expect(requests).toHaveLength(2);
    supervisor.respondInteraction(requests[0]!.requestId, { value: "A" }); supervisor.respondInteraction(requests[1]!.requestId, { value: "B" });
    expect(clients[0]).toHaveBeenCalledWith({ id: "same-id", value: "A", confirmed: true });
    expect(clients[1]).toHaveBeenCalledWith({ id: "same-id", value: "B", confirmed: true });
    expect(supervisor.listInteractions()).toHaveLength(0);
  });
});
