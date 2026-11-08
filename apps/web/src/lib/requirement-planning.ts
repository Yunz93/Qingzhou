import type { WorkflowProjectState } from "@qingzhou/protocol";

export const prdFor = (state: WorkflowProjectState, id: string) => state.prds?.find((prd) => prd.id === state.plans?.find((plan) => plan.itemId === id)?.currentPrdId);
export const planningReady = (state: WorkflowProjectState, id: string) => {
  const plan = state.plans?.find((entry) => entry.itemId === id);
  const prd = prdFor(state, id);
  const scope = state.scopes.filter((entry) => entry.itemId === id).at(-1);
  return !plan || (!!prd?.confirmedAt && !prd.frozenAt && prd.scopeId === scope?.id && plan.confirmedScopeId === scope?.id && prd.moduleChanges.every((change) => change.baseRevisionId === (prd.codeBaseline ? prd.codeBaseline.moduleRevisionIds[change.moduleId] ?? null : state.moduleRevisions?.filter((entry) => entry.moduleId === change.moduleId).at(-1)?.id ?? null)));
};
