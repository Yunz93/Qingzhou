import path from "node:path";
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

export type WorkItemControllerHost = {
  store: TaskStore;
  workItems: WorkItemStore;
  supervisor: ProcessSupervisor;
  emit: (taskId: string, type: ServerEvent["type"], payload: unknown) => void;
  createTask: (cwd?: string, title?: string, sessionPath?: string) => Promise<{ task: TaskRecord }>;
  activate: (taskId: string) => Promise<void>;
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
};

export class WorkItemController {
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
  ): Promise<{ item: WorkItem }> {
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
    const item = await this.host.workItems.create({
      title,
      description,
      acceptanceCriteria,
      cwd: resolved,
      projectId: project.id,
    });
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
    const item = await this.host.workItems.update(id, { title, description, acceptanceCriteria });
    this.emitWorkItems();
    return { item };
  }

  workItemDetails(id: string): ReturnType<WorkItemStore["getDetails"]> {
    const details = this.host.workItems.getDetails(id);
    if (!details) throw new Error("找不到这个目标");
    return details;
  }

  async feedbackWorkItem(id: string, text: string): Promise<{ item: WorkItem }> {
    const item = this.host.workItems.get(id);
    if (!item) throw new Error("找不到这个目标");
    if (workItemIsClosed(item.state)) throw new Error("这个目标已经结束，请先重新打开。");
    if (item.taskId && this.host.workItems.activeRunForTask(item.taskId)) {
      throw new Error("这个目标正在执行，请在完整对话中直接补充。");
    }
    await this.host.workItems.addFeedback(id, text);
    this.emitWorkItems();
    return this.startWorkItem(id, "feedback", workItemFeedbackPrompt(item, text));
  }

  async startWorkItem(
    id: string,
    kind: WorkRunKind,
    explicitInstruction?: string,
  ): Promise<{ item: WorkItem }> {
    const item = this.host.workItems.get(id);
    if (!item) throw new Error("找不到这个目标");
    if (workItemIsClosed(item.state)) throw new Error("这个目标已经结束，请先重新打开。");
    if (item.taskId && this.host.workItems.activeRunForTask(item.taskId)) {
      throw new Error("这个目标已经在执行。");
    }
    let taskId = item.taskId;
    if (!taskId || !this.host.store.get(taskId) || this.host.store.get(taskId)?.archivedAt) {
      taskId = (await this.host.createTask(item.cwd, item.title)).task.id;
    } else {
      try {
        await this.host.activate(taskId);
      } catch {
        // The run below records the boot failure and remains recoverable.
      }
    }
    const feedback = this.host.workItems.listFeedback(id).filter((entry) => !entry.deliveredAt);
    const instruction =
      explicitInstruction ??
      workItemPrompt({
        title: item.title,
        description: item.description,
        acceptanceCriteria: item.acceptanceCriteria,
        feedback,
      });
    const run = await this.host.workItems.createRun({ objectiveId: id, taskId, kind, instruction });
    this.emitWorkItems();
    const task = this.host.store.get(taskId);
    if (task?.status === "error") {
      await this.host.workItems.updateRun(run.id, {
        status: "failed",
        errorMessage: task.errorMessage ?? "AI 启动失败",
      });
      this.emitWorkItems();
    } else {
      await this.tryStartWorkItemsForTask(taskId);
    }
    return { item: this.host.workItems.get(id) ?? item };
  }

  async stopWorkItem(id: string): Promise<{ item: WorkItem }> {
    const item = this.host.workItems.get(id);
    if (!item) throw new Error("找不到这个目标");
    if (!item.taskId) return { item };
    const task = this.host.store.get(item.taskId);
    if (task?.status === "queued") {
      this.host.removeQueued(item.taskId);
      await this.host.apply(item.taskId, "dequeue");
    } else if (task && (isBusyStatus(task.status) || task.status === "booting")) {
      await this.host.abort(item.taskId);
    }
    const run = this.host.workItems.activeRunForTask(item.taskId);
    if (run) await this.host.workItems.updateRun(run.id, { status: "aborted" });
    this.emitWorkItems();
    return { item: this.host.workItems.get(id) ?? item };
  }

  async setWorkItemState(id: string, state: "open" | "completed" | "archived"): Promise<{ item: WorkItem }> {
    const item = this.host.workItems.get(id);
    if (!item) throw new Error("找不到这个目标");
    if (state === "completed" && item.taskId && this.host.workItems.activeRunForTask(item.taskId)) {
      throw new Error("Agent 还在执行，请先停止或等待本轮结束。");
    }
    if (state === "archived" && item.taskId && this.host.workItems.activeRunForTask(item.taskId)) {
      await this.stopWorkItem(id);
    }
    const next = await this.host.workItems.setState(id, state);
    this.emitWorkItems();
    return { item: next };
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
      await this.host.prompt(taskId, run.instruction, undefined, "prompt", { recordedRun: true });
      await this.host.workItems.updateRun(run.id, { status: "running" });
      const feedbackIds = this.host.workItems
        .listFeedback(run.objectiveId)
        .filter((entry) => !entry.deliveredAt)
        .map((entry) => entry.id);
      if (feedbackIds.length > 0) await this.host.workItems.markFeedbackDelivered(feedbackIds, run.id);
      this.emitWorkItems();
    } catch (error) {
      const message = humanizeUserFacingError(error);
      await this.host.workItems.updateRun(run.id, { status: "failed", errorMessage: message });
      this.emitWorkItems();
      this.host.emit(taskId, "server.error", { code: "workItem.run", message });
    }
  }

  async onWorkItemSettled(taskId: string): Promise<void> {
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
      this.host.emit(taskId, "notification.shown", {
        message: item ? `“${item.title}”已完成一轮执行，等待你验收。` : "工作目标等待验收。",
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

