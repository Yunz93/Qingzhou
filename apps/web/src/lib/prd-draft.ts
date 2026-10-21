import type { RequirementPrd } from "@qingzhou/protocol";

export const moduleBodies = (changes: RequirementPrd["moduleChanges"]) => JSON.stringify(changes.map(({ moduleId, baseRevisionId, content }) => ({ moduleId, baseRevisionId, content })));

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
  if (!raw) return false;
  try {
    const draft = JSON.parse(raw) as { expectedPrdId?: string; content?: string; reason?: string; moduleChanges: RequirementPrd["moduleChanges"] };
    return draft.expectedPrdId !== prd.id || draft.content !== prd.content || !!draft.reason?.trim()
      || moduleBodies(draft.moduleChanges) !== moduleBodies(prd.moduleChanges);
  } catch { return true; }
}
