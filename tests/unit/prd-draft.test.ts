import { expect, it } from "vitest";
import type { RequirementPrd } from "@qingzhou/protocol";
import { applySavedPrd, backupPrdDraft, followPrdRevision, hasPrdDraftChanges, isSavedPrdDraft, parsePrdDraft, readPrdDraftCache, writePrdDraftCache } from "../../apps/web/src/lib/prd-draft";
const prd = { id: "11111111-1111-4111-8111-111111111111", content: "已确认方案", moduleChanges: [] };
const draft = { expectedPrdId: prd.id, content: prd.content, moduleChanges: [], reason: "" };
it("allows an exact saved design while blocking local body, module or revision changes at final acceptance", () => {
  expect(hasPrdDraftChanges(null, prd)).toBe(false);
  expect(hasPrdDraftChanges(JSON.stringify(draft), prd)).toBe(false);
  for (const patch of [{ content: "尚未保存的新方案" }, { moduleChanges: [{ moduleId: "module", content: "新模块设计" }] }, { expectedPrdId: "old" }, { reason: "未保存的设计决策" }]) expect(hasPrdDraftChanges(JSON.stringify({ ...draft, ...patch }), prd)).toBe(true);
});
it("keeps an unreadable cached design visible for recovery instead of discarding it during acceptance", () => {
  expect(hasPrdDraftChanges("{broken", prd)).toBe(true);
  expect(hasPrdDraftChanges("", prd)).toBe(true);
});
it("ignores storage metadata while retaining module content and basis changes", () => {
  const change = { moduleId: "22222222-2222-4222-8222-222222222222", baseRevisionId: "33333333-3333-4333-8333-333333333333", content: "模块设计" };
  const stored = { ...prd, moduleChanges: [{ ...change, document: { path: "docs/module.md", revisionPath: "docs/.versions/base.md", hash: "hash" } }] };
  const raw = { ...draft, moduleChanges: [change] };
  expect(hasPrdDraftChanges(JSON.stringify(raw), stored)).toBe(false);
  expect(hasPrdDraftChanges(JSON.stringify({ ...raw, moduleChanges: [{ ...change, baseRevisionId: "other" }] }), stored)).toBe(true);
  expect(hasPrdDraftChanges(JSON.stringify({ ...raw, moduleChanges: [{ ...change, content: "本地修改" }] }), stored)).toBe(true);
});

it("refreshes untouched cached versions but retains unsaved or unknown drafts on reopening", () => {
  const revisions = [prd];
  expect(isSavedPrdDraft(JSON.stringify(draft), revisions)).toBe(true);
  expect(isSavedPrdDraft(JSON.stringify({ ...draft, content: "未保存内容" }), revisions)).toBe(false);
  expect(isSavedPrdDraft(JSON.stringify({ ...draft, reason: "待保存的变更说明" }), revisions)).toBe(false);
  expect(isSavedPrdDraft(JSON.stringify({ ...draft, expectedPrdId: "unknown" }), revisions)).toBe(false);
});

it("accepts unfinished draft text and rejects parseable but unusable cache shapes", () => {
  expect(parsePrdDraft(JSON.stringify({ ...draft, content: "" })).content).toBe("");
  for (const value of [null, [], {}, { ...draft, reason: null }, { ...draft, moduleChanges: null }, { ...draft, moduleChanges: [null] }, { ...draft, moduleChanges: [{ moduleId: "invalid" }] }]) {
    expect(() => parsePrdDraft(JSON.stringify(value))).toThrow();
    expect(hasPrdDraftChanges(JSON.stringify(value), prd)).toBe(true);
  }
});

it("follows a new baseline only while the editor is untouched", () => {
  const next = { ...prd, id: "44444444-4444-4444-8444-444444444444", content: "新版设计" } as RequirementPrd;
  expect(followPrdRevision(draft, draft, next)).toEqual({ ...draft, expectedPrdId: next.id, content: next.content });
  for (const edited of [{ ...draft, content: "新输入" }, { ...draft, reason: "新决策" }]) expect(followPrdRevision(edited, draft, next)).toBe(edited);
});

it("acknowledges only the submitted snapshot while keeping newer text, modules and reasons", () => {
  const submitted = { ...draft, content: "提交正文", reason: "提交原因" };
  const saved = { ...prd, id: "44444444-4444-4444-8444-444444444444", content: submitted.content, moduleChanges: [] } as RequirementPrd;
  const current = { ...submitted, content: "保存中继续输入", reason: "后续决策", moduleChanges: [{ moduleId: "22222222-2222-4222-8222-222222222222", baseRevisionId: null, content: "后续模块修改" }] };
  expect(applySavedPrd(current, submitted, saved)).toEqual({ ...current, expectedPrdId: saved.id });
  const otherBasis = { ...current, expectedPrdId: "55555555-5555-4555-8555-555555555555" };
  expect(applySavedPrd(otherBasis, submitted, saved)).toBe(otherBasis);
});

it("backs up exact bytes and refuses failed, changed or occupied recovery storage", () => {
  const values = new Map([["draft", "null"], ["draft:recovery:occupied", "earlier recovery"]]);
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  backupPrdDraft("draft", "null", storage, "new");
  expect(values.get("draft:recovery:new")).toBe("null");
  expect(values.get("draft")).toBe("null");
  expect(() => backupPrdDraft("draft", "null", storage, "occupied")).toThrow("已存在");
  expect(values.get("draft:recovery:occupied")).toBe("earlier recovery");
  expect(() => backupPrdDraft("draft", "outdated", storage, "changed")).toThrow("发生变化");
  expect(() => backupPrdDraft("draft", "null", { ...storage, setItem: () => { throw new Error("quota"); } }, "full")).toThrow();
  expect(() => backupPrdDraft("draft", "null", { ...storage, setItem: () => {} }, "ignored")).toThrow("未能确认");
  expect(values.get("draft")).toBe("null");
});

it("keeps failed draft writes in memory and retries without blocking other objects", () => {
  const key = "retry-local-prd";
  const values = new Map([[key, "old"], ["other", "other draft"]]);
  let fails = true;
  const storage = { getItem: (name: string) => values.get(name) ?? null, setItem: (name: string, value: string) => { if (fails) throw new Error("quota"); values.set(name, value); } };
  expect(writePrdDraftCache(key, "unsaved new content", storage)).toBe(false);
  expect(readPrdDraftCache(key, storage)).toBe("unsaved new content");
  expect(values.get(key)).toBe("old");
  fails = false;
  expect(writePrdDraftCache(key, "latest", storage)).toBe(true);
  expect(values.get(key)).toBe("latest");
  values.set(key, "external change");
  expect(readPrdDraftCache(key, storage)).toBe("external change");
  expect(values.get("other")).toBe("other draft");
});
