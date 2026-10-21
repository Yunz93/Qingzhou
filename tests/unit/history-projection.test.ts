import { expect, it } from "vitest";
import type { WorkflowEvent } from "../../packages/protocol/src/workflow";
import { historyEvents } from "../../apps/web/src/lib/workflow-history";

const event = (id: string, itemId: string | null, type: string): WorkflowEvent => ({ id, sequence: 1, itemId, type, projectId: "project", subjectId: null, message: id, createdAt: "2026-10-20T00:00:00.000Z" });
it("separates project history from requirement internals and deduplicates IDs", () => {
  const events = [event("config", null, "config.updated"), event("scope", "a", "scope.confirmed"), event("run", "a", "ticket.created"), event("other", "b", "prd.confirmed"), event("merge", "a", "main.merged")];
  expect(historyEvents([...events, events[4]!]).map((e) => e.id).sort()).toEqual(["config", "merge"]);
  expect(historyEvents(events, "a").map((e) => e.id).sort()).toEqual(["merge", "scope"]);
  expect(historyEvents(events, "a", true).map((e) => e.id).sort()).toEqual(["merge", "run", "scope"]);
});

it("orders records by their persisted sequence even when timestamps match", () => {
  const first = { ...event("first", "a", "prd.confirmed"), sequence: 1 };
  const second = { ...event("second", "a", "prd.confirmed"), sequence: 2 };
  expect(historyEvents([first, second], "a").map((entry) => entry.id)).toEqual(["second", "first"]);
});
