import path from "node:path";
import { workItemContext } from "./work-item-context.js";
import {
  workItemFeedbackPrompt,
  workItemIsClosed,
  workItemPrompt,
  workLinkedPromptError,
  workLinkedSessionRewriteError,
  type ServerEvent,
  type TaskRecord,
  type WorkItem,
  type WorkItemColumn,
  type WorkRunKind,
  type WorkRunStatus,
} from "@qingzhou/protocol";
import { isBusyStatus } from "../pi/state-machine.js";
import { assertAllowedCwd } from "../security/path-policy.js";
import { humanizeUserFacingError } from "../setup/pi-agent-dir.js";
import type { ProcessSupervisor } from "../pi/process-supervisor.js";
import type { TaskStore } from "./task-store.js";
import type { WorkItemStore } from "./work-item-store.js";
import type { WorkflowService } from "./workflow-service.js";

export type WorkItemControllerHost = {
  workflow?: WorkflowService;
  store: TaskStore;
  workItems: WorkItemStore;
  supervisor: ProcessSupervisor;
  emit: (taskId: string, type: ServerEvent["type"], payload: unknown) => void;
  createTask: (cwd?: string, title?: string, sessionPath?: string) => Promise<{ task: TaskRecord }>;
  activate: (taskId: string) => Promise<{ warm: boolean } | void>;
  abort: (taskId: string) => Promise<{ ok: true }>;
  prompt: (
    taskId: string,
    message: string,
    imageIds: string[] | undefined,
    mode: "prompt" | "steer" | "follow_up",
    options?: { recordedRun?: boolean },
  ) => Promise<{ ok: true }>;
  apply: (taskId: string, event: string, errorMessage?: string) => Promise<TaskRecord>;
  removeQueued: (taskId: string) => void;
  cwdRoots: () => string[];
  adoptAllowedRoot: (cwd: string) => void;
  /** Soft-archive the linked session if it is still visible. No-op when already archived/missing. */
  archiveTask: (taskId: string) => Promise<{ ok: true }>;
  /** Clear archivedAt on the linked session if present. No-op when missing/not archived. */
  restoreTask: (taskId: string) => Promise<{ task: TaskRecord } | { ok: true }>;
};

export class WorkItemController {
  private readonly settling = new Map<string, Promise<void>>();
  private readonly feedbackOperations = new Set<string>();
  constructor(private readonly host: WorkItemControllerHost) {}

  assertWorkLinkedPrompt(
    taskId: string,
    mode: "prompt" | "steer" | "follow_up",
    options?: { recordedRun?: boolean },
  ): void {
    const message = workLinkedPromptError(
      this.host.workItems.findByTaskId(taskId),
      this.host.workItems.activeRunForTask(taskId),
      mode,
      options,
    );
    if (message) throw new Error(message);
  }

  assertWorkSessionNotRewritten(taskId: string): void {
    const message = workLinkedSessionRewriteError(this.host.workItems.findByTaskId(taskId));
    if (message) throw new Error(message);
  }

  emitWorkItems(): {
    items: ReturnType<WorkItemStore["list"]>;
    projects: ReturnType<WorkItemStore["listProjects"]>;
    activeProjectId: string | null;
  } {
    const payload = {
      items: this.host.workItems.list(),
      projects: this.host.workItems.listProjects(),
      activeProjectId: this.host.workItems.getActiveProjectId(),
    };
    this.host.emit("", "workItems.updated", payload);
    return payload;
  }

  async createWorkProject(name: string, cwd: string): Promise<{ project: ReturnType<WorkItemStore["listProjects"]>[number] }> {
    const resolved = await assertAllowedCwd(cwd, this.host.cwdRoots());
    this.host.adoptAllowedRoot(resolved);
    const project = await this.host.workItems.createProject({ name, cwd: resolved });
    this.emitWorkItems();
    return { project };
  }

  async selectWorkProject(id: string): Promise<{ project: ReturnType<WorkItemStore["listProjects"]>[number] }> {
    const project = await this.host.workItems.selectProject(id);
    this.emitWorkItems();
    return { project };
  }

  async createWorkItem(
    title: string,
    description: string | undefined,
    acceptanceCriteria: string | undefined,
    cwd: string | undefined,
    projectId?: string,
    start = false,
    source?: WorkItem["source"],
  ): Promise<{ item: WorkItem }> {
    if (source?.taskId && !this.host.store.get(source.taskId)) throw new Error("来源对话已不存在，请重新选择讨论依据");
    let project = projectId ? this.host.workItems.getProject(projectId) : undefined;
    if (projectId && !project) throw new Error("找不到这个项目");
    if (!project && cwd) {
      const resolved = await assertAllowedCwd(cwd, this.host.cwdRoots());
      this.host.adoptAllowedRoot(resolved);
      project =
        this.host.workItems.findProjectByCwd(resolved) ??
        (await this.host.workItems.createProject({ name: path.basename(resolved) || resolved, cwd: resolved }));
    }
    if (!project) {
      const activeId = this.host.workItems.getActiveProjectId();
      project = activeId ? this.host.workItems.getProject(activeId) : undefined;
    }
    if (!project) throw new Error("请先启动一个项目");
    const resolved = await assertAllowedCwd(project.cwd, this.host.cwdRoots());
    this.host.adoptAllowedRoot(resolved);
    if (start && this.host.workflow?.enabled(project.id)) throw new Error("请先保存需求、确认范围与 PRD，再开始实施");
    if (source?.moduleIds?.some((id) => !this.host.workflow?.store.state.modules?.some((module) => module.id === id && module.projectId === project.id))) throw new Error("来源模块必须属于当前项目");
    if (source?.prdId) {
      const prd = this.host.workflow?.store.state.prds?.find((entry) => entry.id === source.prdId && entry.frozenAt);
      if (!prd || this.host.workItems.get(prd.itemId)?.projectId !== project.id) throw new Error("来源 PRD 必须是当前项目已固化的需求");
    }
    const item = await this.host.workItems.create({
      title,
      source,
      description,
      acceptanceCriteria,
      cwd: resolved,
      projectId: project.id,
    });
    await this.host.workflow?.syncScope(item);
    if (this.host.workflow?.enabled(project.id)) await this.host.workflow.beginPlanning(item.id);
    this.emitWorkItems();
    if (start) return this.startWorkItem(item.id, "initial");
    return { item: this.host.workItems.get(item.id) ?? item };
  }

  async updateWorkItem(
    id: string,
    title?: string,
    description?: string,
    acceptanceCriteria?: string,
  ): Promise<{ item: WorkItem }> {
    const item = this.host.workflow
      ? await this.host.workflow.updateScope(id, { title, description, acceptanceCriteria })
      : await this.host.workItems.update(id, { title, description, acceptanceCriteria });
    this.emitWorkItems();
    return { item };
  }

  workItemDetails(id: string): ReturnType<WorkItemStore["getDetails"]> {
    const details = this.host.workItems.getDetails(id);
    if (!details) throw new Error("找不到这个目标");
    return details;
  }

  async feedbackWorkItem(id: string, text: string, requestId?: string, imageIds?: string[], expectedDeliveryId?: string): Promise<{ item: WorkItem }> {
    const item = this.host.workItems.get(id);
    if (!item) throw new Error("找不到这个目标");
    if (item.taskId) await this.settling.get(item.taskId);
    const instructionText = text.trim() || "请根据附图继续完成当前需求。";
    if (this.host.workflow?.enabled(item.projectId)) return this.host.workflow.feedback(id, instructionText, requestId, imageIds, expectedDeliveryId);
    if (requestId && this.host.workflow?.hasRequest(id, requestId)) return { item };
    if (this.feedbackOperations.has(id)) throw new Error("正在提交这条需求的补充，请稍后重试");
    this.feedbackOperations.add(id);
    try {
    if (workItemIsClosed(item.state)) throw new Error("这个目标已经结束，请先重新打开。");
    if (item.taskId && this.host.workItems.activeRunForTask(item.taskId)) {
      throw new Error("这个目标正在执行，请在完整对话中直接补充。");
    }
    await this.host.workItems.addFeedback(id, instructionText, imageIds);
    this.emitWorkItems();
    return await this.startWorkItem(id, "feedback", workItemFeedbackPrompt({ ...item, description: workItemContext(item) }, instructionText), requestId, imageIds);
    } finally { this.feedbackOperations.delete(id); }
  }

  async discussWorkItem(id: string, text: string, requestId?: string, imageIds?: string[]): Promise<{ item: WorkItem }> {
    const item = this.host.workItems.get(id);
    if (!item) throw new Error("找不到这个需求");
    const instruction = `请讨论并完善需求「${item.title}」的目标、边界和验收标准。当前为只读讨论，不实施、不修改文件。\n当前目标：${workItemContext(item)}\n验收标准：${item.acceptanceCriteria}\n用户问题：${text}`;
    return this.startWorkItem(id, "discussion", instruction, requestId, imageIds);
  }

  async startWorkItem(
    id: string,
    kind: WorkRunKind,
    explicitInstruction?: string,
    requestId?: string,
    imageIds?: string[],
  ): Promise<{ item: WorkItem }> {
    const item = this.host.workItems.get(id);
    if (item?.taskId) await this.settling.get(item.taskId);
    if (item && this.host.workflow?.enabled(item.projectId)) return this.host.workflow.enqueue(id, kind, explicitInstruction, requestId, imageIds);
    // Legacy shared directories remain serial, including duplicate project entries.
    if (item && this.host.workItems.list().some((other) => other.id !== id && other.cwd === item.cwd && other.taskId && this.host.workItems.activeRunForTask(other.taskId))) {
      throw new Error("原工作目录有其他需求正在执行，请等待结束或配置独立工作区");
    }
    return this.launchWorkItem(id, kind, explicitInstruction, undefined, imageIds);
  }

  async launchWorkItem(id: string, kind: WorkRunKind, explicitInstruction?: string, cwd?: string, imageIds?: string[]): Promise<{ item: WorkItem }> {
    const item = this.host.workItems.get(id);
    if (!item) throw new Error("找不到这个目标");
    if (workItemIsClosed(item.state)) throw new Error("这个目标已经结束，请先重新打开。");
    if (item.taskId && this.host.workItems.activeRunForTask(item.taskId)) {
      throw new Error("这个目标已经在执行。");
    }
    let taskId = item.taskId;
    let activateError: string | null = null;
    if (!taskId || !this.host.store.get(taskId) || this.host.store.get(taskId)?.archivedAt) {
      if (taskId && this.host.store.get(taskId)?.archivedAt && cwd) {
        await this.host.restoreTask(taskId);
        await this.host.activate(taskId);
      } else taskId = (await this.host.createTask(cwd ?? item.cwd, item.title)).task.id;
    } else {
      try {
        await this.host.activate(taskId);
      } catch (error) {
        // Record the failed run below, then surface the reason to the client.
        activateError = humanizeUserFacingError(error).trim() || "AI 启动失败";
      }
    }
    const feedback = this.host.workItems.listFeedback(id).filter((entry) => !entry.deliveredAt);
    const instruction =
      explicitInstruction ??
      workItemPrompt({
        title: item.title,
        description: workItemContext(item),
        acceptanceCriteria: item.acceptanceCriteria,
        feedback,
      });
    const policyTask = this.host.store.get(taskId);
    if (policyTask) {
      const next = await this.host.store.upsert({ ...policyTask, mode: kind === "discussion" ? "ask" : "agent", approvalPolicy: kind !== "discussion" && policyTask.mode !== "agent" && policyTask.approvalPolicy === "read_only" ? "ask" : policyTask.approvalPolicy, updatedAt: new Date().toISOString() });
      this.host.emit(taskId, "task.updated", { task: next });
    }
    const run = await this.host.workItems.createRun({ objectiveId: id, taskId, kind, instruction, imageIds: [...new Set([...(imageIds ?? []), ...feedback.flatMap((entry) => entry.imageIds ?? [])])] });
    this.emitWorkItems();
    const task = this.host.store.get(taskId);
    const failMessage =
      activateError ??
      (task?.status === "error" ? task.errorMessage?.trim() || "AI 启动失败" : null);
    if (failMessage) {
      await this.host.workItems.updateRun(run.id, {
        status: "failed",
        errorMessage: failMessage,
      });
      this.emitWorkItems();
      this.host.emit(taskId, "server.error", { code: "workItem.run", message: failMessage });
      throw new Error(failMessage);
    }
    await this.tryStartWorkItemsForTask(taskId);
    return { item: this.host.workItems.get(id) ?? item };
  }

  async stopWorkItem(id: string): Promise<{ item: WorkItem }> {
    const item = this.host.workItems.get(id);
    if (!item) throw new Error("找不到这个目标");
    await this.host.workflow?.stop(id, true);
    if (!item.taskId) return { item };
    const task = this.host.store.get(item.taskId);
    if (task?.status === "queued") {
      this.host.removeQueued(item.taskId);
      await this.host.apply(item.taskId, "dequeue");
    } else if (task && (isBusyStatus(task.status) || task.status === "booting")) {
      await this.host.abort(item.taskId);
    } else {
      await this.host.workflow?.stop(id);
    }
    const run = this.host.workItems.activeRunForTask(item.taskId);
    if (run) await this.host.workItems.updateRun(run.id, { status: "aborted" });
    this.emitWorkItems();
    return { item: this.host.workItems.get(id) ?? item };
  }

  async setWorkItemState(id: string, state: "open" | "completed" | "archived"): Promise<{ item: WorkItem }> {
    const item = this.host.workItems.get(id);
    if (!item) throw new Error("找不到这个目标");
    if (this.host.workflow?.enabled(item.projectId) && state === "completed") {
      throw new Error("请在交付记录中验收具体版本；验收与合入分别记录");
    }
    if (state === "completed" && item.taskId && this.host.workItems.activeRunForTask(item.taskId)) {
      throw new Error("Agent 还在执行，请先停止或等待本轮结束。");
    }
    if (state === "archived" && item.taskId && this.host.workItems.activeRunForTask(item.taskId)) {
      await this.stopWorkItem(id);
    }
    if (state === "archived") {
      await this.host.workflow?.stop(id, true);
      this.host.workflow?.assertEditable(id);
    }
    const next = await this.host.workItems.setState(id, state);
    this.emitWorkItems();
    // Keep the linked work session in sync: archive ↔ archive, reopen ↔ restore.
    if (state === "archived" && next.taskId) {
      await this.host.archiveTask(next.taskId);
    } else if (state === "open" && next.taskId) {
      const linked = this.host.store.get(next.taskId);
      if (linked?.archivedAt) await this.host.restoreTask(next.taskId);
    }
    return { item: this.host.workItems.get(id) ?? next };
  }

  async deleteWorkItem(id: string): Promise<{ ok: true }> {
    const item = this.host.workItems.get(id);
    if (!item) throw new Error("找不到这个目标");
    if (this.host.workflow?.enabled(item.projectId)) throw new Error("启用编排的需求保留历史，请使用归档；工作区可在合入后单独清理");
    if (item.taskId && this.host.workItems.activeRunForTask(item.taskId)) {
      await this.stopWorkItem(id);
    }
    await this.host.workItems.delete(id);
    this.emitWorkItems();
    return { ok: true };
  }

  async reorderWorkItem(id: string, beforeId?: string | null): Promise<{ item: WorkItem }> {
    const item = await this.host.workItems.reorder(id, beforeId);
    this.emitWorkItems();
    return { item };
  }

  async legacyMoveWorkItem(
    id: string,
    column: WorkItemColumn,
    beforeId?: string | null,
  ): Promise<{ item: WorkItem }> {
    if (column === "doing") return this.startWorkItem(id, "initial");
    if (column === "done") return this.setWorkItemState(id, "completed");
    if (column === "archived") return this.setWorkItemState(id, "archived");
    if (column === "todo") {
      const reopened = await this.setWorkItemState(id, "open");
      if (beforeId !== undefined) return this.reorderWorkItem(id, beforeId);
      return reopened;
    }
    throw new Error("待检视现在由 Agent 本轮完成后自动进入。");
  }

  async tryStartWorkItemsForTask(taskId: string): Promise<void> {
    const task = this.host.store.get(taskId);
    if (!task || task.archivedAt) return;
    if (task.status === "queued" || task.status === "booting") return;
    if (!this.host.supervisor.has(taskId) || task.status !== "idle") return;
    const run = this.host.workItems.activeRunForTask(taskId);
    if (!run || run.status !== "queued") return;
    try {
      await this.host.workItems.updateRun(run.id, { status: "running" });
      await this.host.prompt(taskId, run.instruction, run.imageIds, "prompt", { recordedRun: true });
      const feedbackIds = this.host.workItems
        .listFeedback(run.objectiveId)
        .filter((entry) => !entry.deliveredAt)
        .map((entry) => entry.id);
      if (feedbackIds.length > 0) await this.host.workItems.markFeedbackDelivered(feedbackIds, run.id);
      this.emitWorkItems();
    } catch (error) {
      const message = humanizeUserFacingError(error).trim() || "发送失败";
      await this.host.workItems.updateRun(run.id, { status: "failed", errorMessage: message });
      this.emitWorkItems();
      this.host.emit(taskId, "server.error", { code: "workItem.run", message });
      // Surface to the RPC client so the composer keeps draft + shows the reason.
      throw new Error(message);
    }
  }

  async onWorkItemSettled(taskId: string): Promise<void> {
    const existing = this.settling.get(taskId);
    if (existing) return existing;
    const pending = this.settleWorkItem(taskId);
    this.settling.set(taskId, pending);
    try { await pending; } finally { if (this.settling.get(taskId) === pending) this.settling.delete(taskId); }
  }

  private async settleWorkItem(taskId: string): Promise<void> {
    const task = this.host.store.get(taskId);
    if (!task || task.status === "error") return;
    const run = this.host.workItems.activeRunForTask(taskId);
    if (run) {
      const messages = this.host.supervisor.snapshot(taskId)?.messages ?? [];
      const result = [...messages].reverse().find((message) => message.role === "assistant" && message.text.trim());
      await this.host.workItems.updateRun(run.id, {
        status: "succeeded",
        resultSummary: result ? summarizeWorkResult(result.text) : "本轮执行已结束，请打开对话检查结果。",
        resultMessageId: result?.id ?? null,
      });
      this.emitWorkItems();
      const item = this.host.workItems.get(run.objectiveId);
      const snapshot = this.host.supervisor.snapshot(taskId);
      await this.host.workflow?.captureTranscript(run.objectiveId, run.id, messages, snapshot?.tools ?? []);
      await this.host.workflow?.settled(run.objectiveId, true);
      const cycle = this.host.workflow?.store.state.cycles?.findLast((entry) => entry.itemId === run.objectiveId);
      this.host.emit(taskId, "notification.shown", {
        message: run.kind === "discussion" ? `“${item?.title ?? "需求"}”讨论已结束，可完善范围后开始实施。` : cycle && ["running", "verifying"].includes(cycle.status) ? `“${item?.title ?? "需求"}”本轮结束，正在继续自动封存与验证。` : item && this.host.workflow?.enabled(item.projectId) ? `“${item.title}”本轮执行结束，待封存验证。` : item ? `“${item.title}”已完成一轮执行，等待你验收。` : "工作目标等待验收。",
        notifyType: "info",
      });
    }
    await this.tryStartWorkItemsForTask(taskId);
  }

  async syncActiveWorkRun(taskId: string, status: WorkRunStatus): Promise<void> {
    const run = this.host.workItems.activeRunForTask(taskId);
    if (!run || run.status === status) return;
    await this.host.workItems.updateRun(run.id, { status });
    this.emitWorkItems();
  }
}

function summarizeWorkResult(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= 280) return compact;
  return `${compact.slice(0, 277)}...`;
}

