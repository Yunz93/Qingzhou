import { describe, expect, it } from "vitest";
import type { TimelineMessage } from "@qingzhou/protocol";
import { groupThinkingMessages } from "../../apps/web/src/lib/thinking-groups";
import { settingsReturnPath } from "../../apps/web/src/lib/settings-navigation";
import { readEditorDraft } from "../../apps/web/src/hooks/useEditorDraft";
import { matchConversationMessages } from "../../apps/web/src/lib/conversation-search";

const message = (id: string, overrides: Partial<TimelineMessage> = {}): TimelineMessage => ({ id, role: "assistant", text: "", thinking: "分析需求", createdAt: new Date().toISOString(), ...overrides });
describe("frontend interaction contracts", () => {
  it("groups only completed consecutive thinking, preserving tool/user boundaries and streaming", () => {
    const a = message("a"), b = message("b"), tool = message("t", { role: "toolResult", thinking: undefined }), live = message("live", { streaming: true });
    expect(groupThinkingMessages([a, b, tool, a, live, b])).toEqual([[a, b], tool, a, live, b]);
    expect(groupThinkingMessages([a, message("answer", { text: "结论" }), b])).toHaveLength(3);
  });
  it("finds thinking text without including tool output", () => {
    expect(matchConversationMessages([message("a"), message("t", { role: "toolResult" })], "分析")).toEqual(["a"]);
  });
  it("returns to the source board with its filters and details, rejecting external routes", () => {
    expect(settingsReturnPath({ from: "/board?q=design&filter=ready&item=42" })).toBe("/board?q=design&filter=ready&item=42");
    for (const from of ["//evil.test", "https://evil.test", "/settings", 42]) expect(settingsReturnPath({ from })).toBe("/");
    expect(settingsReturnPath(null)).toBe("/");
  });
  it("validates restored drafts and falls back on corrupted or unavailable storage", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
    const baseline = { title: "原文", content: "约定" };
    try {
      Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: () => JSON.stringify({ title: "草稿", content: "修改" }) } });
      expect(readEditorDraft("draft", baseline)).toEqual({ title: "草稿", content: "修改" });
      Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: () => '{"title":null}' } });
      expect(readEditorDraft("draft", baseline)).toEqual(baseline);
      Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get: () => { throw new Error("blocked"); } });
      expect(readEditorDraft("draft", baseline)).toEqual(baseline);
    } finally {
      if (original) Object.defineProperty(globalThis, "sessionStorage", original);
      else Reflect.deleteProperty(globalThis, "sessionStorage");
    }
  });
});
