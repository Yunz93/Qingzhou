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
it("ignores storage metadata while retaining module content and basis changes", () => {
  const change = { moduleId: "module", baseRevisionId: "base", content: "模块设计" };
  const stored = { ...prd, moduleChanges: [{ ...change, document: { path: "docs/module.md", revisionPath: "docs/.versions/base.md", hash: "hash" } }] };
  const raw = { ...draft, moduleChanges: [change] };
  expect(hasPrdDraftChanges(JSON.stringify(raw), stored)).toBe(false);
  expect(hasPrdDraftChanges(JSON.stringify({ ...raw, moduleChanges: [{ ...change, baseRevisionId: "other" }] }), stored)).toBe(true);
  expect(hasPrdDraftChanges(JSON.stringify({ ...raw, moduleChanges: [{ ...change, content: "本地修改" }] }), stored)).toBe(true);
});
