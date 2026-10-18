import { verificationIsValid, type IntegrationAttempt, type WorkflowProjectState, type WorkItemSummary } from "@qingzhou/protocol";

export const attemptLabels: Record<IntegrationAttempt["status"], string> = {
  queued: "排队合入", preparing: "准备集成", conflicts: "处理冲突", verifying: "集成验证中",
  ready: "候选待确认", merging: "正在合入", merged: "已合入", failed: "集成失败", stale: "候选已过期", cancelled: "已取消集成",
};

/** All surfaces describe the latest scope; historical merges remain separate facts. */
export function requirementStatus(state: WorkflowProjectState, item: WorkItemSummary) {
  const plan = state.plans?.find((entry) => entry.itemId === item.id);
  const prd = state.prds?.find((entry) => entry.id === plan?.currentPrdId);
  const moduleStale = !!prd && !prd.frozenAt && prd.moduleChanges.some((change) => change.baseRevisionId !== (prd.codeBaseline ? prd.codeBaseline.moduleRevisionIds[change.moduleId] ?? null : state.moduleRevisions?.filter((entry) => entry.moduleId === change.moduleId).at(-1)?.id ?? null));
  const config = state.configs[0];
  const scope = state.scopes.filter((entry) => entry.itemId === item.id).at(-1);
  const delivery = state.deliveries.filter((entry) => entry.itemId === item.id).at(-1);
  const verification = state.verifications.find((entry) => entry.id === delivery?.verificationId);
  const acceptance = state.acceptances.filter((entry) => entry.deliveryId === delivery?.id).at(-1);
  const ticket = state.tickets.filter((entry) => entry.itemId === item.id).at(-1);
  const implementationTicket = state.tickets.filter((entry) => entry.itemId === item.id && entry.phase === "implementation").at(-1);
  const currentScope = !!scope && implementationTicket?.scopeId === scope.id && (!plan || (!!prd && implementationTicket?.prdId === prd.id));
  const attempt = state.integrations.filter((entry) => entry.deliveryId === delivery?.id && delivery?.scopeId === scope?.id).at(-1);
  const historicalMerges = state.integrations.filter((entry) => entry.itemId === item.id && entry.status === "merged");
  const workspace = state.workspaceStates[item.id];
  const sourceMatches = workspace ? workspace.head === delivery?.commit && !workspace.dirty
    : state.workspaces.some((entry) => entry.itemId === item.id && entry.removedAt) && historicalMerges.some((entry) => entry.deliveryId === delivery?.id);
  const valid = (!plan || (!!prd?.confirmedAt && prd.id === delivery?.prdId)) && !!delivery && scope?.id === delivery.scopeId && implementationTicket?.id === delivery.ticketId && !!config
    && sourceMatches && verificationIsValid(verification, config, delivery.tree);
  const busy = ["queued", "running"].includes(ticket?.status ?? "");
  const implementation = busy ? ticket?.status === "queued" ? "排队中" : item.latestRun?.status === "waiting_approval" ? "等待批准" : item.latestRun?.status === "waiting_input" ? "等待回答" : ticket?.phase === "integration" ? "集成处理中" : ticket?.phase === "discussion" ? "只读讨论中" : "执行中"
    : !currentScope ? (scope && (implementationTicket || delivery) ? (plan && prd?.id !== implementationTicket?.prdId && scope.id === implementationTicket?.scopeId ? "新设计待实施" : "新范围待实施") : "未开始")
      : ["failed", "interrupted", "cancelled"].includes(implementationTicket?.status ?? "") ? (implementationTicket?.status === "failed" ? "受阻" : "已暂停")
        : verification?.status === "queued" ? "等待验证名额" : verification?.status === "running" ? "验证中" : valid ? "已实现" : verification?.status === "failed" || verification?.status === "interrupted" ? "受阻" : "待验证";
  const acceptanceLabel = !currentScope || !delivery || delivery.scopeId !== scope?.id ? "未验收" : !valid ? "待验证后验收"
    : acceptance?.decision === "accepted" ? "已验收" : acceptance?.decision === "rejected" ? "需返工" : "待验收";
  const merged = currentScope && !!delivery && scope?.id === delivery.scopeId && implementationTicket?.id === delivery.ticketId && attempt?.status === "merged";
  const candidateCurrent = !!valid && !!attempt && attempt.baseline === state.head && !!attempt.tree && !!config
    && verificationIsValid(state.verifications.find((entry) => entry.id === attempt.verificationId), config, attempt.tree);
  const lastMerged = historicalMerges.at(-1);
  const mergedScope = state.scopes.find((entry) => entry.id === state.deliveries.find((entry) => entry.id === lastMerged?.deliveryId)?.scopeId);
  const versionLabel = `${mergedScope && mergedScope.id !== scope?.id ? `v${mergedScope.version} 已合入 · ` : ""}当前范围 v${scope?.version ?? 1}`;
  let action: { kind: string; reason: string; label: string; view: "scope" | "delivery" | "conversation" | "design" } | null = null;
  if (item.state !== "archived") {
    if (implementation === "等待批准") action = { kind: "approval", reason: "执行等待操作审批", label: "处理审批", view: "conversation" };
    else if (implementation === "等待回答") action = { kind: "question", reason: "Agent 需要你的回答", label: "回答问题", view: "conversation" };
    else if (!busy && plan && !prd?.frozenAt && (plan.confirmedScopeId !== scope?.id || !prd?.confirmedAt || prd.scopeId !== scope?.id || moduleStale)) action = { kind: "design", reason: moduleStale ? "模块已有新设计，请合并设计并确认新 PRD" : plan.confirmedScopeId !== scope?.id ? "当前需求范围等待确认" : "当前 PRD 等待审阅与确认", label: "确认设计", view: "design" };
    else if (attempt?.status === "ready" && !candidateCurrent) action = { kind: "integration", reason: "候选依据的主线、源交付或检查配置已变化，请更新候选", label: "处理集成", view: "delivery" };
    else if (attempt?.status === "ready") action = { kind: "merge", reason: attempt.review?.decision === "design_changed" ? "候选涉及设计变化，请取消并创建关联子需求" : attempt.review?.candidate === attempt.candidate && attempt.review.decision === "compatible" ? "候选复审通过，等待确认合入" : "组合验证已通过，等待候选行为复审", label: "审阅候选", view: "delivery" };
    else if (attempt && ["conflicts", "failed", "stale"].includes(attempt.status)) action = { kind: "integration", reason: attempt.error || attemptLabels[attempt.status], label: "处理集成", view: "delivery" };
    else if (!busy && acceptanceLabel === "需返工") action = { kind: "rework", reason: acceptance?.note || "交付需要调整", label: "反馈并继续", view: "delivery" };
    else if (implementation === "受阻" || implementation === "已暂停") action = { kind: "failure", reason: ticket?.error || verification?.error || implementation, label: "检查并恢复", view: "delivery" };
    else if (acceptanceLabel === "待验收") action = { kind: "acceptance", reason: "当前交付等待人工验收", label: "验收交付", view: "delivery" };
    else if (!busy && currentScope && implementation === "待验证") action = { kind: "verification", reason: "本轮已结束，需要封存或重新验证", label: "核对交付", view: "delivery" };
  }
  const lane = busy ? "running" : merged && valid ? "merged" : currentScope && (valid || implementationTicket?.status === "finished") ? "delivery" : "planned";
  return { scope, implementationTicket, implementation, acceptance: acceptanceLabel, integration: attempt?.status === "ready" && !candidateCurrent ? "候选需更新" : attempt ? attemptLabels[attempt.status] : "尚未合入", ticket, delivery, verification, valid, merged, everMerged: historicalMerges.length > 0, candidateCurrent, attempt, versionLabel, action, lane };
}
