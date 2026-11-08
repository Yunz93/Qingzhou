import { requirementPrdSchema, moduleChangeSchema, moduleRevisionSchema, type RequirementPrd } from "@qingzhou/protocol";

export type PrdDraft = Pick<RequirementPrd, "content" | "reason" | "moduleChanges"> & { expectedPrdId: string | null };
// Local drafts can contain unfinished text, but must have the protocol's structure.
const draftSchema = requirementPrdSchema.pick({ content: true, reason: true, moduleChanges: true }).extend({
  expectedPrdId: requirementPrdSchema.shape.previousId,
  moduleChanges: moduleChangeSchema.extend({ content: moduleRevisionSchema.shape.content }).array().max(8),
});
export const parsePrdDraft = (raw: string): PrdDraft => draftSchema.parse(JSON.parse(raw));
export const savedPrdDraft = (prd: Pick<RequirementPrd, "id" | "content" | "moduleChanges">): PrdDraft => ({ expectedPrdId: prd.id, content: prd.content, moduleChanges: prd.moduleChanges, reason: "" });

export const moduleBodies = (changes: RequirementPrd["moduleChanges"]) => JSON.stringify(changes.map(({ moduleId, baseRevisionId, content }) => ({ moduleId, baseRevisionId, content })));

export function followPrdRevision(current: PrdDraft, before: PrdDraft, prd: RequirementPrd): PrdDraft {
  return current.expectedPrdId === before.expectedPrdId && !current.reason.trim() && current.content === before.content
    && moduleBodies(current.moduleChanges) === moduleBodies(before.moduleChanges) ? savedPrdDraft(prd) : current;
}

export function applySavedPrd(current: PrdDraft, submitted: PrdDraft, prd: RequirementPrd): PrdDraft {
  if (current.expectedPrdId !== submitted.expectedPrdId) return current;
  return { ...current, expectedPrdId: prd.id,
    content: current.content === submitted.content ? prd.content : current.content,
    moduleChanges: moduleBodies(current.moduleChanges) === moduleBodies(submitted.moduleChanges) ? prd.moduleChanges : current.moduleChanges,
    reason: current.reason === submitted.reason ? "" : current.reason };
}

type DraftStorage = Pick<Storage, "getItem" | "setItem">;
const browserStorage: DraftStorage = { getItem: (key) => sessionStorage.getItem(key), setItem: (key, value) => sessionStorage.setItem(key, value) };
// Only failed writes need an in-memory fallback. Normal reads still observe storage changes.
const pendingDrafts = new Map<string, string>();
export const readPrdDraftCache = (key: string, storage = browserStorage): string | null => pendingDrafts.get(key) ?? storage.getItem(key);
export function writePrdDraftCache(key: string, raw: string, storage = browserStorage): boolean {
  try { storage.setItem(key, raw); pendingDrafts.delete(key); return true; }
  catch { pendingDrafts.set(key, raw); return false; }
}

export function backupPrdDraft(key: string, raw: string, storage = browserStorage, id = crypto.randomUUID()): void {
  if (storage.getItem(key) !== raw) throw new Error("草稿已发生变化，请重新读取后再恢复。");
  const backup = `${key}:recovery:${id}`;
  if (storage.getItem(backup) !== null) throw new Error("恢复副本已存在，请重试以保留新的副本。");
  storage.setItem(backup, raw);
  if (storage.getItem(backup) !== raw) throw new Error("未能确认恢复副本，原始草稿保持不变。");
}

/** An untouched cached revision can follow the latest PRD when reopening the room. */
export function isSavedPrdDraft(raw: string, revisions: Array<Pick<RequirementPrd, "id" | "content" | "moduleChanges">>): boolean {
  try {
    const draft = JSON.parse(raw) as { expectedPrdId?: string };
    const baseline = revisions.find((entry) => entry.id === draft.expectedPrdId);
    return !!baseline && !hasPrdDraftChanges(raw, baseline);
  } catch { return false; }
}

/** Final acceptance must not silently discard a local design revision. */
export function hasPrdDraftChanges(raw: string | null, prd: Pick<RequirementPrd, "id" | "content" | "moduleChanges">): boolean {
  if (raw === null) return false;
  try {
    const draft = parsePrdDraft(raw);
    return draft.expectedPrdId !== prd.id || draft.content !== prd.content || !!draft.reason?.trim()
      || moduleBodies(draft.moduleChanges) !== moduleBodies(prd.moduleChanges);
  } catch { return true; }
}
