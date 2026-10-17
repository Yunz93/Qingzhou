import { randomUUID } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import {
  ACTIVE_INTEGRATIONS, requirementDesignPath, workspaceDesignSchema, verificationIsValid, workItemPrompt, workItemFeedbackPrompt,
  type ClientCommand, type Delivery, type DeliveryAcceptance, type IntegrationAttempt, type Verification,
  type WorkItem, type WorkRunKind, type WorkflowConfig, type WorkflowCheck,
  type WorkflowProjectState, type WorkflowTicket, type TimelineMessage, type ToolExecution,
} from "@qingzhou/protocol";
import { workItemContext } from "./work-item-context.js";
import { WorkflowDesign } from "./workflow-design.js";
import { WorkflowStore } from "./workflow-store.js";
import { changedPaths, workflowArtifact, redactWorkflowLog, repositoryInfo, safeWorkflowPath, workflowGit as git } from "./workflow-git.js";
import type { WorkItemStore } from "./work-item-store.js";

type Host = {
  dataDir: string;
  items: WorkItemStore;
  launch: (id: string, cwd: string, kind: WorkRunKind, instruction: string, imageIds?: string[]) => Promise<void>;
  emit: () => void;
  release?: (id: string) => Promise<void>;
};
const now = () => new Date().toISOString();
const active = (attempt: IntegrationAttempt) => (ACTIVE_INTEGRATIONS as readonly string[]).includes(attempt.status);
const errorText = (error: unknown) => redactWorkflowLog(error instanceof Error ? error.message : String(error)).slice(0, 8000);

/** Durable facts live separately from legacy sessions; old success never becomes verification. */
export class WorkflowService {
  readonly store: WorkflowStore;
  readonly design: WorkflowDesign;
  readonly ready: Promise<void>;
  private pumping = false;
  private pumpAgain = false;
  private integrationPumping = false;
  private integrationPumpAgain = false;
  private disposed = false;
  private readonly operations = new Map<string, Promise<unknown>>();
  private readonly resourceWaits = new Map<string, string>();
  private readonly resourceLocks = new Map<string, Promise<unknown>>();
  private readonly jobs = new Set<Promise<unknown>>();
  private readonly children = new Set<ReturnType<typeof spawn>>();
  private readonly slotWaiters = new Set<() => void>();
  private readonly reservations = new Map<string, number>();

  constructor(private readonly host: Host) {
    this.store = new WorkflowStore(host.dataDir);
    this.design = new WorkflowDesign(this.store, host.items);
    this.ready = this.load();
    // Retain startup errors for RPC callers without an unhandled rejection.
    void this.ready.catch(() => {});
  }
  private async load(): Promise<void> {
    await this.store.load(this.host.items);
    for (const attempt of this.store.state.integrations) {
      if (attempt.status === "merging") {
        const config = this.config(attempt.projectId);
        const head = config ? await git(config.repository, ["rev-parse", `refs/heads/${attempt.targetBranch}`]).catch(() => "") : "";
        if (config && attempt.candidate && head === attempt.candidate) {
          await this.syncCheckedOutTree(config, attempt).catch((error) => { attempt.error = errorText(error); });
          await this.markMerged(attempt);
        } else {
          attempt.status = "failed";
          attempt.error = "合入中断，真实分支未指向候选；请重新准备。";
        }
      } else if (["preparing", "verifying", "queued"].includes(attempt.status)) {
        attempt.status = "failed";
        attempt.error = "集成已中断，未自动重放操作；可检查现场后重新验证。";
      }
    }
    await this.store.save();
  }
  enabled(projectId: string): boolean { return !!this.config(projectId); }
  hasRequest(itemId: string, requestId: string): boolean {
    return this.store.state.tickets.some((ticket) => ticket.itemId === itemId && ticket.requestId === requestId);
  }
  private config(projectId: string): WorkflowConfig | undefined { return this.store.state.configs.find((entry) => entry.projectId === projectId); }
  private item(id: string): WorkItem {
    const item = this.host.items.get(id);
    if (!item) throw new Error("找不到这个需求");
    return item;
  }
  private requireConfig(projectId: string): WorkflowConfig {
    const config = this.config(projectId);
    if (!config) throw new Error("请先配置 Git 集成分支和项目检查");
    return config;
  }
  private async repository(config: WorkflowConfig): Promise<void> {
    const info = await repositoryInfo(config.repository);
    if (info.commonDir !== config.commonDir) throw new Error("仓库身份已变化，请检查项目目录");
  }
  private lock<T>(key: string, operation: () => Promise<T>, locks = this.operations): Promise<T> {
    const previous = locks.get(key) ?? Promise.resolve();
    const result = previous.catch(() => {}).then(operation);
    locks.set(key, result);
    void result.finally(() => { if (locks.get(key) === result) locks.delete(key); }).catch(() => {});
    return result;
  }
  private background(operation: () => Promise<unknown>, projectId: string, itemId: string | null): void {
    if (this.disposed) return;
    const job = operation().catch(async (error) => {
      this.store.event(projectId, itemId, "operation.failed", null, errorText(error));
      await this.changed();
    });
    this.jobs.add(job);
    void job.finally(() => this.jobs.delete(job)).catch(() => {});
  }
  async idle(): Promise<void> { while (this.jobs.size) await Promise.allSettled([...this.jobs]); }
  async flush(): Promise<void> { await this.ready; await this.store.flush(); }
  dispose(): void {
    this.disposed = true;
    for (const wake of this.slotWaiters) wake();
    for (const child of this.children) this.kill(child);
  }
  private async changed(): Promise<void> {
    await this.store.save(); this.host.emit();
    for (const wake of this.slotWaiters) wake();
    this.slotWaiters.clear();
  }
  async syncScope(item: WorkItem): Promise<void> { await this.ready; this.store.scope(this.item(item.id)); await this.changed(); }
  async updateScope(id: string, patch: { title?: string; description?: string; acceptanceCriteria?: string }): Promise<WorkItem> {
    await this.ready;
    return this.lock(`item:${id}`, async () => {
      this.assertDesignEditable(id);
      const item = await this.host.items.update(id, patch);
      this.store.scope(item); await this.changed(); return item;
    });
  }
  private instructionWithDesign(id: string, instruction: string): string {
    const full = instruction + this.design.context(id);
    if (full.length > 30000) throw new Error("范围、PRD 与模块设计合计超过本轮上下文上限，请精简正文或拆分需求后重试");
    return full;
  }
  async beginPlanning(id: string): Promise<void> {
    await this.ready;
    await this.lock(`item:${id}`, async () => { this.assertEditable(id); this.design.begin(id); await this.changed(); });
  }
  assertDesignEditable(id: string): void { this.assertEditable(id); this.design.assertMutable(id); }
  async feedback(id: string, text: string, requestId: string = randomUUID(), imageIds?: string[], expectedDeliveryId?: string): Promise<{ item: WorkItem }> {
    await this.ready;
    return this.lock(`item:${id}`, async () => {
      const item = this.item(id);
      if (this.hasRequest(id, requestId)) return { item };
      this.assertDesignEditable(id);
      this.assertImplementationScope(item);
      if (item.state !== "open") throw new Error("请先重新打开这个需求");
      const instruction = workItemFeedbackPrompt({ ...item, description: workItemContext(item) }, text);
      this.instructionWithDesign(id, instruction);
      const delivery = this.store.state.deliveries.filter((entry) => entry.itemId === id).at(-1);
      if (expectedDeliveryId) {
        if (!delivery || delivery.id !== expectedDeliveryId) throw new Error("交付已变化，请重新审阅后提交反馈");
        await this.currentDelivery(delivery);
      }
      if (delivery) {
        const acceptance = { id: randomUUID(), itemId: id, deliveryId: delivery.id, scopeId: delivery.scopeId,
          decision: "rejected" as const, note: text, createdAt: now() };
        this.store.state.acceptances.push(acceptance);
        this.store.event(item.projectId, id, "delivery.rejected", acceptance.id, `需要返工：${text}`);
      }
      await this.host.items.addFeedback(id, text, imageIds);
      return this.enqueueLocked(id, "feedback", workItemFeedbackPrompt({ ...this.item(id), description: workItemContext(this.item(id)) }, text), requestId, imageIds);
    });
  }
  async state(projectId: string): Promise<WorkflowProjectState> {
    await this.ready;
    const items = this.host.items.listByProject(projectId);
    const ids = new Set(items.map((item) => item.id));
    const count = this.store.state.scopes.length;
    for (const item of items) this.store.scope(item);
    if (count !== this.store.state.scopes.length) await this.store.save();
    const config = this.config(projectId);
    const head = config ? await git(config.repository, ["rev-parse", `refs/heads/${config.targetBranch}`]).catch(() => null) : null;
    const tree = head && config ? await git(config.repository, ["rev-parse", `${head}^{tree}`]).catch(() => "") : "";
    const state = this.store.state;
    const workspaceStates: WorkflowProjectState["workspaceStates"] = {};
    await Promise.all(state.workspaces.filter((entry) => ids.has(entry.itemId) && !entry.removedAt).map(async (workspace) => {
      try {
        const [head, dirty] = await Promise.all([git(workspace.path, ["rev-parse", "HEAD"]), changedPaths(workspace.path)]);
        workspaceStates[workspace.itemId] = { head, dirty: dirty.length > 0, error: null };
      } catch (error) { workspaceStates[workspace.itemId] = { head: null, dirty: true, error: errorText(error) }; }
    }));
    const mainVerification = config ? [...state.verifications].reverse().find((result) =>
      result.projectId === projectId && result.phase === "main" && result.commit === head && result.tree === tree && result.configRevision === config.revision) ?? null : null;
    const running = state.tickets.filter((ticket) => ticket.projectId === projectId && ticket.status === "running").length;
    const verifying = state.verifications.filter((result) => result.projectId === projectId && result.status === "running").length;
    const reserved = this.reservations.get(projectId) ?? 0;
    const reasons: Record<string, string> = {};
    for (const ticket of state.tickets.filter((entry) => entry.projectId === projectId && entry.status === "queued")) {
      const missing = (ticket.phase === "discussion" ? [] : state.dependencies[ticket.itemId] ?? []).filter((id) => !state.integrations.some((entry) => entry.itemId === id && entry.status === "merged" && config && entry.repositoryKey === this.repoKey(config)));
      reasons[ticket.itemId] = ticket.error || (config?.paused ? "项目已暂停后续执行" : missing.length ? `等待前置合入：${missing.map((id) => this.host.items.get(id)?.title ?? id).join("、")}` : config && this.used(projectId) >= config.concurrency ? `等待执行名额：实施/讨论 ${running}，验证 ${verifying}，准备 ${reserved}` : "等待调度；启动后可能等待系统 AI 进程名额");
    }
    const baselineRelations: NonNullable<WorkflowProjectState["baselineRelations"]> = {};
    if (config && head) await Promise.all(state.workspaces.filter((entry) => ids.has(entry.itemId) && !entry.removedAt).map(async (workspace) => {
      const includedItemIds: string[] = [];
      try {
        for (const attempt of state.integrations.filter((entry) => entry.projectId === projectId && entry.status === "merged" && entry.mergedCommit)) {
          const inMain = await git(config.repository, ["merge-base", "--is-ancestor", attempt.mergedCommit!, head]).then(() => true, () => false);
          const inBase = await git(config.repository, ["merge-base", "--is-ancestor", attempt.mergedCommit!, workspace.baseline]).then(() => true, () => false);
          if (inMain && !inBase) includedItemIds.push(attempt.itemId);
        }
        baselineRelations[workspace.itemId] = { behind: workspace.baseline !== head, includedItemIds: [...new Set(includedItemIds)] };
      } catch (error) { baselineRelations[workspace.itemId] = { behind: true, includedItemIds, error: errorText(error) }; }
    }));
    return structuredClone({
      queue: { running, verifying, reserved, used: running + verifying + reserved, limit: config?.concurrency ?? 1, reasons, resourceWaits: Object.fromEntries(this.resourceWaits) }, baselineRelations,
      ...state,
      plans: state.plans?.filter((entry) => ids.has(entry.itemId)), prds: state.prds?.filter((entry) => ids.has(entry.itemId)),
      modules: state.modules?.filter((entry) => entry.projectId === projectId),
      moduleRevisions: state.moduleRevisions?.filter((entry) => state.modules?.some((module) => module.id === entry.moduleId && module.projectId === projectId)),
      configs: state.configs.filter((entry) => entry.projectId === projectId),
      scopes: state.scopes.filter((entry) => ids.has(entry.itemId)),
      workspaces: state.workspaces.filter((entry) => ids.has(entry.itemId)),
      dependencies: Object.fromEntries(Object.entries(state.dependencies).filter(([id]) => ids.has(id))),
      tickets: state.tickets.filter((entry) => entry.projectId === projectId),
      deliveries: state.deliveries.filter((entry) => ids.has(entry.itemId)),
      acceptances: state.acceptances.filter((entry) => ids.has(entry.itemId)),
      verifications: state.verifications.filter((entry) => entry.projectId === projectId),
      integrations: state.integrations.filter((entry) => entry.projectId === projectId),
      events: state.events.filter((entry) => entry.projectId === projectId), head, mainVerification, workspaceStates,
    });
  }
  async handle(command: ClientCommand): Promise<unknown> {
    await this.ready;
    switch (command.type) {
      case "workflow.plan.begin": await this.beginPlanning(command.payload.id); return { ok: true };
      case "workflow.scope.confirm":
      case "workflow.prd.save":
      case "workflow.prd.confirm": return this.lock(`item:${command.payload.id}`, async () => {
        this.assertDesignEditable(command.payload.id);
        const result = command.type === "workflow.scope.confirm" ? this.design.confirmScope(command.payload.id, command.payload.scopeId)
          : command.type === "workflow.prd.save" ? this.design.save(command.payload) : this.design.confirm(command.payload.id, command.payload.prdId);
        await this.changed(); return result ?? { ok: true };
      });
      case "workflow.prd.import": return this.lock(`item:${command.payload.id}`, async () => {
        const id = command.payload.id; this.assertDesignEditable(id);
        const workspace = this.store.state.workspaces.find((entry) => entry.itemId === id && !entry.removedAt);
        if (!workspace) throw new Error("需求还没有实施工作区");
        const result = await this.design.importFile(id, workspace.path);
        this.store.event(this.item(id).projectId, id, "prd.file.synced", result.prd.id, result.changed ? "已读取工作区设计变更，等待确认新 PRD。" : "工作区设计内容与当前 PRD 一致。");
        await this.changed(); return result;
      });
      case "workflow.module.create": return this.lock(`modules:${command.payload.projectId}`, async () => {
        const result = this.design.createModule(command.payload.projectId, command.payload.name, command.payload.content);
        await this.changed(); return result;
      });
      case "workflow.inspect": {
        const project = this.host.items.getProject(command.payload.projectId);
        if (!project) throw new Error("找不到这个项目");
        try {
          const info = await repositoryInfo(project.cwd);
          const suggestedChecks: WorkflowCheck[] = [];
          try {
            const manifest = JSON.parse(await readFile(path.join(info.repository, "package.json"), "utf8")) as { packageManager?: string; scripts?: Record<string, string> };
            const pm = /^(pnpm|yarn|bun|npm)(?:@|$)/.exec(manifest.packageManager ?? "npm")?.[1] ?? "npm";
            for (const [id, name] of [["lint", "代码检查"], ["typecheck", "类型检查"], ["test", "测试"], ["build", "构建"]]) {
              if (manifest.scripts?.[id!]) suggestedChecks.push({ id: `detected-${id}`, name: name!, command: `${pm} run ${id}`, required: true, timeoutMs: 600000, resource: "" });
            }
          } catch { /* Repositories without package.json use manual checks. */ }
          return { isGit: true, ...info, suggestedChecks };
        }
        catch { return { isGit: false, message: "目录不是可用的 Git 仓库，请先建立或选择仓库。" }; }
      }
      case "workflow.state": return this.state(command.payload.projectId);
      case "workflow.configure": return this.configure(command.payload);
      case "workflow.enqueue":
        for (const id of command.payload.ids) this.assertImplementationScope(this.item(id));
        for (const id of command.payload.ids) await this.enqueue(id, "initial", undefined, `${command.operationId}:${id}`);
        return { ok: true };
      case "workflow.pause": {
        const config = this.requireConfig(command.payload.projectId);
        config.paused = command.payload.paused;
        this.store.event(config.projectId, null, "queue.paused", null, config.paused ? "暂停后续执行；正在运行的需求保留现场。" : "恢复执行队列。");
        await this.changed(); this.kick(); return { ok: true };
      }
      case "workflow.dependencies": return this.dependencies(command.payload.id, command.payload.dependencies);
      case "workflow.changes": return this.changes(command.payload.id);
      case "workflow.seal": return this.seal(command.payload.id, command.payload.paths, command.payload.summary, command.operationId, command.payload.review);
      case "workflow.accept": return this.accept(command.payload.deliveryId, command.payload.decision, command.payload.note, command.payload.evidence);
      case "workflow.integrate": return this.integrate(command.payload.deliveryId, command.operationId);
      case "workflow.integration.recheck": return this.recheck(command.payload.id);
      case "workflow.integration.repair": return this.repair(command.payload.id, command.payload.instruction);
      case "workflow.integration.merge": return this.merge(command.payload.id);
      case "workflow.integration.cancel": return this.cancelIntegration(command.payload.id);
      case "workflow.integration.reorder": return this.reorderIntegration(command.payload.id, command.payload.beforeId);
      case "workflow.verifyMain": return this.verifyMain(command.payload.projectId);
      case "workflow.cleanup": return this.cleanup(command.payload.id);
      case "workflow.revert": return this.revert(command.payload.integrationId, command.operationId);
      case "workflow.artifact": {
        const delivery = this.delivery(command.payload.deliveryId);
        const config = this.requireConfig(this.item(delivery.itemId).projectId);
        if (!delivery.review?.artifactPaths.includes(command.payload.path)) throw new Error("产物未登记在此交付中");
        return workflowArtifact(config.repository, delivery.commit, command.payload.path);
      }
      case "workflow.compare": {
        const config = this.requireConfig(command.payload.projectId);
        const projectState = await this.state(config.projectId);
        const versions = new Set([projectState.head, ...projectState.deliveries.flatMap((entry) => [entry.commit, entry.baseline]), ...projectState.integrations.filter((entry) => entry.status === "merged").flatMap((entry) => [entry.baseline, entry.mergedCommit])]);
        const { from, to } = command.payload;
        if (!/^[a-f0-9]{40,64}$/.test(from) || !/^[a-f0-9]{40,64}$/.test(to) || !versions.has(from) || !versions.has(to)) throw new Error("只能比较已记录的主线版本");
        return { files: (await git(config.repository, ["diff", "--name-only", "-z", from, to])).split("\0").filter(Boolean), patch: await git(config.repository, ["diff", "--no-ext-diff", "--no-textconv", from, to]) };
      }
      case "workflow.transcript": {
        const runId = command.payload.runId;
        if (!this.store.state.events.some((event) => event.type === "conversation.captured" && event.subjectId === runId)) throw new Error("这一轮没有保存的对话快照");
        return JSON.parse(await readFile(path.join(this.host.dataDir, "workflow-transcripts", `${runId}.json`), "utf8"));
      }
      default: throw new Error("未知项目编排操作");
    }
  }
  private async configure(input: { projectId: string; targetBranch: string; concurrency: number; checks: WorkflowCheck[] }): Promise<WorkflowConfig> {
    return this.lock(`project:${input.projectId}`, async () => {
      const project = this.host.items.getProject(input.projectId);
      if (!project) throw new Error("找不到这个项目");
      const info = await repositoryInfo(project.cwd);
      await git(info.repository, ["check-ref-format", "--branch", input.targetBranch]);
      await git(info.repository, ["rev-parse", "--verify", `refs/heads/${input.targetBranch}^{commit}`]);
      if (new Set(input.checks.map((check) => check.id)).size !== input.checks.length) throw new Error("检查标识不能重复");
      const previous = this.config(project.id);
      if (previous && (previous.targetBranch !== input.targetBranch || previous.commonDir !== info.commonDir)
        && this.store.state.workspaces.some((workspace) => this.item(workspace.itemId).projectId === project.id)) throw new Error("已有需求工作区，不能直接更换仓库或集成分支");
      if (!previous && this.host.items.listByProject(project.id).some((item) => item.taskId && this.host.items.activeRunForTask(item.taskId))) throw new Error("请先停止原工作区中正在运行的需求，再启用编排");
      const checksChanged = !previous || JSON.stringify(previous.checks) !== JSON.stringify(input.checks) || previous.targetBranch !== input.targetBranch;
      const config: WorkflowConfig = {
        ...input, repository: info.repository, commonDir: info.commonDir,
        revision: (previous?.revision ?? 0) + (checksChanged ? 1 : 0), paused: previous?.paused ?? false, updatedAt: now(),
      };
      this.store.state.configs = this.store.state.configs.filter((entry) => entry.projectId !== project.id).concat(config);
      this.store.event(project.id, null, "project.configured", null, `集成分支 ${input.targetBranch}；并发 ${input.concurrency}；检查配置 v${config.revision}。原目录改动不复制到需求工作区。`);
      await this.changed(); this.kick(); return structuredClone(config);
    });
  }
  private assertWritable(id: string): void {
    if (this.store.state.integrations.some((attempt) => attempt.itemId === id && active(attempt))) throw new Error("需求正在集成，请先完成或取消本次集成");
    if (this.store.state.verifications.some((result) => result.itemId === id && ["running", "queued"].includes(result.status))) throw new Error("需求正在验证或等待验证名额，请等待检查结束");
  }
  assertEditable(id: string): void {
    this.assertWritable(id);
    if (this.store.state.tickets.some((ticket) => ticket.itemId === id && ["running", "queued"].includes(ticket.status))) throw new Error("请先结束当前执行，再修改需求范围");
  }
  private assertImplementationScope(item: WorkItem): void {
    this.design.assertReady(item);
    if (!item.description.trim() || !item.acceptanceCriteria.trim()) throw new Error("实施前请完善目标说明与验收标准；可先进行只读讨论。");
  }
  async enqueue(id: string, kind: WorkRunKind, instruction?: string, requestId: string = randomUUID(), imageIds?: string[]): Promise<{ item: WorkItem }> {
    await this.ready;
    return this.lock(`item:${id}`, () => this.enqueueLocked(id, kind, instruction, requestId, imageIds));
  }
  private async enqueueLocked(id: string, kind: WorkRunKind, instruction: string | undefined, requestId: string, imageIds?: string[]): Promise<{ item: WorkItem }> {
      const item = this.item(id);
      this.requireConfig(item.projectId);
      if (item.state !== "open") throw new Error("请先重新打开这个需求");
      if (this.store.state.tickets.some((ticket) => ticket.itemId === id && (ticket.requestId === requestId || ["running", "queued"].includes(ticket.status)))) return { item };
      if (kind !== "discussion") { this.assertImplementationScope(item); this.assertWritable(id); }
      const scope = this.store.scope(item);
      const prd = this.design.prd(id);
      const baseInstruction = instruction ?? workItemPrompt({ ...scope, description: workItemContext(item), feedback: this.host.items.listFeedback(id).filter((entry) => !entry.deliveredAt) });
      const fullInstruction = this.instructionWithDesign(id, baseInstruction);
      const pendingFeedback = this.host.items.listFeedback(id).filter((entry) => !entry.deliveredAt);
      const attachments = [...new Set([...(imageIds ?? []), ...pendingFeedback.flatMap((entry) => entry.imageIds ?? [])])];
      this.store.state.tickets.push({
        id: randomUUID(), requestId, itemId: id, projectId: item.projectId, scopeId: scope.id,
        kind, prdId: prd?.id, instruction: fullInstruction,
        imageIds: attachments, phase: kind === "discussion" ? "discussion" : "implementation", status: "queued", runId: null, integrationId: null, error: null, createdAt: now(),
      });
      this.store.event(item.projectId, id, "run.queued", scope.id, `范围 v${scope.version} 已加入${kind === "discussion" ? "只读讨论" : "实施"}队列。`);
      await this.changed(); this.kick(); return { item };
  }
  private kick(): void {
    if (this.disposed) return;
    this.background(() => this.pump(), "00000000-0000-4000-8000-000000000000", null);
  }
  private used(projectId: string): number {
    return this.store.state.tickets.filter((ticket) => ticket.projectId === projectId && ticket.status === "running").length
      + this.store.state.verifications.filter((result) => result.projectId === projectId && result.status === "running").length
      + (this.reservations.get(projectId) ?? 0);
  }
  private dependenciesMet(id: string, config: WorkflowConfig): boolean {
    return (this.store.state.dependencies[id] ?? []).every((dependency) => this.store.state.integrations.some((attempt) =>
      attempt.itemId === dependency && attempt.status === "merged" && attempt.repositoryKey === this.repoKey(config)));
  }
  private async pump(): Promise<void> {
    if (this.disposed) return;
    if (this.pumping) { this.pumpAgain = true; return; }
    this.pumping = true;
    try {
      for (const item of this.host.items.list()) {
        const ticket = this.store.state.tickets.find((entry) => entry.itemId === item.id && entry.status === "queued");
        if (!ticket) continue;
        const config = this.requireConfig(item.projectId);
        if (config.paused || this.used(item.projectId) >= config.concurrency || (ticket.phase !== "discussion" && !this.dependenciesMet(item.id, config))) continue;
        ticket.status = "running";
        const dependencies = this.store.state.dependencies[item.id] ?? [];
        if (dependencies.length && ticket.phase !== "discussion") {
          const workspace = this.store.state.workspaces.find((entry) => entry.itemId === item.id && !entry.removedAt);
          const cwd = workspace?.path ?? config.repository;
          try {
            const baseline = await git(cwd, ["rev-parse", workspace ? "HEAD" : `refs/heads/${config.targetBranch}`]);
            for (const dependency of dependencies) {
              const merged = this.store.state.integrations.filter((entry) => entry.itemId === dependency && entry.repositoryKey === this.repoKey(config) && entry.status === "merged").at(-1)!;
              await git(cwd, ["merge-base", "--is-ancestor", merged.mergedCommit!, baseline]);
            }
          } catch {
            ticket.status = "queued";
            ticket.error = "当前代码基线不包含前置需求的合入版本，请检查外部 Git 变更或先同步既有工作区。";
            await this.changed(); continue;
          }
        }
        ticket.error = null;
        await this.changed();
        this.background(() => this.launch(ticket), item.projectId, item.id);
      }
    } finally { this.pumping = false; if (this.pumpAgain) { this.pumpAgain = false; this.kick(); } }
  }
  private async workspace(item: WorkItem): Promise<string> {
    const config = this.requireConfig(item.projectId);
    await this.repository(config);
    const existing = this.store.state.workspaces.find((entry) => entry.itemId === item.id);
    if (existing) {
      if (existing.removedAt) throw new Error("工作区已清理；历史交付仍可回放，继续开发请新建需求。");
      const info = await repositoryInfo(existing.path);
      if (info.commonDir !== config.commonDir || info.branch !== existing.branch) throw new Error("需求工作区身份或分支被外部修改，请检查现场");
      return existing.path;
    }
    const baseline = await git(config.repository, ["rev-parse", `refs/heads/${config.targetBranch}`]);
    const cwd = path.join(this.host.dataDir, "worktrees", item.id);
    const branch = `qingzhou/requirement/${item.id}`;
    // Journal intent before Git side effects, allowing interrupted creation to be inspected.
    this.store.state.workspaces.push({ itemId: item.id, path: cwd, branch, baseline, originalPath: item.cwd, createdAt: now(), removedAt: null });
    await this.changed();
    await mkdir(path.dirname(cwd), { recursive: true });
    await git(config.repository, ["worktree", "add", "-b", branch, cwd, baseline]);
    this.store.event(item.projectId, item.id, "workspace.created", null, `独立工作区已建立，基线 ${baseline.slice(0, 8)}；原目录未提交改动未复制。`);
    await this.changed(); return cwd;
  }
  private async launch(ticket: WorkflowTicket): Promise<void> {
    try {
      const item = this.item(ticket.itemId);
      if (ticket.phase === "implementation") this.assertImplementationScope(item);
      const attempt = ticket.integrationId ? this.attempt(ticket.integrationId) : null;
      const cwd = attempt?.workspace ?? await this.workspace(item);
      if (ticket.status !== "running" || this.disposed) return;
      if (ticket.phase === "implementation") await this.design.materialize(item.id, cwd);
      this.store.event(item.projectId, item.id, "run.started", ticket.id, ticket.phase === "integration" ? "在原需求对话中处理集成候选。" : ticket.phase === "discussion" ? "开始只读讨论，尚未启动实施。" : "开始实施已固定范围的需求。");
      await this.changed();
      await this.host.launch(item.id, cwd, ticket.kind, ticket.instruction, ticket.imageIds);
      ticket.runId = this.item(item.id).latestRunId;
      await this.changed();
    } catch (error) {
      ticket.status = "failed"; ticket.error = errorText(error);
      this.store.event(ticket.projectId, ticket.itemId, "run.failed", ticket.id, ticket.error);
      await this.changed(); this.kick();
    }
  }
  async settled(itemId: string, success: boolean): Promise<void> {
    await this.ready;
    return this.lock(`item:${itemId}`, async () => {
    const ticket = this.store.state.tickets.find((entry) => entry.itemId === itemId && entry.status === "running");
    if (!ticket) return;
    ticket.runId = this.item(itemId).latestRunId;
    ticket.status = success ? "finished" : "failed";
    if (ticket.phase === "implementation" && ticket.prdId) {
      const workspace = this.store.state.workspaces.find((entry) => entry.itemId === itemId && !entry.removedAt);
      if (workspace) {
        try { await this.design.importFile(itemId, workspace.path); }
        catch (error) { this.store.event(ticket.projectId, itemId, "prd.sync.failed", ticket.prdId, errorText(error)); }
      }
    }
    await this.host.release?.(itemId);
    this.store.event(ticket.projectId, itemId, success ? "run.finished" : "run.failed", ticket.id,
      success ? ticket.phase === "discussion" ? "只读讨论结束，完善范围与验收标准后可开始实施。" : "本轮执行结束；封存改动并运行项目检查后形成可验收交付。" : "执行失败或停止，现场已保留。");
    await this.changed(); this.kick();
    if (success && ticket.integrationId) await this.recheck(ticket.integrationId);
    });
  }
  async captureTranscript(itemId: string, runId: string, messages: TimelineMessage[], tools: ToolExecution[]): Promise<void> {
    await this.ready;
    if (!this.store.state.workspaces.some((entry) => entry.itemId === itemId)) return;
    const directory = path.join(this.host.dataDir, "workflow-transcripts");
    await mkdir(directory, { recursive: true });
    const redact = (value: unknown): unknown => {
      if (typeof value === "string") return redactWorkflowLog(value);
      if (Array.isArray(value)) return value.map(redact);
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, /^(?:api[_-]?key|token|password|secret|authorization)$/i.test(key) ? "[已隐藏]" : redact(child)]));
      return value;
    };
    try {
      const file = await open(path.join(directory, `${runId}.json`), "wx", 0o600);
      try { await file.writeFile(JSON.stringify(redact({ runId, itemId, capturedAt: now(), messages, tools }))); await file.sync(); }
      finally { await file.close(); }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    if (!this.store.state.events.some((event) => event.type === "conversation.captured" && event.subjectId === runId)) {
      this.store.event(this.item(itemId).projectId, itemId, "conversation.captured", runId, "已保存本轮对话与工具记录，可只读回放，无需启动 Agent。");
      await this.changed();
    }
  }
  async stop(id: string, onlyQueued = false): Promise<void> {
    await this.ready;
    for (const ticket of this.store.state.tickets) if (ticket.itemId === id && (ticket.status === "queued" || (!onlyQueued && ticket.status === "running"))) ticket.status = "cancelled";
    await this.changed(); this.kick();
  }
  async dependencies(id: string, dependencies: string[]): Promise<{ ok: true }> {
    const item = this.item(id);
    this.assertEditable(id);
    const unique = [...new Set(dependencies)];
    for (const dependency of unique) if (this.item(dependency).projectId !== item.projectId) throw new Error("前置需求必须属于同一项目");
    const graph = { ...this.store.state.dependencies, [id]: unique };
    const visit = (node: string, pathIds: Set<string>): void => {
      if (pathIds.has(node)) throw new Error("需求依赖不能形成循环");
      for (const child of graph[node] ?? []) visit(child, new Set([...pathIds, node]));
    };
    visit(id, new Set());
    this.store.state.dependencies[id] = unique;
    this.store.event(item.projectId, id, "dependencies.updated", null, unique.length ? "前置需求合入后才能启动。" : "已移除前置依赖。");
    await this.changed(); this.kick(); return { ok: true };
  }
  async changes(id: string): Promise<{ paths: string[]; committedPaths: string[]; head: string; baseline: string; cwd: string }> {
    const item = this.item(id);
    const workspace = this.store.state.workspaces.find((entry) => entry.itemId === id && !entry.removedAt);
    if (!workspace) throw new Error("需求尚未创建独立工作区");
    const baseline = this.store.state.deliveries.filter((delivery) => delivery.itemId === id).at(-1)?.commit ?? workspace.baseline;
    const committedPaths = (await git(workspace.path, ["diff", "--name-only", "-z", baseline, "HEAD"])).split("\0").filter(Boolean);
    const paths = [...new Set([...committedPaths, ...await changedPaths(workspace.path)])];
    if (!this.config(item.projectId)) throw new Error("项目编排未配置");
    return { paths, committedPaths, head: await git(workspace.path, ["rev-parse", "HEAD"]), baseline, cwd: workspace.path };
  }
  async seal(id: string, paths: string[], summary: string, requestId: string, review?: Delivery["review"]): Promise<{ delivery: Delivery }> {
    return this.lock(`item:${id}`, async () => {
      const item = this.item(id);
      const config = this.requireConfig(item.projectId);
      const duplicate = this.store.state.events.find((event) => event.type === "delivery.request" && event.itemId === id && event.message === requestId);
      const previous = duplicate && this.store.state.deliveries.find((entry) => entry.id === duplicate.subjectId);
      if (previous) return { delivery: structuredClone(previous) };
      this.assertEditable(id);
      if (item.state !== "open") throw new Error("请先重新打开需求");
      if (this.used(item.projectId) >= config.concurrency) throw new Error("项目执行名额已满，请等待后封存验证，或暂停后续队列");
      this.reservations.set(item.projectId, (this.reservations.get(item.projectId) ?? 0) + 1);
      let reservationHeld = true;
      try {
      const ticket = this.store.state.tickets.filter((entry) => entry.itemId === id && entry.phase === "implementation").at(-1);
      const scope = this.store.scope(item);
      const prd = this.design.assertReady(item);
      if (prd && ticket?.prdId !== prd.id) throw new Error("PRD 已调整，请按当前确认的版本实施后重新封存");
      if (!ticket || ticket.scopeId !== scope.id) throw new Error("当前范围尚未执行，请先开始本轮需求");
      const changes = await this.changes(id);
      await this.design.assertFileCurrent(id, changes.cwd);
      const selected = new Set(paths.map(safeWorkflowPath));
      if (prd && !selected.has(requirementDesignPath(id)) && !(await git(changes.cwd, ["ls-files", "--", requirementDesignPath(id)]))) throw new Error("PRD 设计文件未纳入交付；请检查 Git 忽略规则，刷新并确认设计文件后重新封存");
      if (changes.paths.some((file) => !selected.has(file)) || [...selected].some((file) => !changes.paths.includes(file))) throw new Error("交付文件已变化，请刷新并明确选择本次全部改动；来源不明的文件请先处理");
      if ((await git(changes.cwd, ["diff", "--name-only", "--diff-filter=U"])).trim()) throw new Error("仍有未解决的冲突");
      // A deletion already staged by git revert has no remaining pathspec to add.
      const unstaged = (await git(changes.cwd, ["diff", "--name-only", "-z"])).split("\0").filter(Boolean);
      const untracked = (await git(changes.cwd, ["ls-files", "--others", "--exclude-standard", "-z"])).split("\0").filter(Boolean);
      const toStage = [...new Set([...unstaged, ...untracked])];
      if (toStage.some((file) => !selected.has(file))) throw new Error("封存期间发现额外改动，请刷新文件列表后重新确认");
      if (toStage.length) await git(changes.cwd, ["add", "-A", "--", ...toStage]);
      await git(changes.cwd, ["commit", "--allow-empty", "-m", `feat: deliver requirement ${item.id}`]);
      const actualPaths = (await git(changes.cwd, ["diff", "--name-only", "-z", changes.baseline, "HEAD"])).split("\0").filter(Boolean);
      if (actualPaths.some((file) => !selected.has(file))) throw new Error("封存期间出现未确认文件，未生成有效交付；请重新核对工作区");
      const commit = await git(changes.cwd, ["rev-parse", "HEAD"]);
      const tree = await git(changes.cwd, ["rev-parse", "HEAD^{tree}"]);
      if (prd) {
        const document = workspaceDesignSchema.parse(JSON.parse(await git(changes.cwd, ["show", `${commit}:${requirementDesignPath(id)}`])));
        if (document.prdId !== prd.id || document.content !== prd.content || JSON.stringify(document.moduleChanges) !== JSON.stringify(prd.moduleChanges)) throw new Error("封存的 PRD 与确认版本不一致，请重新核对工作区");
      }
      if (review) for (const file of review.artifactPaths) await workflowArtifact(changes.cwd, commit, safeWorkflowPath(file));
      const deliveryId = randomUUID();
      await git(changes.cwd, ["update-ref", `refs/qingzhou/deliveries/${deliveryId}`, commit]);
      const workspace = this.store.state.workspaces.find((entry) => entry.itemId === id)!;
      const files = (await git(changes.cwd, ["diff", "--name-only", "-z", workspace.baseline, commit])).split("\0").filter(Boolean);
      const patch = await git(changes.cwd, ["diff", "--no-ext-diff", "--no-textconv", workspace.baseline, commit]);
      const verification = this.newVerification(config, id, deliveryId, "delivery", commit, tree);
      const delivery: Delivery = {
        id: deliveryId, itemId: id, scopeId: scope.id, prdId: prd?.id, runId: ticket.runId, ticketId: ticket.id, commit, tree,
        baseline: workspace.baseline, files, patch, review,
        summary: summary || this.host.items.getDetails(id)?.runs.find((run) => run.id === ticket.runId)?.resultSummary || "需求交付", verificationId: verification.id, createdAt: now(),
      };
      this.store.state.deliveries.push(delivery);
      this.store.event(item.projectId, id, "delivery.request", delivery.id, requestId);
      this.store.event(item.projectId, id, "delivery.created", delivery.id, "交付已封存；验证结果独立记录，历史验收不沿用。" );
      await this.changed();
      this.reservations.set(item.projectId, (this.reservations.get(item.projectId) ?? 1) - 1);
      reservationHeld = false;
      this.background(async () => { await this.runChecks(verification, config, changes.cwd); this.kick(); }, item.projectId, id);
      return { delivery: structuredClone(delivery) };
      } finally {
        // The reservation is held only through snapshot creation, then the verification owns the slot.
        const reserved = this.reservations.get(item.projectId) ?? 0;
        if (reservationHeld) this.reservations.set(item.projectId, Math.max(0, reserved - 1));
        for (const wake of this.slotWaiters) wake(); this.slotWaiters.clear();
      }
    });
  }
  private newVerification(config: WorkflowConfig, itemId: string | null, subjectId: string, phase: Verification["phase"], commit: string, tree: string): Verification {
    const verification: Verification = {
      id: randomUUID(), projectId: config.projectId, itemId, subjectId, phase, commit, tree,
      configRevision: config.revision, environment: `${os.platform()} ${os.arch()} · Node ${process.versions.node}`,
      status: "queued", startedAt: now(), finishedAt: null, checks: [], error: null,
    };
    this.store.state.verifications.push(verification); return verification;
  }
  private async runChecks(result: Verification, config: WorkflowConfig, cwd: string): Promise<void> {
    try {
      while (!this.disposed && this.used(config.projectId) >= this.requireConfig(config.projectId).concurrency) {
        await new Promise<void>((resolve) => this.slotWaiters.add(resolve));
      }
      if (this.disposed) throw new Error("应用退出，验证中断");
      result.status = "running";
      result.startedAt = now();
      await this.changed();
      if ((await changedPaths(cwd)).length) throw new Error("验证前代码树存在未封存改动");
      // Preserve this exact configuration even if the project is edited during checks.
      const checks = structuredClone(config.checks);
      await mkdir(path.join(this.host.dataDir, "check-env", result.id), { recursive: true });
      for (const check of checks) {
        if (this.disposed) throw new Error("应用退出，验证中断");
        const run = async () => {
          this.resourceWaits.delete(result.id);
          const entry: Verification["checks"][number] = {
            id: check.id, name: check.name, command: check.command, required: check.required, cwd,
            startedAt: now(), finishedAt: null, exitCode: null, status: "running", output: "", truncated: false,
          };
          result.checks.push(entry); await this.changed();
          const commandResult = await this.command(check.command, cwd, check.timeoutMs, result.id);
          Object.assign(entry, commandResult, { status: commandResult.exitCode === 0 ? "passed" : "failed", finishedAt: now() });
          await this.changed();
        };
        if (check.resource) {
          if (this.resourceLocks.has(`resource:${check.resource}`)) { this.resourceWaits.set(result.id, check.resource); await this.changed(); }
          await this.lock(`resource:${check.resource}`, run, this.resourceLocks);
        } else await run();
      }
      if (await git(cwd, ["rev-parse", "HEAD"]) !== result.commit || await git(cwd, ["rev-parse", "HEAD^{tree}"]) !== result.tree || (await changedPaths(cwd)).length) throw new Error("检查期间代码或文件发生变化，本次证据失效；请重新封存验证");
      if (this.disposed) throw new Error("应用退出，验证中断");
      const required = result.checks.filter((check) => check.required);
      result.status = !required.length ? "unverified" : required.every((check) => check.status === "passed") ? "passed" : "failed";
    } catch (error) { result.status = this.disposed ? "interrupted" : "failed"; result.error = errorText(error); }
    result.finishedAt = now();
    this.store.event(config.projectId, result.itemId, "verification.finished", result.id,
      result.status === "passed" ? (result.checks.some((check) => check.status !== "passed") ? "必需检查通过；有非必需检查异常。" : "必需检查通过。") : result.error || (result.status === "unverified" ? "未配置必需检查，不能视为已验证。" : "必需检查失败，请查看日志。"));
    await this.changed();
    this.kick();
  }
  private command(command: string, cwd: string, timeoutMs: number, verificationId: string): Promise<{ exitCode: number | null; output: string; truncated: boolean }> {
    return new Promise((resolve) => {
      const child = spawn(command, [], { cwd, shell: true, detached: process.platform !== "win32", windowsHide: true,
        env: { ...process.env, QINGZHOU_VERIFICATION_ID: verificationId, QINGZHOU_WORKSPACE: cwd,
          TMPDIR: path.join(this.host.dataDir, "check-env", verificationId),
          TMP: path.join(this.host.dataDir, "check-env", verificationId), TEMP: path.join(this.host.dataDir, "check-env", verificationId) } });
      this.children.add(child);
      let output = ""; let truncated = false; let timedOut = false;
      const append = (value: Buffer | string) => { const text = String(value); const remaining = 256_000 - output.length; if (text.length > remaining) truncated = true; if (remaining > 0) output += text.slice(0, remaining); };
      child.stdout?.on("data", append); child.stderr?.on("data", append);
      child.once("error", (error) => append(error.message));
      const timer = setTimeout(() => { timedOut = true; this.kill(child); }, timeoutMs);
      child.once("close", (code) => {
        clearTimeout(timer); this.children.delete(child);
        resolve({ exitCode: timedOut ? null : code, output: redactWorkflowLog(output + (timedOut ? "\n检查超时，进程已停止。" : "")), truncated });
      });
    });
  }
  private kill(child: ReturnType<typeof spawn>): void {
    try {
      if (process.platform === "win32") { const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }); killer.on("error", () => child.kill()); }
      else if (child.pid) process.kill(-child.pid, "SIGKILL");
    } catch { child.kill("SIGKILL"); }
  }
  private delivery(id: string): Delivery {
    const delivery = this.store.state.deliveries.find((entry) => entry.id === id);
    if (!delivery) throw new Error("找不到这个交付版本"); return delivery;
  }
  private async currentDelivery(delivery: Delivery): Promise<void> {
    this.design.assertDelivery(delivery);
    const item = this.item(delivery.itemId);
    if (this.store.scope(item).id !== delivery.scopeId) throw new Error("需求范围已变化，请执行并验收当前范围");
    if (this.store.state.deliveries.filter((entry) => entry.itemId === item.id).at(-1)?.id !== delivery.id) throw new Error("当前已有新交付，请选择最新版本");
    if (this.store.state.tickets.filter((entry) => entry.itemId === item.id && entry.phase === "implementation").at(-1)?.id !== delivery.ticketId) throw new Error("已有新的实施轮次，请封存当前轮次后重新验收");
    const workspace = this.store.state.workspaces.find((entry) => entry.itemId === item.id);
    if (!workspace || workspace.removedAt) throw new Error("源工作区不可用");
    const info = await repositoryInfo(workspace.path);
    const config = this.requireConfig(item.projectId);
    if (info.commonDir !== config.commonDir || info.branch !== workspace.branch || info.head !== delivery.commit || info.dirty.length) throw new Error("源交付工作区已变化，请重新封存、验证和验收");
    if (!verificationIsValid(this.store.state.verifications.find((entry) => entry.id === delivery.verificationId), config, delivery.tree)) throw new Error("当前交付缺少有效的必需检查证据");
  }
  async accept(id: string, decision: "accepted" | "rejected", note = "", evidence?: DeliveryAcceptance["evidence"]): Promise<{ ok: true }> {
    const delivery = this.delivery(id);
    return this.lock(`item:${delivery.itemId}`, async () => {
      this.assertEditable(delivery.itemId);
      if (this.design.prd(delivery.itemId)?.frozenAt) {
        if (decision === "accepted" && this.design.prd(delivery.itemId)?.deliveryId === id) return { ok: true };
        this.design.assertMutable(delivery.itemId);
      }
      if (decision === "accepted") {
        await this.currentDelivery(delivery);
        if (evidence) {
          const criteria = this.store.state.scopes.find((scope) => scope.id === delivery.scopeId)?.acceptanceCriteria.split("\n").map((line) => line.trim()).filter(Boolean) ?? [];
          if (evidence.length !== criteria.length || criteria.some((criterion, index) => evidence[index]?.criterion !== criterion || !evidence[index]?.note.trim())) throw new Error("请逐条记录人工验收依据");
          const checks = this.store.state.verifications.find((result) => result.id === delivery.verificationId)?.checks ?? [];
          if (evidence.some((row) => row.checkIds.some((id) => !checks.some((check) => check.id === id)) || row.artifactPaths.some((file) => !delivery.review?.artifactPaths.includes(file)))) throw new Error("验收引用了本交付之外的证据");
        }
      }
      const previous = this.store.state.acceptances.filter((entry) => entry.deliveryId === id).at(-1);
      if (previous?.decision === decision && previous.note === note) return { ok: true };
      if (decision === "accepted") this.design.finalize(delivery);
      const record = { id: randomUUID(), itemId: delivery.itemId, deliveryId: id, scopeId: delivery.scopeId, decision, note, evidence, createdAt: now() };
      this.store.state.acceptances.push(record);
      this.store.event(this.item(delivery.itemId).projectId, delivery.itemId, `delivery.${decision}`, record.id,
        decision === "accepted" ? "已验收这个交付版本，尚未合入主线。" : `需要返工：${note}`);
      await this.changed(); return { ok: true };
    });
  }
  private accepted(delivery: Delivery): boolean { return this.store.state.acceptances.filter((entry) => entry.deliveryId === delivery.id).at(-1)?.decision === "accepted"; }
  private repoKey(config: WorkflowConfig): string { return `${config.commonDir}\0refs/heads/${config.targetBranch}`; }
  private attempt(id: string): IntegrationAttempt {
    const attempt = this.store.state.integrations.find((entry) => entry.id === id);
    if (!attempt) throw new Error("找不到这次集成"); return attempt;
  }
  async integrate(deliveryId: string, requestId: string): Promise<{ attempt: IntegrationAttempt }> {
    const delivery = this.delivery(deliveryId);
    return this.lock(`item:${delivery.itemId}`, async () => {
      const duplicate = this.store.state.integrations.find((entry) => entry.deliveryId === deliveryId && (entry.requestId === requestId || active(entry) || entry.status === "merged"));
      if (duplicate) return { attempt: structuredClone(duplicate) };
      this.assertEditable(delivery.itemId);
      await this.currentDelivery(delivery);
      if (!this.accepted(delivery)) throw new Error("请先验收这个交付版本");
      const item = this.item(delivery.itemId);
      if (item.state === "archived") throw new Error("请先恢复已归档需求");
      const config = this.requireConfig(item.projectId);
      const attempt: IntegrationAttempt = {
        id: randomUUID(), requestId, projectId: item.projectId, itemId: item.id, deliveryId,
        repositoryKey: this.repoKey(config), targetBranch: config.targetBranch, status: "queued",
        baseline: null, candidate: null, tree: null, workspace: null, verificationId: null,
        conflicts: [], patch: "", error: null, mergedCommit: null, createdAt: now(), updatedAt: now(),
      };
      this.store.state.integrations.push(attempt);
      this.store.event(item.projectId, item.id, "integration.queued", attempt.id, "已加入集成队列；不会自动合入。" );
      await this.changed(); this.kickIntegrations(); return { attempt: structuredClone(attempt) };
    });
  }
  private kickIntegrations(): void {
    this.background(async () => {
      if (this.integrationPumping) { this.integrationPumpAgain = true; return; }
      this.integrationPumping = true;
      try {
        for (const attempt of this.store.state.integrations) {
          if (attempt.status !== "queued" || this.store.state.integrations.some((entry) => entry.id !== attempt.id && entry.repositoryKey === attempt.repositoryKey && active(entry) && entry.status !== "queued")) continue;
          attempt.status = "preparing"; attempt.updatedAt = now(); await this.changed();
          this.background(() => this.prepare(attempt), attempt.projectId, attempt.itemId);
        }
      } finally { this.integrationPumping = false; if (this.integrationPumpAgain) { this.integrationPumpAgain = false; this.kickIntegrations(); } }
    }, "00000000-0000-4000-8000-000000000000", null);
  }
  private async prepare(attempt: IntegrationAttempt): Promise<void> {
    try {
      const config = this.requireConfig(attempt.projectId);
      await this.repository(config);
      await this.currentDelivery(this.delivery(attempt.deliveryId));
      attempt.baseline = await git(config.repository, ["rev-parse", `refs/heads/${config.targetBranch}`]);
      attempt.workspace = path.join(this.host.dataDir, "integrations", attempt.id);
      await this.changed(); await mkdir(path.dirname(attempt.workspace), { recursive: true });
      await git(config.repository, ["worktree", "add", "--detach", attempt.workspace, attempt.baseline]);
      try { await git(attempt.workspace, ["merge", "--no-ff", "--no-edit", this.delivery(attempt.deliveryId).commit]); }
      catch (error) {
        attempt.conflicts = (await git(attempt.workspace, ["diff", "--name-only", "--diff-filter=U", "-z"])).split("\0").filter(Boolean);
        if (!attempt.conflicts.length) throw error;
        attempt.status = "conflicts"; attempt.error = "存在合并冲突；在集成工作区处理，原交付和主线保留。";
        this.store.event(attempt.projectId, attempt.itemId, "integration.conflicts", attempt.id, attempt.error);
        await this.changed(); return;
      }
      await this.verifyCandidate(attempt);
    } catch (error) { attempt.status = "failed"; attempt.error = errorText(error); await this.changed(); this.kickIntegrations(); }
  }
  private async verifyCandidate(attempt: IntegrationAttempt): Promise<void> {
    try {
    const config = this.requireConfig(attempt.projectId);
    if (!attempt.workspace) throw new Error("缺少集成工作区");
    attempt.candidate = await git(attempt.workspace, ["rev-parse", "HEAD"]);
    attempt.tree = await git(attempt.workspace, ["rev-parse", "HEAD^{tree}"]);
    await git(attempt.workspace, ["update-ref", `refs/qingzhou/integrations/${attempt.id}`, attempt.candidate]);
    attempt.patch = await git(attempt.workspace, ["diff", "--no-ext-diff", "--no-textconv", this.delivery(attempt.deliveryId).commit, attempt.candidate]);
    const verification = this.newVerification(config, attempt.itemId, attempt.id, "integration", attempt.candidate, attempt.tree);
    attempt.verificationId = verification.id; attempt.status = "verifying"; attempt.error = null;
    await this.changed(); await this.runChecks(verification, config, attempt.workspace);
    const target = await git(config.repository, ["rev-parse", `refs/heads/${config.targetBranch}`]);
    attempt.status = target !== attempt.baseline ? "stale" : verificationIsValid(verification, config, attempt.tree) ? "ready" : "failed";
    attempt.error = attempt.status === "stale" ? "主线已变化，请重新准备和验证候选。" : attempt.status === "failed" ? verification.error || "集成回归未通过，主线未改变。" : null;
    attempt.updatedAt = now();
    this.store.event(attempt.projectId, attempt.itemId, `integration.${attempt.status}`, attempt.id,
      attempt.error || "组合后的候选已验证，等待用户确认最终合入。" );
    await this.changed(); if (attempt.status !== "ready") this.kickIntegrations();
    } catch (error) {
      attempt.status = "failed"; attempt.error = errorText(error); attempt.updatedAt = now();
      const verification = this.store.state.verifications.find((entry) => entry.id === attempt.verificationId);
      if (verification && ["queued", "running"].includes(verification.status)) {
        verification.status = "failed"; verification.error = attempt.error; verification.finishedAt = now();
      }
      this.store.event(attempt.projectId, attempt.itemId, "integration.failed", attempt.id, attempt.error);
      await this.changed(); this.kickIntegrations();
    }
  }
  async recheck(id: string): Promise<{ attempt: IntegrationAttempt }> {
    return this.lock(`integration:${id}`, async () => {
      const attempt = this.attempt(id);
      if (!["conflicts", "failed", "ready"].includes(attempt.status) || !attempt.workspace) throw new Error("当前集成不能重新验证，请重新准备");
      if (this.store.state.tickets.some((ticket) => ticket.integrationId === id && ["queued", "running"].includes(ticket.status))) throw new Error("Agent 正在处理候选");
      if (this.store.state.integrations.some((entry) => entry.id !== id && entry.repositoryKey === attempt.repositoryKey && active(entry) && entry.status !== "queued")) throw new Error("该主线有其他活动集成，请先完成或取消它");
      const config = this.requireConfig(attempt.projectId);
      await this.currentDelivery(this.delivery(attempt.deliveryId));
      if (await git(config.repository, ["rev-parse", `refs/heads/${config.targetBranch}`]) !== attempt.baseline) {
        attempt.status = "stale"; attempt.error = "主线已变化，请重新准备。"; await this.changed(); return { attempt: structuredClone(attempt) };
      }
      const conflicts = await git(attempt.workspace, ["diff", "--name-only", "--diff-filter=U"]);
      if (conflicts) throw new Error(`仍有未解决的冲突：${conflicts}`);
      const merging = await git(attempt.workspace, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]).catch(() => "");
      if (merging || (await changedPaths(attempt.workspace)).length) {
        await git(attempt.workspace, ["add", "-A"]);
        await git(attempt.workspace, ["commit", "-m", `fix: resolve integration ${id}`]);
      }
      attempt.conflicts = []; attempt.status = "verifying"; await this.changed();
      this.background(() => this.verifyCandidate(attempt), attempt.projectId, attempt.itemId);
      return { attempt: structuredClone(attempt) };
    });
  }
  async repair(id: string, instruction: string): Promise<{ ok: true }> {
    return this.lock(`integration:${id}`, async () => {
      const attempt = this.attempt(id);
      if (!["conflicts", "failed", "ready"].includes(attempt.status) || !attempt.workspace) throw new Error("当前没有可处理的集成候选");
      if (this.store.state.tickets.some((entry) => entry.itemId === attempt.itemId && ["running", "queued"].includes(entry.status))) return { ok: true };
      if (this.store.state.integrations.some((entry) => entry.id !== id && entry.repositoryKey === attempt.repositoryKey && active(entry) && entry.status !== "queued")) throw new Error("请先完成当前主线的其他集成");
      const item = this.item(attempt.itemId);
      const delivery = this.delivery(attempt.deliveryId);
      const scope = this.store.state.scopes.find((entry) => entry.id === delivery.scopeId)!;
      const verification = this.store.state.verifications.find((entry) => entry.id === attempt.verificationId);
      attempt.status = "conflicts";
      this.store.state.tickets.push({
        id: randomUUID(), requestId: randomUUID(), itemId: item.id, projectId: item.projectId, scopeId: scope.id,
        kind: "feedback", phase: "integration", status: "queued", runId: null, integrationId: id, error: null, createdAt: now(),
        instruction: `【集成处理阶段】继续同一需求对话，仅在当前集成工作区处理候选；不要修改源交付或主线，不要推送。\n${workItemPrompt(scope)}\n目标基线：${attempt.baseline}\n源交付：${delivery.commit}\n冲突：${attempt.conflicts.join("、")}\n失败检查：${verification?.checks.filter((check) => check.status !== "passed").map((check) => `${check.name}\n${check.output}`).join("\n").slice(-12000) || "无"}\n用户补充：${instruction || "解决冲突并修复回归，遇到产品语义取舍请提问；候选最终仍需用户确认。"}`,
      });
      this.store.event(item.projectId, item.id, "integration.repair", id, "已授权在原需求对话中处理隔离集成候选。" );
      await this.changed(); this.kick(); return { ok: true };
    });
  }
  async merge(id: string): Promise<{ attempt: IntegrationAttempt }> {
    const attempt = this.attempt(id);
    return this.lock(`integration:${id}`, () => this.lock(`repository:${attempt.repositoryKey}`, () => this.lock(`project:${attempt.projectId}`, async () => {
      if (attempt.status === "merged") return { attempt: structuredClone(attempt) };
      if (attempt.status !== "ready" || !attempt.candidate || !attempt.tree || !attempt.baseline || !attempt.workspace) throw new Error("候选尚未完成有效验证");
      const config = this.requireConfig(attempt.projectId);
      await this.repository(config);
      const delivery = this.delivery(attempt.deliveryId);
      await this.currentDelivery(delivery);
      if (!this.accepted(delivery)) throw new Error("交付尚未验收");
      if (!verificationIsValid(this.store.state.verifications.find((entry) => entry.id === attempt.verificationId), config, attempt.tree)) throw new Error("候选验证已失效，请重新验证");
      if ((await changedPaths(attempt.workspace)).length || await git(attempt.workspace, ["rev-parse", "HEAD"]) !== attempt.candidate) throw new Error("集成候选被修改，请重新验证");
      const info = await repositoryInfo(config.repository);
      if (info.branch !== config.targetBranch) throw new Error("原项目目录未检出集成分支，请先在 Git 中切换后再合入");
      if (info.dirty.length) throw new Error(`原项目目录有未提交改动，合入已停止：${info.dirty.join("、")}`);
      if (info.head !== attempt.baseline) { attempt.status = "stale"; attempt.error = "主线已变化，过期候选不会合入，请重新准备。"; await this.changed(); this.kickIntegrations(); throw new Error(attempt.error); }
      attempt.status = "merging"; attempt.updatedAt = now(); await this.changed();
      try {
        // Verify source and CAS target in one Git reference transaction, including external writers.
        const source = this.store.state.workspaces.find((entry) => entry.itemId === attempt.itemId)!;
        await git(config.repository, ["update-ref", "-m", `qingzhou integrate ${attempt.id}`, "--stdin"],
          `start\nverify refs/heads/${source.branch} ${delivery.commit}\nverify refs/qingzhou/integrations/${attempt.id} ${attempt.candidate}\nupdate refs/heads/${config.targetBranch} ${attempt.candidate} ${attempt.baseline}\nprepare\ncommit\n`);
      } catch (error) { attempt.status = "stale"; attempt.error = errorText(error); await this.changed(); this.kickIntegrations(); throw error; }
      // read-tree refuses to overwrite unstaged/untracked changes. A crash here is reconciled on restart.
      await this.syncCheckedOutTree(config, attempt).catch((error) => { attempt.error = `分支已合入，工作目录同步受阻：${errorText(error)}`; });
      await this.markMerged(attempt);
      await this.changed(); this.kickIntegrations(); this.kick(); return { attempt: structuredClone(attempt) };
    })));
  }
  private async syncCheckedOutTree(config: WorkflowConfig, attempt: IntegrationAttempt): Promise<void> {
    const branch = await git(config.repository, ["branch", "--show-current"]);
    if (branch !== config.targetBranch) throw new Error("主线已合入，但工作目录分支被外部切换；未更改该目录。");
    const indexTree = await git(config.repository, ["write-tree"]);
    if (indexTree === attempt.tree) return;
    const oldTree = await git(config.repository, ["rev-parse", `${attempt.baseline}^{tree}`]);
    if (indexTree !== oldTree) throw new Error("索引已被外部修改，未覆盖；请手动核对 Git 工作目录。");
    await git(config.repository, ["read-tree", "-u", "-m", attempt.baseline!, attempt.candidate!]);
  }
  private async markMerged(attempt: IntegrationAttempt): Promise<void> {
    attempt.status = "merged"; attempt.mergedCommit = attempt.candidate; attempt.updatedAt = now();
    const config = this.requireConfig(attempt.projectId);
    const included = await Promise.all(this.store.state.integrations.filter((entry) => entry.repositoryKey === attempt.repositoryKey && entry.status === "merged" && entry.mergedCommit).map(async (entry) => {
      try { await git(config.repository, ["merge-base", "--is-ancestor", entry.mergedCommit!, attempt.candidate!]); return entry.itemId; }
      catch { return null; }
    }));
    attempt.includedItemIds = [...new Set(included.filter((itemId): itemId is string => !!itemId))];
    const verification = this.store.state.verifications.find((entry) => entry.id === attempt.verificationId);
    if (verification && !this.store.state.verifications.some((entry) => entry.phase === "main" && entry.subjectId === attempt.id)) {
      this.store.state.verifications.push({ ...structuredClone(verification), id: randomUUID(), phase: "main", subjectId: attempt.id });
    }
    this.store.event(attempt.projectId, attempt.itemId, "main.merged", attempt.id, `已合入 ${attempt.targetBranch}：${attempt.candidate?.slice(0, 8)}${attempt.error ? `；${attempt.error}` : ""}`);
  }
  async cancelIntegration(id: string): Promise<{ ok: true }> {
    const attempt = this.attempt(id);
    return this.lock(`integration:${id}`, async () => {
      if (["merged", "merging", "preparing", "verifying"].includes(attempt.status)) throw new Error("当前集成不能取消，请等待正在写入或检查的操作结束");
      if (this.store.state.tickets.some((entry) => entry.integrationId === id && entry.status === "running")) throw new Error("请先停止处理集成的执行轮次");
      attempt.status = "cancelled";
      for (const ticket of this.store.state.tickets) if (ticket.integrationId === id && ticket.status === "queued") ticket.status = "cancelled";
      this.store.event(attempt.projectId, attempt.itemId, "integration.cancelled", id, "集成已取消，工作区和历史证据保留。" );
      await this.changed(); this.kickIntegrations(); return { ok: true };
    });
  }
  async reorderIntegration(id: string, beforeId: string | null): Promise<{ ok: true }> {
    const attempt = this.attempt(id);
    if (attempt.status !== "queued") throw new Error("只能调整尚未开始的集成请求");
    const target = beforeId ? this.attempt(beforeId) : undefined;
    if (target && (target.repositoryKey !== attempt.repositoryKey || target.status !== "queued")) throw new Error("只能在同一主线队列中调整顺序");
    this.store.state.integrations = this.store.state.integrations.filter((entry) => entry.id !== id);
    const index = target ? this.store.state.integrations.findIndex((entry) => entry.id === target.id) : this.store.state.integrations.length;
    this.store.state.integrations.splice(index, 0, attempt); await this.changed(); return { ok: true };
  }
  async verifyMain(projectId: string): Promise<{ verification: Verification }> {
    return this.lock(`main-check:${projectId}`, async () => {
    const config = this.requireConfig(projectId);
    const existing = this.store.state.verifications.find((entry) => entry.projectId === projectId && entry.phase === "main" && ["running", "queued"].includes(entry.status));
    if (existing) return { verification: structuredClone(existing) };
    const commit = await git(config.repository, ["rev-parse", `refs/heads/${config.targetBranch}`]);
    const tree = await git(config.repository, ["rev-parse", `${commit}^{tree}`]);
    const subjectId = randomUUID();
    const verification = this.newVerification(config, null, subjectId, "main", commit, tree);
    await this.changed();
    this.background(async () => {
      const cwd = path.join(this.host.dataDir, "main-checks", verification.id);
      try {
        await mkdir(path.dirname(cwd), { recursive: true });
        await git(config.repository, ["worktree", "add", "--detach", cwd, commit]);
        await this.runChecks(verification, config, cwd);
      } catch (error) { verification.status = "failed"; verification.error = errorText(error); verification.finishedAt = now(); await this.changed(); }
    }, projectId, null);
    return { verification: structuredClone(verification) };
    });
  }
  async cleanup(id: string): Promise<{ ok: true }> {
    return this.lock(`item:${id}`, async () => {
    this.assertEditable(id);
    const workspace = this.store.state.workspaces.find((entry) => entry.itemId === id);
    if (!workspace || workspace.removedAt) return { ok: true };
    const config = this.requireConfig(this.item(id).projectId);
    if ((await changedPaths(workspace.path)).length) throw new Error("工作区有未封存改动，不能清理");
    const head = await git(workspace.path, ["rev-parse", "HEAD"]);
    await git(config.repository, ["merge-base", "--is-ancestor", head, `refs/heads/${config.targetBranch}`]).catch(() => { throw new Error("工作区仍有未合入提交，不能清理"); });
    await this.host.release?.(id);
    await git(config.repository, ["worktree", "remove", workspace.path]);
    workspace.removedAt = now();
    this.store.event(config.projectId, id, "workspace.removed", null, "已清理干净且已合入的工作区；交付、日志与历史保留。" );
    await this.changed(); return { ok: true };
    });
  }
  async revert(integrationId: string, requestId: string): Promise<{ item: WorkItem }> {
    return this.lock(`revert:${integrationId}`, async () => {
      const existing = this.store.state.events.find((event) => event.type === "revert.request" && event.subjectId === integrationId && event.message === requestId);
      if (existing?.itemId) return { item: this.item(existing.itemId) };
      const attempt = this.attempt(integrationId);
      if (attempt.status !== "merged" || !attempt.mergedCommit) throw new Error("只能通过新需求撤销已合入的版本");
      const project = this.host.items.getProject(attempt.projectId)!;
      const original = this.item(attempt.itemId);
      const item = await this.host.items.create({ projectId: project.id, cwd: project.cwd,
        source: { integrationId }, title: `撤销：${original.title}`.slice(0, 200), description: `通过新的提交撤销集成 ${attempt.mergedCommit}，保留其后的主线历史。`,
        acceptanceCriteria: "确认指定需求的效果已撤销\n保留其他已合入需求的行为\n项目必需检查通过", });
      this.store.scope(item);
      this.store.event(project.id, item.id, "revert.request", integrationId, requestId);
      await this.store.save();
      await this.lock(`item:${item.id}`, async () => {
        const cwd = await this.workspace(item);
        try { await git(cwd, ["revert", "--no-commit", "-m", "1", attempt.mergedCommit!]); }
        catch (error) {
          if (!(await git(cwd, ["diff", "--name-only", "--diff-filter=U"]))) throw error;
          this.store.event(project.id, item.id, "revert.conflicts", integrationId, "撤销候选有冲突，请在新需求中处理；主线保留。");
        }
      });
      this.store.event(project.id, item.id, "revert.prepared", integrationId, "撤销改动已准备在新需求工作区；仍需实施、验证、验收和合入。" );
      await this.changed(); return { item: this.item(item.id) };
    });
  }
}
