import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { workItemSummarySchema, type WorkflowProjectState, type Delivery, type IntegrationAttempt } from "@qingzhou/protocol";
import { requirementStatus } from "../../apps/web/src/lib/requirement-state";

function fixture() {
  const id = randomUUID(), projectId = randomUUID(), scopeId = randomUUID(), ticketId = randomUUID();
  const stamp = new Date().toISOString(), commit = "a".repeat(40), tree = "b".repeat(40);
  const item = workItemSummarySchema.parse({ id, projectId, title: "登录体验", cwd: "/repo", rank: 1, createdAt: stamp, updatedAt: stamp, latestRun: null, runCount: 1, feedbackCount: 0 });
  const delivery: Delivery = { id: randomUUID(), itemId: id, scopeId, ticketId, runId: null, commit, tree, baseline: "c".repeat(40), files: [], patch: "", summary: "登录", verificationId: randomUUID(), createdAt: stamp };
  const state: WorkflowProjectState = { schemaVersion: 1, configs: [{ projectId, repository: "/repo", commonDir: "/repo/.git", targetBranch: "main", revision: 1, concurrency: 2, paused: false, updatedAt: stamp, checks: [{ id: "test", name: "测试", command: "pnpm test", required: true, resource: "", timeoutMs: 1000 }] }],
    scopes: [{ id: scopeId, itemId: id, version: 1, title: item.title, description: "登录", acceptanceCriteria: "登录成功", createdAt: stamp }],
    tickets: [{ id: ticketId, itemId: id, projectId, scopeId, phase: "implementation", kind: "initial", status: "finished", requestId: "r", instruction: "登录", runId: null, integrationId: null, error: null, createdAt: stamp }],
    deliveries: [delivery], verifications: [{ id: delivery.verificationId, itemId: id, projectId, subjectId: delivery.id, phase: "delivery", commit, tree, configRevision: 1, environment: "test", status: "passed", startedAt: stamp, finishedAt: stamp, error: null, checks: [{ id: "test", name: "测试", command: "pnpm test", required: true, cwd: "/repo", startedAt: stamp, finishedAt: stamp, status: "passed", exitCode: 0, output: "ok", truncated: false }] }],
    dependencies: {}, workspaces: [], workspaceStates: { [id]: { head: commit, dirty: false, error: null } }, acceptances: [], integrations: [], events: [], head: delivery.baseline, mainVerification: null };
  const attempt: IntegrationAttempt = { id: randomUUID(), itemId: id, projectId, deliveryId: delivery.id, requestId: "i", repositoryKey: "/repo/.git\0refs/heads/main", targetBranch: "main", status: "ready", baseline: delivery.baseline, candidate: commit, tree, workspace: "/candidate", verificationId: null, conflicts: [], patch: "", error: null, mergedCommit: null, createdAt: stamp, updatedAt: stamp };
  attempt.verificationId = randomUUID();
  state.verifications.push({ ...state.verifications[0]!, id: attempt.verificationId, phase: "integration", subjectId: attempt.id });
  return { item, state, delivery, attempt, stamp };
}
describe("requirement decisions and current scope", () => {
  it("exposes acceptance, rework, candidate approval and conflicts as concrete pending actions", () => {
    const f = fixture();
    expect(requirementStatus(f.state, f.item).action?.kind).toBe("acceptance");
    f.state.acceptances.push({ id: randomUUID(), itemId: f.item.id, scopeId: f.delivery.scopeId, deliveryId: f.delivery.id, decision: "rejected", note: "错误提示需调整", createdAt: f.stamp });
    expect(requirementStatus(f.state, f.item).action).toMatchObject({ kind: "rework", reason: "错误提示需调整" });
    f.state.integrations.push(f.attempt);
    expect(requirementStatus(f.state, f.item).action?.kind).toBe("merge");
    f.attempt.status = "conflicts"; f.attempt.error = "登录路由冲突";
    expect(requirementStatus(f.state, f.item).action).toMatchObject({ kind: "integration", reason: "登录路由冲突" });
  });
  it("keeps historical merges out of the current revised scope's lane and completion", () => {
    const f = fixture(); f.attempt.status = "merged"; f.attempt.mergedCommit = f.delivery.commit; f.state.integrations.push(f.attempt);
    expect(requirementStatus(f.state, f.item).merged).toBe(true);
    f.state.scopes.push({ ...f.state.scopes[0]!, id: randomUUID(), version: 2, description: "新增短信登录" });
    const current = requirementStatus(f.state, f.item);
    expect(current).toMatchObject({ valid: false, merged: false, everMerged: true, lane: "planned", implementation: "新范围待实施", acceptance: "未验收" });
    expect(current.versionLabel).toBe("v1 已合入 · 当前范围 v2");
  });
  it("does not count read-only discussion as implementation of a new scope", () => {
    const f = fixture(); f.state.tickets = [{ ...f.state.tickets[0]!, phase: "discussion", kind: "discussion" }]; f.state.deliveries = []; f.state.verifications = [];
    expect(requirementStatus(f.state, f.item)).toMatchObject({ implementation: "未开始", valid: false, lane: "planned" });
    f.state.tickets[0]!.status = "running";
    expect(requirementStatus(f.state, f.item)).toMatchObject({ implementation: "只读讨论中", lane: "running" });
  });
  it("keeps the merge fact after check configuration changes and blocks obsolete ready candidates", () => {
    const f = fixture(); f.state.integrations.push(f.attempt);
    f.state.head = "d".repeat(40);
    expect(requirementStatus(f.state, f.item).action?.kind).toBe("integration");
    f.attempt.status = "merged"; f.attempt.mergedCommit = f.delivery.commit; f.state.configs[0]!.revision++;
    expect(requirementStatus(f.state, f.item)).toMatchObject({ valid: false, merged: true, everMerged: true });
  });
  it("requires fresh evidence after source edits or check configuration changes", () => {
    const f = fixture(); f.state.workspaceStates[f.item.id]!.dirty = true;
    expect(requirementStatus(f.state, f.item).valid).toBe(false);
    f.state.workspaceStates[f.item.id]!.dirty = false; f.state.configs[0]!.revision++;
    expect(requirementStatus(f.state, f.item).valid).toBe(false);
    f.item.state = "archived";
    expect(requirementStatus(f.state, f.item).action).toBeNull();
  });
});

it("projects design confirmation and revised PRDs consistently without accepting an obsolete delivery", () => {
  const f = fixture(); const firstId = randomUUID();
  f.state.plans = [{ itemId: f.item.id, confirmedScopeId: null, currentPrdId: null }];
  expect(requirementStatus(f.state, f.item)).toMatchObject({ valid: false, action: { kind: "design", view: "design", reason: "当前需求范围等待确认" } });
  f.state.plans[0]!.confirmedScopeId = f.delivery.scopeId;
  f.state.plans[0]!.currentPrdId = firstId;
  f.state.prds = [{ id: firstId, itemId: f.item.id, scopeId: f.delivery.scopeId, version: 1, previousId: null, content: "方案", reason: "初稿", createdAt: f.stamp, confirmedAt: null, frozenAt: null, deliveryId: null, moduleChanges: [] }];
  expect(requirementStatus(f.state, f.item).action).toMatchObject({ kind: "design", reason: "当前 PRD 等待审阅与确认" });
  f.state.prds[0]!.confirmedAt = f.stamp; f.state.tickets[0]!.prdId = firstId; f.delivery.prdId = firstId;
  expect(requirementStatus(f.state, f.item)).toMatchObject({ valid: true, action: { kind: "acceptance" } });
  const nextId = randomUUID(); f.state.prds.push({ ...f.state.prds[0]!, id: nextId, version: 2, previousId: firstId }); f.state.plans[0]!.currentPrdId = nextId;
  expect(requirementStatus(f.state, f.item)).toMatchObject({ valid: false, lane: "planned", implementation: "新设计待实施", acceptance: "未验收" });
  f.state.modules = [{ id: randomUUID(), projectId: f.item.projectId, name: "权限", createdAt: f.stamp }];
  f.state.prds[1]!.moduleChanges = [{ moduleId: f.state.modules[0]!.id, baseRevisionId: randomUUID(), content: "旧模块提案" }];
  f.state.moduleRevisions = [];
  expect(requirementStatus(f.state, f.item).action).toMatchObject({ kind: "design", reason: "模块已有新设计，请合并设计并确认新 PRD" });
});
