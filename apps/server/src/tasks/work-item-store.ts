import { open, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { CoalescedJsonFile } from "./coalesced-json-file.js";
import {
  WORK_ITEM_SCHEMA_VERSION,
  workItemDetailsSchema,
  workItemFeedbackSchema,
  workItemIsClosed,
  workItemSchema,
  workItemSummarySchema,
  workProjectSchema,
  workRunIsActive,
  workRunSchema,
  type WorkItem,
  type WorkItemDetails,
  type WorkItemFeedback,
  type WorkItemState,
  type WorkItemSummary,
  type WorkProject,
  type WorkRun,
  type WorkRunKind,
  type WorkRunStatus,
} from "@qingzhou/protocol";

type PersistedState = {
  schemaVersion: number;
  activeProjectId: string | null;
  projects: WorkProject[];
  items: WorkItem[];
  runs: WorkRun[];
  feedback: WorkItemFeedback[];
};

/** Shown when a busy work run is demoted after the server process restarts. */
export const WORK_ITEM_RESTART_INTERRUPT_MESSAGE = "应用重启时中断，请检查现状后继续。";

const emptyState = (): PersistedState => ({
  schemaVersion: WORK_ITEM_SCHEMA_VERSION,
  activeProjectId: null,
  projects: [],
  items: [],
  runs: [],
  feedback: [],
});

export class WorkItemStore {
  private state: PersistedState = emptyState();
  private readonly filePath: string;
  private readonly backupPath: string;
  private readonly file: CoalescedJsonFile<PersistedState>;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "work-items.json");
    this.backupPath = path.join(dataDir, "work-items.v2.backup.json");
    this.file = new CoalescedJsonFile(this.filePath, () => this.state, { debounceMs: 50, fsync: false });
  }

  /** Force a durable write (used on shutdown). */
  async flushSync(): Promise<void> {
    await this.file.flushNow({ fsync: true });
  }

  list(): WorkItemSummary[] {
    return this.state.items
      .slice()
      .sort((a, b) => a.rank - b.rank || b.updatedAt.localeCompare(a.updatedAt))
      .map((item) => this.summary(item));
  }

  listByProject(projectId: string): WorkItemSummary[] {
    return this.list().filter((item) => item.projectId === projectId);
  }

  listProjects(): WorkProject[] {
    return this.state.projects
      .filter((project) => !project.archivedAt)
      .slice()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((project) => ({ ...project }));
  }

  get(id: string): WorkItem | undefined {
    const item = this.state.items.find((entry) => entry.id === id);
    return item ? { ...item } : undefined;
  }

  getSummary(id: string): WorkItemSummary | undefined {
    const item = this.get(id);
    return item ? this.summary(item) : undefined;
  }

  getDetails(id: string): WorkItemDetails | undefined {
    const item = this.get(id);
    if (!item) return undefined;
    return workItemDetailsSchema.parse({
      item,
      runs: this.listRuns(id),
      feedback: this.listFeedback(id),
    });
  }

  getProject(id: string): WorkProject | undefined {
    const project = this.state.projects.find((entry) => entry.id === id);
    return project ? { ...project } : undefined;
  }

  findProjectByCwd(cwd: string): WorkProject | undefined {
    const project = this.state.projects.find((entry) => entry.cwd === cwd && !entry.archivedAt);
    return project ? { ...project } : undefined;
  }

  getActiveProjectId(): string | null {
    const id = this.state.activeProjectId;
    if (id) {
      const current = this.getProject(id);
      if (current && !current.archivedAt) return id;
    }
    return this.listProjects()[0]?.id ?? null;
  }

  findByTaskId(taskId: string): WorkItem[] {
    return this.state.items.filter((item) => item.taskId === taskId).map((item) => ({ ...item }));
  }

  getRun(id: string): WorkRun | undefined {
    const run = this.state.runs.find((entry) => entry.id === id);
    return run ? { ...run } : undefined;
  }

  latestRun(id: string): WorkRun | undefined {
    const item = this.get(id);
    return item?.latestRunId ? this.getRun(item.latestRunId) : undefined;
  }

  activeRunForTask(taskId: string): WorkRun | undefined {
    return this.state.runs
      .filter((run) => run.taskId === taskId && workRunIsActive(run.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  }

  listRuns(id: string): WorkRun[] {
    return this.state.runs
      .filter((run) => run.objectiveId === id)
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((run) => ({ ...run }));
  }

  listFeedback(id: string): WorkItemFeedback[] {
    return this.state.feedback
      .filter((entry) => entry.objectiveId === id)
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((entry) => ({ ...entry }));
  }

  async load(): Promise<void> {
    try {
      const rawText = await readFile(this.filePath, "utf8");
      const raw = JSON.parse(rawText) as Record<string, unknown>;
      const previousVersion = typeof raw.schemaVersion === "number" ? raw.schemaVersion : 1;
      const migrated = migratePersisted(raw);
      if (previousVersion < WORK_ITEM_SCHEMA_VERSION) {
        await this.writeBackupIfMissing(rawText);
      }
      this.state = migrated;
      const reconciled = this.reconcileInterruptedRuns();
      if (previousVersion < WORK_ITEM_SCHEMA_VERSION || reconciled) await this.flush();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.state = emptyState();
        return;
      }
      throw error;
    }
  }

  async createProject(input: { name: string; cwd: string }): Promise<WorkProject> {
    const now = new Date().toISOString();
    const project = workProjectSchema.parse({
      schemaVersion: WORK_ITEM_SCHEMA_VERSION,
      id: randomUUID(),
      name: input.name.trim() || folderName(input.cwd),
      cwd: input.cwd,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    });
    this.state.projects.push(project);
    this.state.activeProjectId = project.id;
    await this.flush();
    return { ...project };
  }

  async selectProject(id: string): Promise<WorkProject> {
    const project = this.getProject(id);
    if (!project || project.archivedAt) throw new Error("找不到这个项目");
    this.state.activeProjectId = id;
    await this.flush();
    return project;
  }

  async create(input: {
    title: string;
    description?: string;
    acceptanceCriteria?: string;
    cwd: string;
    projectId?: string;
  }): Promise<WorkItem> {
    let projectId = input.projectId;
    if (!projectId) {
      const existing = this.findProjectByCwd(input.cwd);
      projectId = existing
        ? existing.id
        : (await this.createProject({ name: folderName(input.cwd), cwd: input.cwd })).id;
    }
    const project = this.getProject(projectId);
    if (!project) throw new Error("找不到这个项目");
    const now = new Date().toISOString();
    const item = workItemSchema.parse({
      schemaVersion: WORK_ITEM_SCHEMA_VERSION,
      id: randomUUID(),
      projectId,
      title: input.title.trim(),
      description: input.description?.trim() ?? "",
      acceptanceCriteria: input.acceptanceCriteria?.trim() ?? "",
      cwd: project.cwd,
      state: "open",
      rank: nextRank(this.state.items, projectId),
      taskId: null,
      latestRunId: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      archivedAt: null,
    });
    this.state.items.push(item);
    if (!this.state.activeProjectId) this.state.activeProjectId = projectId;
    this.touchProject(projectId, now);
    await this.flush();
    return this.get(item.id)!;
  }

  async update(
    id: string,
    patch: Partial<Pick<WorkItem, "title" | "description" | "acceptanceCriteria" | "taskId" | "latestRunId">>,
  ): Promise<WorkItem> {
    const index = this.requireItemIndex(id);
    const current = this.state.items[index]!;
    const now = new Date().toISOString();
    const next = workItemSchema.parse({
      ...current,
      ...patch,
      title: patch.title != null ? patch.title.trim() : current.title,
      description: patch.description != null ? patch.description.trim() : current.description,
      acceptanceCriteria:
        patch.acceptanceCriteria != null ? patch.acceptanceCriteria.trim() : current.acceptanceCriteria,
      updatedAt: now,
    });
    this.state.items[index] = next;
    this.touchProject(next.projectId, now);
    await this.flush();
    return this.get(id)!;
  }

  async setState(id: string, state: WorkItemState): Promise<WorkItem> {
    const index = this.requireItemIndex(id);
    const current = this.state.items[index]!;
    const now = new Date().toISOString();
    this.state.items[index] = workItemSchema.parse({
      ...current,
      state,
      completedAt: state === "open" ? null : state === "completed" ? (current.completedAt ?? now) : current.completedAt,
      archivedAt: state === "archived" ? (current.archivedAt ?? now) : null,
      updatedAt: now,
    });
    this.touchProject(current.projectId, now);
    await this.flush();
    return this.get(id)!;
  }

  async addFeedback(id: string, text: string): Promise<WorkItemFeedback> {
    const item = this.get(id);
    if (!item) throw new Error("找不到这个目标");
    if (workItemIsClosed(item.state)) throw new Error("这个目标已经结束，请先重新打开。");
    const trimmed = text.trim();
    if (!trimmed) throw new Error("请填写补充要求。");
    const entry = workItemFeedbackSchema.parse({
      id: randomUUID(),
      objectiveId: id,
      runId: null,
      text: trimmed,
      createdAt: new Date().toISOString(),
      deliveredAt: null,
    });
    this.state.feedback.push(entry);
    await this.update(id, {});
    return { ...entry };
  }

  async markFeedbackDelivered(feedbackIds: string[], runId: string): Promise<void> {
    const now = new Date().toISOString();
    const selected = new Set(feedbackIds);
    this.state.feedback = this.state.feedback.map((entry) =>
      selected.has(entry.id) ? { ...entry, runId, deliveredAt: now } : entry,
    );
    await this.flush();
  }

  async createRun(input: {
    objectiveId: string;
    taskId: string;
    kind: WorkRunKind;
    instruction: string;
    status?: WorkRunStatus;
  }): Promise<WorkRun> {
    const item = this.get(input.objectiveId);
    if (!item) throw new Error("找不到这个目标");
    if (workItemIsClosed(item.state)) throw new Error("这个目标已经结束，请先重新打开。");
    const active = this.activeRunForTask(input.taskId);
    if (active) throw new Error("这个目标已经在执行。");
    const now = new Date().toISOString();
    const status = input.status ?? "queued";
    const run = workRunSchema.parse({
      id: randomUUID(),
      objectiveId: input.objectiveId,
      taskId: input.taskId,
      kind: input.kind,
      instruction: input.instruction.trim(),
      status,
      resultSummary: null,
      resultMessageId: null,
      errorMessage: null,
      createdAt: now,
      startedAt: status === "running" ? now : null,
      finishedAt: null,
    });
    this.state.runs.push(run);
    await this.update(input.objectiveId, { taskId: input.taskId, latestRunId: run.id });
    return { ...run };
  }

  async updateRun(
    id: string,
    patch: Partial<Pick<WorkRun, "status" | "resultSummary" | "resultMessageId" | "errorMessage" | "startedAt" | "finishedAt">>,
  ): Promise<WorkRun> {
    const index = this.state.runs.findIndex((run) => run.id === id);
    if (index < 0) throw new Error("找不到这次执行");
    const current = this.state.runs[index]!;
    const now = new Date().toISOString();
    const terminal = patch.status && ["succeeded", "failed", "aborted"].includes(patch.status);
    const next = workRunSchema.parse({
      ...current,
      ...patch,
      startedAt: patch.status === "running" ? (current.startedAt ?? now) : (patch.startedAt ?? current.startedAt),
      finishedAt: terminal ? (patch.finishedAt ?? now) : (patch.finishedAt ?? current.finishedAt),
    });
    this.state.runs[index] = next;
    await this.update(current.objectiveId, {});
    return { ...next };
  }

  async reorder(id: string, beforeId?: string | null): Promise<WorkItem> {
    const item = this.get(id);
    if (!item) throw new Error("找不到这个目标");
    const others = this.state.items
      .filter((entry) => entry.id !== id && entry.projectId === item.projectId && entry.state === "open")
      .sort((a, b) => a.rank - b.rank || a.createdAt.localeCompare(b.createdAt));
    const found = beforeId == null ? -1 : others.findIndex((entry) => entry.id === beforeId);
    const insertAt = beforeId == null || found < 0 ? others.length : found;
    const ordered = [...others];
    ordered.splice(insertAt, 0, item);
    const now = new Date().toISOString();
    for (const [rank, entry] of ordered.entries()) {
      const index = this.requireItemIndex(entry.id);
      this.state.items[index] = { ...this.state.items[index]!, rank, updatedAt: now };
    }
    this.touchProject(item.projectId, now);
    await this.flush();
    return this.get(id)!;
  }

  private reconcileInterruptedRuns(): boolean {
    let changed = false;
    const now = new Date().toISOString();
    this.state.runs = this.state.runs.map((run) => {
      if (!workRunIsActive(run.status)) return run;
      changed = true;
      return workRunSchema.parse({
        ...run,
        status: "aborted",
        errorMessage: run.errorMessage?.trim() || WORK_ITEM_RESTART_INTERRUPT_MESSAGE,
        finishedAt: run.finishedAt ?? now,
      });
    });
    return changed;
  }

  private summary(item: WorkItem): WorkItemSummary {
    const runs = this.state.runs.filter((run) => run.objectiveId === item.id);
    const latestRun = item.latestRunId ? (runs.find((run) => run.id === item.latestRunId) ?? null) : null;
    return workItemSummarySchema.parse({
      ...item,
      latestRun,
      runCount: runs.length,
      feedbackCount: this.state.feedback.filter((entry) => entry.objectiveId === item.id).length,
    });
  }

  private requireItemIndex(id: string): number {
    const index = this.state.items.findIndex((item) => item.id === id);
    if (index < 0) throw new Error("找不到这个目标");
    return index;
  }

  private touchProject(projectId: string, now: string): void {
    const index = this.state.projects.findIndex((project) => project.id === projectId);
    if (index >= 0) this.state.projects[index] = { ...this.state.projects[index]!, updatedAt: now };
  }

  private async writeBackupIfMissing(rawText: string): Promise<void> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(path.dirname(this.backupPath), { recursive: true });
      handle = await open(this.backupPath, "wx");
      await handle.writeFile(rawText, "utf8");
      await handle.sync();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    } finally {
      await handle?.close();
    }
  }

  private async flush(): Promise<void> {
    await this.file.flush();
  }
}

function migratePersisted(raw: Record<string, unknown>): PersistedState {
  const rawProjects = Array.isArray(raw.projects) ? raw.projects : [];
  const projects: WorkProject[] = rawProjects.map((project) =>
    workProjectSchema.parse({ ...(project as object), schemaVersion: WORK_ITEM_SCHEMA_VERSION }),
  );
  if (raw.schemaVersion === WORK_ITEM_SCHEMA_VERSION) {
    return {
      schemaVersion: WORK_ITEM_SCHEMA_VERSION,
      activeProjectId: validActiveProjectId(raw.activeProjectId, projects),
      projects,
      items: (Array.isArray(raw.items) ? raw.items : []).map((item) => workItemSchema.parse(item)),
      runs: (Array.isArray(raw.runs) ? raw.runs : []).map((run) => workRunSchema.parse(run)),
      feedback: (Array.isArray(raw.feedback) ? raw.feedback : []).map((entry) => workItemFeedbackSchema.parse(entry)),
    };
  }

  const items: WorkItem[] = [];
  const runs: WorkRun[] = [];
  const feedback: WorkItemFeedback[] = [];
  const rawItems = Array.isArray(raw.items) ? (raw.items as Array<Record<string, unknown>>) : [];
  for (const rawItem of rawItems) {
    const cwd = typeof rawItem.cwd === "string" ? rawItem.cwd : "";
    let projectId = typeof rawItem.projectId === "string" ? rawItem.projectId : "";
    if (!projectId) {
      let project = projects.find((entry) => entry.cwd === cwd && !entry.archivedAt);
      if (!project && cwd) {
        const now = new Date().toISOString();
        project = workProjectSchema.parse({
          schemaVersion: WORK_ITEM_SCHEMA_VERSION,
          id: randomUUID(),
          name: folderName(cwd),
          cwd,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
        });
        projects.push(project);
      }
      projectId = project?.id ?? "";
    }
    const id = String(rawItem.id ?? randomUUID());
    const column = String(rawItem.column ?? "todo");
    const taskId = typeof rawItem.taskId === "string" ? rawItem.taskId : null;
    const createdAt = String(rawItem.createdAt ?? new Date().toISOString());
    const updatedAt = String(rawItem.updatedAt ?? createdAt);
    let latestRunId: string | null = null;
    if (taskId && (column === "review" || column === "doing")) {
      const pending = Boolean(rawItem.pendingRun);
      const lastRunAt = typeof rawItem.lastRunAt === "string" ? rawItem.lastRunAt : null;
      if (pending || lastRunAt || column === "review") {
        const status: WorkRunStatus = pending ? "queued" : column === "review" ? "succeeded" : "aborted";
        const run = workRunSchema.parse({
          id: randomUUID(),
          objectiveId: id,
          taskId,
          kind: "migrated",
          instruction: `迁移自旧版工作目标：${String(rawItem.title ?? "未命名目标")}`,
          status,
          resultSummary: null,
          resultMessageId: null,
          errorMessage: status === "aborted" ? "应用升级时中断，请检查现状后继续。" : null,
          createdAt: lastRunAt ?? updatedAt,
          startedAt: status === "queued" ? null : (lastRunAt ?? updatedAt),
          finishedAt: status === "queued" ? null : updatedAt,
        });
        runs.push(run);
        latestRunId = run.id;
      }
    }
    const state: WorkItemState = column === "done" ? "completed" : column === "archived" ? "archived" : "open";
    items.push(
      workItemSchema.parse({
        schemaVersion: WORK_ITEM_SCHEMA_VERSION,
        id,
        projectId,
        title: rawItem.title,
        description: rawItem.description ?? "",
        acceptanceCriteria: "",
        cwd,
        state,
        rank: rawItem.rank ?? 0,
        taskId,
        latestRunId,
        createdAt,
        updatedAt,
        completedAt: state === "completed" ? (rawItem.closedAt ?? updatedAt) : null,
        archivedAt: state === "archived" ? (rawItem.closedAt ?? updatedAt) : null,
      }),
    );
    for (const note of Array.isArray(rawItem.notes) ? (rawItem.notes as Array<Record<string, unknown>>) : []) {
      feedback.push(
        workItemFeedbackSchema.parse({
          id: note.id,
          objectiveId: id,
          runId: null,
          text: note.text,
          createdAt: note.createdAt,
          deliveredAt: note.sentAt ?? null,
        }),
      );
    }
  }
  return {
    schemaVersion: WORK_ITEM_SCHEMA_VERSION,
    activeProjectId: validActiveProjectId(raw.activeProjectId, projects),
    projects,
    items,
    runs,
    feedback,
  };
}

function validActiveProjectId(value: unknown, projects: WorkProject[]): string | null {
  return typeof value === "string" && projects.some((project) => project.id === value)
    ? value
    : (projects[0]?.id ?? null);
}

function nextRank(items: WorkItem[], projectId: string): number {
  let max = -1;
  for (const item of items) {
    if (item.projectId === projectId && item.rank > max) max = item.rank;
  }
  return max + 1;
}

function folderName(cwd: string): string {
  const parts = cwd.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}
