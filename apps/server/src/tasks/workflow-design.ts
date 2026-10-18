import { randomUUID } from "node:crypto";
import { requirementFiles, requirementDesignPath, workItemPrompt, type ClientCommand, type Delivery, type RequirementPrd, type WorkItem } from "@qingzhou/protocol";
import type { WorkflowStore } from "./workflow-store.js";
import { readWorkspaceDesign, writeWorkspaceDesign } from "./workflow-design-file.js";
import { initializeProjectStandard } from "./project-standard.js";
import { readWorkspaceText } from "./workspace-files.js";
import { workflowGit } from "./workflow-git.js";
import { materializeRequirementDocuments, readDesignMarkdown, requirementDocuments } from "./workflow-design-docs.js";
import type { WorkItemStore } from "./work-item-store.js";
import { materializeModuleDocuments, moduleDocument } from "./workflow-module-docs.js";

type SavePrd = Extract<ClientCommand, { type: "workflow.prd.save" }>["payload"];
const now = () => new Date().toISOString();

/** PRD content is append-only. Confirmation and completion always name an exact revision. */
export class WorkflowDesign {
  constructor(private readonly store: WorkflowStore, private readonly items: WorkItemStore) {}
  plan(id: string) { return this.store.state.plans?.find((entry) => entry.itemId === id); }
  prd(id: string) { return this.store.state.prds?.find((entry) => entry.id === this.plan(id)?.currentPrdId); }
  private item(id: string) {
    const item = this.items.get(id);
    if (!item) throw new Error("找不到这个需求");
    return item;
  }
  begin(id: string) {
    const item = this.item(id);
    if (this.plan(id)) return this.plan(id)!;
    const plan = { itemId: id, confirmedScopeId: null, currentPrdId: null };
    (this.store.state.plans ??= []).push(plan);
    this.store.scope(item);
    this.store.event(item.projectId, id, "design.started", null, "进入需求沟通；先确认范围，再确认 PRD，之后实施。");
    return plan;
  }
  assertMutable(id: string) {
    if (this.prd(id)?.frozenAt) throw new Error("这个需求的 PRD 已固化；后续设计变更请创建关联子需求，保留原始交付依据。");
  }
  confirmScope(id: string, scopeId: string) {
    const item = this.item(id);
    const scope = this.store.scope(item);
    if (scope.id !== scopeId) throw new Error("需求范围已变化，请重新审阅后确认");
    if (!scope.description.trim() || !scope.acceptanceCriteria.trim()) throw new Error("请先完善目标说明与验收标准");
    this.begin(id).confirmedScopeId = scopeId;
    this.store.event(item.projectId, id, "scope.confirmed", scopeId, `已确认需求范围 v${scope.version}，接下来审阅 PRD。`);
  }
  private validateModules(item: WorkItem, changes: RequirementPrd["moduleChanges"], requireCurrent: boolean, baseline?: RequirementPrd["codeBaseline"]) {
    if (new Set(changes.map((entry) => entry.moduleId)).size !== changes.length) throw new Error("关联模块不能重复");
    for (const change of changes) {
      const module = this.store.state.modules?.find((entry) => entry.id === change.moduleId && entry.projectId === item.projectId);
      if (!module) throw new Error("关联模块不属于当前项目");
      const current = this.store.state.moduleRevisions?.filter((entry) => entry.moduleId === module.id).at(-1);
      if (change.baseRevisionId && !this.store.state.moduleRevisions?.some((entry) => entry.id === change.baseRevisionId && entry.moduleId === module.id)) throw new Error("模块依据版本不匹配");
      const expected = baseline ? baseline.moduleRevisionIds[module.id] ?? null : current?.id ?? null;
      if (requireCurrent && expected !== change.baseRevisionId) throw new Error(`模块“${module.name}”已有新设计或与代码基线不一致，请对照代码对应的模块文档合并设计，再保存并确认新 PRD。`);
      if (!change.content.trim()) throw new Error("请填写模块变更后的完整设计");
    }
  }
  save(input: SavePrd) {
    const item = this.item(input.id);
    this.assertMutable(item.id);
    const plan = this.begin(item.id);
    if (plan.currentPrdId !== input.expectedPrdId) throw new Error("PRD 已有新版本，请刷新后合并草稿，避免覆盖他人的修改");
    const scope = this.store.scope(item);
    if (scope.id !== input.scopeId || plan.confirmedScopeId !== scope.id) throw new Error("请先确认当前需求范围，再保存 PRD");
    this.validateModules(item, input.moduleChanges, false);
    const prd: RequirementPrd = {
      id: randomUUID(), itemId: item.id, scopeId: scope.id,
      version: (this.store.state.prds?.filter((entry) => entry.itemId === item.id).at(-1)?.version ?? 0) + 1,
      previousId: plan.currentPrdId, content: input.content, reason: input.reason,
      moduleChanges: structuredClone(input.moduleChanges), createdAt: now(), confirmedAt: null, frozenAt: null, deliveryId: null,
    };
    (this.store.state.prds ??= []).push(prd); plan.currentPrdId = prd.id;
    this.store.event(item.projectId, item.id, "prd.revised", prd.id, `PRD v${prd.version}：${prd.reason}；需确认后实施。`);
    return { prd };
  }
  confirm(id: string, prdId: string, baseline?: RequirementPrd["codeBaseline"]) {
    const item = this.item(id);
    const prd = this.prd(id);
    if (!prd || prd.id !== prdId) throw new Error("PRD 版本已变化，请重新审阅");
    if (prd.frozenAt) return { prd };
    if (this.plan(id)?.confirmedScopeId !== this.store.scope(item).id || prd.scopeId !== this.store.scope(item).id) throw new Error("需求范围已变化，请先确认范围并更新 PRD");
    if (!prd.content.trim()) throw new Error("PRD 不能为空");
    this.validateModules(item, prd.moduleChanges, true, prd.codeBaseline ?? baseline);
    if (workItemPrompt(this.store.scope(item)).length + this.context(id).length > 29500) throw new Error("范围、PRD 与模块设计合计过长，请精简正文或拆分需求，确保完整设计能传入实施上下文");
    if (!prd.confirmedAt) {
      prd.codeBaseline = baseline;
      prd.confirmedAt = now();
      this.store.event(item.projectId, id, "prd.confirmed", prd.id, `PRD v${prd.version} 已确认，可开始实施；调整设计须另存新版本。`);
    }
    return { prd };
  }
  assertReady(item: WorkItem): RequirementPrd | undefined {
    const plan = this.plan(item.id);
    if (!plan) return undefined; // Existing work remains readable and can explicitly adopt this workflow.
    this.assertMutable(item.id);
    const scope = this.store.scope(item);
    if (plan.confirmedScopeId !== scope.id) throw new Error("请先沟通并确认当前需求范围，再确认 PRD");
    const prd = this.prd(item.id);
    if (!prd?.confirmedAt || prd.scopeId !== scope.id) throw new Error("请先审阅并确认当前 PRD，再开始实施");
    this.validateModules(item, prd.moduleChanges, true, prd.codeBaseline);
    return prd;
  }
  assertDelivery(delivery: Delivery) {
    if (!this.plan(delivery.itemId)) return;
    const prd = this.prd(delivery.itemId);
    if (!prd?.confirmedAt || prd.id !== delivery.prdId || prd.scopeId !== delivery.scopeId || this.store.scope(this.item(delivery.itemId)).id !== delivery.scopeId) throw new Error("交付所依据的 PRD 已变化，请按新 PRD 实施并重新封存验证");
  }
  finalize(delivery: Delivery) {
    if (!this.plan(delivery.itemId)) return;
    this.assertDelivery(delivery);
    const prd = this.prd(delivery.itemId)!;
    if (prd.frozenAt) return;
    const item = this.item(delivery.itemId);
    this.validateModules(item, prd.moduleChanges, true, prd.codeBaseline);
    // All preconditions are checked before any module is changed; one persistence write records completion.
    for (const change of prd.moduleChanges) {
      const previous = this.store.state.moduleRevisions?.filter((entry) => entry.moduleId === change.moduleId).at(-1);
      const revision = { id: randomUUID(), moduleId: change.moduleId, previousId: prd.codeBaseline ? change.baseRevisionId : previous?.id ?? null,
        version: (previous?.version ?? 0) + 1, content: change.content, sourcePrdId: prd.id, deliveryId: delivery.id, createdAt: now() };
      (this.store.state.moduleRevisions ??= []).push(revision);
      this.store.event(item.projectId, item.id, "module.updated", revision.id, `模块设计更新至 v${revision.version}，依据 PRD v${prd.version}；代码合入状态独立记录。`);
    }
    prd.frozenAt = now(); prd.deliveryId = delivery.id;
    this.store.event(item.projectId, item.id, "prd.frozen", prd.id, `最终确认完成，PRD v${prd.version} 已固化，保留交付与模块版本关联。`);
  }
  createModule(projectId: string, name: string, content: string) {
    if (!this.items.getProject(projectId)) throw new Error("找不到这个项目");
    if (this.store.state.modules?.some((entry) => entry.projectId === projectId && entry.name.trim() === name.trim())) throw new Error("项目中已有同名模块");
    const moduleId = randomUUID();
    const module = { id: moduleId, documentPath: `docs/modules/${moduleId}.md`, projectId, name: name.trim(), createdAt: now() };
    if (!module.name) throw new Error("请填写模块名称");
    (this.store.state.modules ??= []).push(module);
    const revision = { id: randomUUID(), moduleId: module.id, version: 1, previousId: null,
      content, sourcePrdId: null, deliveryId: null, createdAt: now() };
    (this.store.state.moduleRevisions ??= []).push(revision);
    this.store.event(projectId, null, "module.created", module.id, `建立模块“${module.name}”的设计基线。后续更新通过关联 PRD 交付。`);
    return { module, revision };
  }
  private matches(document: { content: string; moduleChanges: RequirementPrd["moduleChanges"] }, prd: RequirementPrd): boolean {
    return document.content === prd.content && JSON.stringify(document.moduleChanges) === JSON.stringify(prd.moduleChanges);
  }
  private async readDocument(id: string, cwd: string) {
    const document = await readWorkspaceDesign(cwd, id);
    if (!document) return null;
    const base = this.store.state.prds?.find((entry) => entry.id === document.prdId && entry.itemId === id);
    if (!base) throw new Error("工作区设计文件的 PRD 依据不属于当前需求");
    return readDesignMarkdown(cwd, id, document, base);
  }
  async materialize(id: string, cwd: string): Promise<void> {
    const prd = this.prd(id);
    if (!prd?.confirmedAt || prd.frozenAt) return;
    const existing = await this.readDocument(id, cwd);
    if (existing) {
      const recorded = this.store.state.prds?.find((entry) => entry.id === existing.prdId && entry.itemId === id);
      const imported = this.store.state.prds?.some((entry) => entry.itemId === id && entry.previousId === existing.prdId && this.matches(existing, entry));
      if (!recorded || (!this.matches(existing, recorded) && !imported)) throw new Error("工作区设计文件有未同步调整，请先在设计面板同步 PRD，再确认并实施");
    }
    const item = this.item(id);
    if (prd.codeBaseline) for (const change of prd.moduleChanges) {
      const module = this.store.state.modules?.find((entry) => entry.id === change.moduleId);
      if (module) module.documentPath ??= `docs/modules/${module.id}.md`;
    }
    await initializeProjectStandard(cwd, this.items.getProject(item.projectId)?.name ?? "项目");
    await materializeRequirementDocuments(cwd, item, prd, this.store.state);
    if (prd.codeBaseline) await materializeModuleDocuments(cwd, prd, this.store.state);
    await writeWorkspaceDesign(cwd, id, { schemaVersion: 1, documentationVersion: 1, prdId: prd.id, content: prd.content, moduleChanges: prd.moduleChanges });
  }
  async importFile(id: string, cwd: string): Promise<{ prd: RequirementPrd; changed: boolean }> {
    const prd = this.prd(id);
    if (!prd) throw new Error("请先建立 PRD");
    this.assertMutable(id);
    const document = await this.readDocument(id, cwd);
    if (!document) throw new Error("工作区尚无设计文档；确认 PRD 后首次实施会自动建立");
    if (this.matches(document, prd)) return { prd, changed: false };
    if (document.prdId !== prd.id) throw new Error("工作区设计文件依据的 PRD 已过期，请先合并设计面板与文件中的修改，避免覆盖新版本");
    const result = this.save({ id, scopeId: prd.scopeId, expectedPrdId: prd.id, content: document.content,
      moduleChanges: document.moduleChanges, reason: "从实施工作区同步设计调整" });
    return { ...result, changed: true };
  }
  async assertFileCurrent(id: string, cwd: string): Promise<void> {
    const prd = this.prd(id);
    if (!prd) return;
    const document = await this.readDocument(id, cwd);
    if (!document || document.prdId !== prd.id || !this.matches(document, prd)) throw new Error("工作区 PRD 与确认版本不一致，请先同步设计、确认并实施后重新封存");
  }
  async assertSnapshot(id: string, cwd: string, commit?: string, requiredVersion?: 1): Promise<void> {
    const prd = this.prd(id);
    if (!prd) return;
    const document = await readWorkspaceDesign(cwd, id);
    if (requiredVersion && document?.documentationVersion !== requiredVersion) throw new Error("需求文档版本标记缺失，请恢复确认的工作区设计后重试");
    if (!requiredVersion && !document?.documentationVersion && await readWorkspaceText(cwd, requirementFiles(id).context) === null) return; // Legacy JSON-only workspaces remain compatible.
    for (const [file, expected] of Object.entries(requirementDocuments(this.item(id), prd, this.store.state))) {
      const actual = commit ? await workflowGit(cwd, ["show", `${commit}:${file}`]).catch(() => null) : await readWorkspaceText(cwd, file);
      if (actual === null || (commit ? actual !== expected.trimEnd() : actual !== expected)) throw new Error("需求文档快照与确认设计不一致，请检查 PRD、模块提案、CONTEXT.md 与基线快照后重试");
    }
  }
  async assertModuleDocuments(id: string, cwd: string, commit?: string): Promise<void> {
    const prd = this.prd(id);
    if (!prd?.codeBaseline) return;
    for (const change of prd?.moduleChanges ?? []) {
      const module = this.store.state.modules?.find((entry) => entry.id === change.moduleId);
      if (!module?.documentPath || !prd) continue;
      const actual = commit ? await workflowGit(cwd, ["show", `${commit}:${module.documentPath}`]).catch(() => null) : await readWorkspaceText(cwd, module.documentPath);
      const expected = moduleDocument(module, prd, change.content);
      if (actual !== (commit ? expected.trimEnd() : expected)) throw new Error("模块仓库文档与 PRD 提案不一致，请同步设计并重新实施后封存");
    }
  }
  context(id: string): string {
    const prd = this.prd(id);
    if (!prd) return "";
    const modules = prd.moduleChanges.map((change) => {
      const name = this.store.state.modules?.find((entry) => entry.id === change.moduleId)?.name ?? change.moduleId;
      return `### 模块：${name}\n${change.content}`;
    }).join("\n\n");
    return `\n\n## ${prd.confirmedAt ? "已确认" : "待确认"}的 PRD v${prd.version}（${prd.id}）\n${prd.content}\n\n## 本需求完成后的模块设计\n${modules || "未关联模块"}\n\n实施时先读 ${requirementFiles(id).context} 与 ${requirementFiles(id).agents}。设计 JSON 为 ${requirementDesignPath(id)}，可直接编辑 ${requirementFiles(id).prd} 和同目录 modules/<模块 ID>.md，并维护 IMPLEMENTATION.md、VERIFICATION.md。Markdown 与 JSON 若同时修改需保持一致，不改写确认 ID 或模块基线；本轮结束后系统会读回为待确认的新 PRD。请说明差异，与用户重新确认后继续对应实现。执行结束不代表 PRD 已固化。`;
  }
}
