import type { RequirementPrd } from "@qingzhou/protocol";

/** Final acceptance must not silently discard a local design revision. */
export function hasPrdDraftChanges(raw: string | null, prd: Pick<RequirementPrd, "id" | "content" | "moduleChanges">): boolean {
  if (!raw) return false;
  try {
    const draft = JSON.parse(raw) as { expectedPrdId?: string; content?: string; reason?: string; moduleChanges?: unknown };
    return draft.expectedPrdId !== prd.id || draft.content !== prd.content || !!draft.reason?.trim()
      || JSON.stringify(draft.moduleChanges) !== JSON.stringify(prd.moduleChanges);
  } catch { return true; }
}
