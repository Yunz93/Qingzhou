import type { RequirementPrd } from "@qingzhou/protocol";

export const moduleBodies = (changes: RequirementPrd["moduleChanges"]) => JSON.stringify(changes.map(({ moduleId, baseRevisionId, content }) => ({ moduleId, baseRevisionId, content })));

/** Final acceptance must not silently discard a local design revision. */
export function hasPrdDraftChanges(raw: string | null, prd: Pick<RequirementPrd, "id" | "content" | "moduleChanges">): boolean {
  if (!raw) return false;
  try {
    const draft = JSON.parse(raw) as { expectedPrdId?: string; content?: string; reason?: string; moduleChanges: RequirementPrd["moduleChanges"] };
    return draft.expectedPrdId !== prd.id || draft.content !== prd.content || !!draft.reason?.trim()
      || moduleBodies(draft.moduleChanges) !== moduleBodies(prd.moduleChanges);
  } catch { return true; }
}
