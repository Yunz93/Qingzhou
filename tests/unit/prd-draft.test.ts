import { expect, it } from "vitest";
import { hasPrdDraftChanges } from "../../apps/web/src/lib/prd-draft";
const prd = { id: "revision", content: "已确认方案", moduleChanges: [] };
const draft = { expectedPrdId: prd.id, content: prd.content, moduleChanges: [], reason: "" };
it("allows an exact saved design while blocking local body, module or revision changes at final acceptance", () => {
  expect(hasPrdDraftChanges(null, prd)).toBe(false);
  expect(hasPrdDraftChanges(JSON.stringify(draft), prd)).toBe(false);
  for (const patch of [{ content: "尚未保存的新方案" }, { moduleChanges: [{ moduleId: "module", content: "新模块设计" }] }, { expectedPrdId: "old" }, { reason: "未保存的设计决策" }]) expect(hasPrdDraftChanges(JSON.stringify({ ...draft, ...patch }), prd)).toBe(true);
});
it("keeps an unreadable cached design visible for recovery instead of discarding it during acceptance", () => {
  expect(hasPrdDraftChanges("{broken", prd)).toBe(true);
});
