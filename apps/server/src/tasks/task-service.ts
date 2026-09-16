import { randomUUID } from "node:crypto";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  applyModePrefix,
  approvalDecision,
  effectiveApprovalPolicy,
  emptyRuntime,
  extractAtMentions,
  normalizeSessionStats,
  stripModePrefix,
  type AuthEntry,
  type ClientCommand,
  type ModelRef,
  type PiResources,
  type ServerEvent,
  type TaskRecord,
  type TimelineImage,
  type TimelineMessage,
  workItemFeedbackPrompt,
  workItemIsClosed,
  workItemPrompt,
  workLinkedPromptError,
  workLinkedSessionRewriteError,
  type WorkItem,
  type WorkItemColumn,
  type WorkRunKind,
  type WorkRunStatus,
  type SkillUpdateApplyResult,
  type SkillUpdateCheckResult,
} from "@qingzhou/protocol";
import type { AppConfig } from "../config.js";
import { piMessagesToTimeline } from "../pi/event-normalizer.js";
import { ProcessSupervisor } from "../pi/process-supervisor.js";
import { canTransition, isActiveProcessStatus, isBusyStatus, transition } from "../pi/state-machine.js";
import {
  assertAllowedCwd,
  isInsideRoot,
  isProtectedWriteTarget,
  resolveAllowedPath,
  userCwdRoots,
} from "../security/path-policy.js";
import { humanizeUserFacingError, isMissingCredentialError } from "../setup/pi-agent-dir.js";
import { EventDispatcher, type SocketLike } from "./event-dispatcher.js";
import { ensureCasualChatCwd } from "./casual-chat.js";
import { CheckpointStore } from "./checkpoints.js";
import { previewProjectFile, listProjectFiles } from "./file-browser.js";
import { assertGitRelativePath, commitGit, initGit, pushGit, readGitDiff, readGitStatus, restoreGit } from "./git-status.js";
import { RememberedApprovals } from "./remembered-approvals.js";
import { TaskShells } from "./task-shell.js";
import { openNativeTerminal } from "./open-native-terminal.js";
import { scanPiResources, createProjectAgentsFile, setSkillEnabled, setExtensionEnabled, readContextFile, writeContextFile } from "./pi-resources.js";
import { installPresetPiPackages } from "./pi-packages.js";
import { applySystemSkillUpdates, checkSystemSkillUpdates } from "./pi-skill-updates.js";
import { createModelChangeNotice, modelDisplayName } from "./model-change.js";
import { readPiDefaultModelSync, writePiDefaultModel } from "./pi-default-model.js";
import { assertPiSessionPath, listPiSessions, piSessionsRoot } from "./pi-sessions.js";
import { TaskStore } from "./task-store.js";
import { UploadStore } from "./upload-store.js";
import { WorkItemStore } from "./work-item-store.js";

export type SetupHints = {
  authConfigured: boolean;
  configuredProviders: string[];
  needsSetup: boolean;
  homeDir: string;
  workspaceRoot: string | null;
  authEntries: AuthEntry[];
  trustProject: boolean;
};

export class TaskService {
  readonly supervisor: ProcessSupervisor;
  private readonly events: EventDispatcher;
  private readonly queue: string[] = [];
  private readonly booting = new Map<string, Promise<void>>();
  private readonly abortFallback = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly queueEdits = new Set<string>();
  private static readonly ABORT_CONFIRM_MS = 8_000;
  private activeTaskId: string | null = null;
  private readonly uploads = new UploadStore();
  private readonly remembered: RememberedApprovals;
  private readonly checkpoints: CheckpointStore;
  private setupHints: SetupHints = {
    authConfigured: false,
    configuredProviders: [],
    needsSetup: true,
    homeDir: "",
    workspaceRoot: null,
    authEntries: [],
    trustProject: false,
  };
  private readonly resources = new Map<string, PiResources>();
  private readonly gitDiffs = new Map<string, string>();
  private readonly shells = new TaskShells();

  private readonly workItems: WorkItemStore;
  private defaultModel: ModelRef | null = null;

  constructor(
    private config: AppConfig,
    private readonly store: TaskStore,
    public piVersion: string | null,
    public piError: string | null,
    workItems?: WorkItemStore,
  ) {
    this.workItems = workItems ?? new WorkItemStore(config.dataDir);
    this.supervisor = new ProcessSupervisor(
      config,
      (taskId, generation, error) => {
        void this.handleUnexpectedExit(taskId, generation, error);
      },
      (taskId) => {
        void this.apply(taskId, "approval_request");
      },
      (taskId) => {
        void this.apply(taskId, "agent_settled");
      },
      (taskId) => {
        void this.apply(taskId, "abort_confirmed");
      },
    );
    this.events = new EventDispatcher((taskId) => this.supervisor.nextSequence(taskId));
    this.remembered = new RememberedApprovals(config.dataDir);
    this.checkpoints = new CheckpointStore(config.dataDir);
    this.defaultModel = readPiDefaultModelSync(config.piAgentDir);
    void this.remembered.load();
    this.supervisor.onEvent((event) => {
      this.events.dispatch(event);
      if (event.type === "approval.requested") {
        void this.syncActiveWorkRun(event.taskId, "waiting_approval");
        void this.applyStoredPolicy(event.taskId, event.payload.approval);
      }
      if (event.type === "approval.resolved") {
        void this.syncActiveWorkRun(event.taskId, "running");
        const task = this.store.get(event.taskId);
        if (task?.status === "waiting_approval") {
          void this.apply(event.taskId, "approval_resolved");
        }
      }
      if (event.type === "interaction.requested") {
        void this.syncActiveWorkRun(event.taskId, "waiting_input");
      }
      if (event.type === "interaction.resolved") {
        void this.syncActiveWorkRun(event.taskId, "running");
      }
      if (event.type === "message.started" || event.type === "tool.started") {
        void this.markUnread(event.taskId);
      }
    });
  }

  updateConfig(config: AppConfig): void {
    this.config = config;
    this.supervisor.updateConfig(config);
    this.defaultModel = readPiDefaultModelSync(config.piAgentDir);
  }

  setPi(version: string | null, error: string | null): void {
    this.piVersion = version;
    this.piError = error;
  }

  setSetupHints(hints: SetupHints): void {
    this.setupHints = hints;
  }

  dispose(): void {
    for (const taskId of [...this.abortFallback.keys()]) this.clearAbortFallback(taskId);
    this.shells.disposeAll();
  }

  addSocket(socket: SocketLike): void {
    this.events.addSocket(socket);
  }

  removeSocket(socket: SocketLike): void {
    this.events.removeSocket(socket);
  }

  /** Array order in the store is the persisted user order (newest first,
   *  manual drag-reorder as-is). Clicking/activating a task never moves it. */
  listTasks(): TaskRecord[] {
    return this.store.listVisible();
  }

  storeUpload(id: string, mimeType: string, data: Buffer): boolean {
    return this.uploads.add(id, mimeType, data);
  }

  async handleCommand(command: ClientCommand): Promise<unknown> {
    switch (command.type) {
      case "task.create":
        return this.createTask(command.payload.cwd, command.payload.title);
      case "session.tree":
        return this.emitSessionTree(command.taskId);
      case "session.branch":
        return this.branchSession(command.taskId, command.payload.entryId, command.payload.message);
      case "sessions.list":
        return this.listSessions(command.payload?.cwd);
      case "session.resume":
        return this.resumeSession(command.payload.sessionPath, command.payload.cwd, command.payload.title);
      case "session.export":
        return this.exportSession(command.taskId);
      case "resources.list":
        return this.emitResources(command.taskId);
      case "runtime.set":
        return this.setRuntime(command.taskId, command.payload);
      case "term.start":
        return this.startTerm(command.taskId, command.payload);
      case "term.input":
        return this.inputTerm(command.taskId, command.payload.data);
      case "term.resize":
        return this.resizeTerm(command.taskId, command.payload.cols, command.payload.rows);
      case "term.close":
        return this.closeTerm(command.taskId);
      case "term.run":
        return this.runTerm(command.taskId, command.payload.command);
      case "term.interrupt":
        return this.interruptTerm(command.taskId);
      case "term.openNative":
        return this.openNativeTerm(command.taskId);
      case "workItem.list":
        return this.emitWorkItems();
      case "workProject.create":
        return this.createWorkProject(command.payload.name, command.payload.cwd);
      case "workProject.select":
        return this.selectWorkProject(command.payload.id);
      case "workItem.create":
        return this.createWorkItem(
          command.payload.title,
          command.payload.description,
          command.payload.acceptanceCriteria,
          command.payload.cwd,
          command.payload.projectId,
          command.payload.start,
        );
      case "workItem.update":
        return this.updateWorkItem(
          command.payload.id,
          command.payload.title,
          command.payload.description,
          command.payload.acceptanceCriteria,
        );
      case "workItem.start":
        return this.startWorkItem(command.payload.id, "initial");
      case "workItem.feedback":
        return this.feedbackWorkItem(command.payload.id, command.payload.text);
      case "workItem.stop":
        return this.stopWorkItem(command.payload.id);
      case "workItem.accept":
        return this.setWorkItemState(command.payload.id, "completed");
      case "workItem.reopen":
        return this.setWorkItemState(command.payload.id, "open");
      case "workItem.archive":
        return this.setWorkItemState(command.payload.id, "archived");
      case "workItem.reorder":
        return this.reorderWorkItem(command.payload.id, command.payload.beforeId);
      case "workItem.details":
        return this.workItemDetails(command.payload.id);
      case "workItem.append":
        return this.feedbackWorkItem(command.payload.id, command.payload.text);
      case "workItem.move":
        return this.legacyMoveWorkItem(command.payload.id, command.payload.column, command.payload.beforeId);
      case "task.activate":
        await this.activate(command.taskId);
        return { task: this.store.get(command.taskId) };
      case "task.rename":
        return this.rename(command.taskId, command.payload.title);
      case "task.archive":
        return this.archive(command.taskId);
      case "task.reorder":
        return this.reorderTasks(command.payload.cwd, command.payload.taskIds);
      case "prompt.send":
        return this.prompt(command.taskId, command.payload.message, command.payload.imageIds, "prompt");
      case "prompt.steer":
        return this.prompt(command.taskId, command.payload.message, command.payload.imageIds, "steer");
      case "prompt.followUp":
        return this.prompt(command.taskId, command.payload.message, command.payload.imageIds, "follow_up");
      case "prompt.queue.edit":
        return this.editQueuedPrompt(command.taskId, command.payload);
      case "agent.abort":
        return this.abort(command.taskId);
      case "model.set": {
        const previous = this.requireTask(command.taskId).model;
        await this.supervisor.rpcData(command.taskId, {
          type: "set_model",
          provider: command.payload.provider,
          modelId: command.payload.modelId,
        });
        await this.refreshTaskModel(command.taskId);
        const next = this.requireTask(command.taskId).model;
        const from = modelDisplayName(previous);
        const to = modelDisplayName(next);
        const notice = createModelChangeNotice(
          `${previous?.provider ?? ""}/${previous?.id ?? ""}->${next?.provider ?? ""}/${next?.id ?? ""}`,
          from,
          to,
        );
        if (notice) this.supervisor.appendNotice(command.taskId, notice);
        return { ok: true };
      }
      case "model.default.set": {
        const written = await writePiDefaultModel(this.config.piAgentDir, {
          provider: command.payload.provider,
          id: command.payload.modelId,
        });
        this.defaultModel = this.resolveDefaultModel(written.provider, written.id);
        this.emitModelsUpdated(command.taskId);
        return { ok: true, defaultModel: this.defaultModel };
      }
      case "thinking.set":
        await this.supervisor.rpcData(command.taskId, {
          type: "set_thinking_level",
          level: command.payload.level,
        });
        await this.refreshTaskModel(command.taskId);
        return { ok: true };
      case "approval.respond":
        return this.respondApproval(
          command.taskId,
          command.payload.requestId,
          command.payload.allow,
          command.payload.remember,
        );
      case "task.policy.set":
        return this.setPolicy(command.taskId, command.payload.mode, command.payload.approvalPolicy);
      case "session.fork":
        return this.forkSession(command.taskId, command.payload.messageId, command.payload.message);
      case "session.clone":
        return this.cloneSession(command.taskId);
      case "git.status":
        return this.emitGitStatus(command.taskId);
      case "checkpoint.list":
        return this.emitCheckpoints(command.taskId);
      case "checkpoint.restore":
        return this.restoreCheckpoint(command.taskId, command.payload);
      case "git.diff":
        return this.emitGitDiff(command.taskId);
      case "git.commit":
        return this.commitTaskGit(command.taskId, command.payload.message, command.payload.push);
      case "git.init":
        return this.initTaskGit(command.taskId);
      case "git.restore":
        return this.restoreTaskGit(command.taskId, command.payload.path);
      case "resources.reload":
        return this.reloadResources(command.taskId);
      case "resources.createAgents":
        return this.createAgentsFile(command.taskId);
      case "resources.read":
        return this.readResourceFile(command.taskId, command.payload.path);
      case "resources.write":
        return this.writeResourceFile(command.taskId, command.payload.path, command.payload.content);
      case "resources.skill.set":
        return this.setResourceSkill(command.taskId, command.payload.path, command.payload.enabled);
      case "resources.skill.updates":
        return this.checkResourceSkillUpdates(command.taskId, command.payload?.paths);
      case "resources.skill.update":
        return this.updateResourceSkills(command.taskId, command.payload?.paths);
      case "resources.extension.set":
        return this.setResourceExtension(command.taskId, command.payload.path, command.payload.enabled);
      case "resources.package.install":
        return this.installResourcePackages(command.taskId, command.payload?.ids);
      case "files.open":
        return this.openFile(command.taskId, command.payload.path);
      case "interaction.respond":
        return this.respondInteraction(
          command.taskId,
          command.payload.requestId,
          command.payload.cancelled,
          command.payload.value,
        );
      case "commands.list":
        return this.emitCommands(command.taskId);
      case "session.compact":
        await this.supervisor.rpcData(command.taskId, {
          type: "compact",
          customInstructions: command.payload?.customInstructions,
        });
        await this.refreshStats(command.taskId);
        return { ok: true };
      case "session.stats":
        await this.refreshStats(command.taskId);
        return { ok: true };
      case "snapshot.request": {
        const snapshotTaskId = command.payload?.taskId ?? this.activeTaskId;
        if (snapshotTaskId && this.supervisor.has(snapshotTaskId)) {
          await this.refreshAvailableModels(snapshotTaskId);
        }
        return this.buildSnapshot(snapshotTaskId);
      }
      case "files.tree":
        return this.fileTree(command.taskId);
      case "files.read":
        return this.filePreview(command.taskId, command.payload.path);
      case "task.search":
        return {
          tasks: this.listTasks().filter((task) => {
            const q = command.payload.query.trim().toLowerCase();
            if (!q) return true;
            return task.title.toLowerCase().includes(q) || task.cwd.toLowerCase().includes(q);
          }),
        };
      default:
        throw new Error("Unknown command");
    }
  }

  buildSnapshot(taskId: string | null): Record<string, unknown> {
    const tasks = this.listTasks();
    const activeId = taskId && tasks.some((task) => task.id === taskId) ? taskId : this.activeTaskId;
    const runtime = activeId ? this.supervisor.snapshot(activeId) : null;
    const active = activeId ? this.store.get(activeId) : undefined;
    return {
      tasks,
      activeTaskId: activeId,
      messages: runtime?.messages ?? [],
      tools: runtime?.tools ?? [],
      approval: runtime?.approval ?? null,
      models: runtime?.models ?? [],
      thinkingLevels: runtime?.thinkingLevels ?? ["off"],
      defaultModel: this.defaultModel,
      stats: runtime?.stats ?? null,
      piVersion: this.piVersion,
      piAvailable: Boolean(this.piVersion) && !this.piError,
      piError: this.piError,
      mutations: this.config.mutations,
      allowedRoots: this.config.allowedRoots,
      dataDir: this.config.dataDir,
      maxProcesses: this.config.maxProcesses,
      authConfigured: this.setupHints.authConfigured,
      configuredProviders: this.setupHints.configuredProviders,
      needsSetup: this.setupHints.needsSetup,
      homeDir: this.setupHints.homeDir || this.config.homeDir,
      workspaceRoot: this.setupHints.workspaceRoot,
      status: active?.status ?? "stopped",
      pendingApprovals: this.supervisor.listApprovals(),
      commands: runtime?.commands ?? [],
      runtime: runtime?.runtime ?? emptyRuntime(),
      resources: activeId ? this.resources.get(activeId) : undefined,
      sessionTree: runtime?.sessionTree ?? [],
      sessionLeafId: runtime?.sessionLeafId ?? null,
      authEntries: this.setupHints.authEntries,
      trustProject: this.config.trustProject,
      pendingInteractions: this.supervisor.listInteractions(),
      gitDiff: activeId ? (this.gitDiffs.get(activeId) ?? null) : null,
      workItems: this.workItems.list(),
      workProjects: this.workItems.listProjects(),
      activeProjectId: this.workItems.getActiveProjectId(),
    };
  }

  private cwdRoots(): string[] {
    return userCwdRoots(this.config.homeDir, this.config.allowedRoots);
  }

  private adoptAllowedRoot(cwd: string): void {
    const resolved = path.resolve(cwd);
    if (this.config.allowedRoots.some((root) => isInsideRoot(resolved, path.resolve(root)))) {
      return;
    }
    this.updateConfig({
      ...this.config,
      allowedRoots: [...this.config.allowedRoots, resolved],
    });
  }

  private async createTask(cwd?: string, title?: string, sessionPath?: string): Promise<{ task: TaskRecord }> {
    const casual = !cwd?.trim();
    const roots = this.cwdRoots();
    const resolved = casual
      ? await ensureCasualChatCwd(this.config.homeDir, this.config.allowedRoots)
      : await assertAllowedCwd(cwd!.trim(), roots);
    this.adoptAllowedRoot(resolved);
    const now = new Date().toISOString();
    const task: TaskRecord = {
      schemaVersion: 1,
      id: randomUUID(),
      title: title?.trim() || (casual ? "随便聊聊" : path.basename(resolved) || "新对话"),
      cwd: resolved,
      sessionPath: sessionPath ?? null,
      status: "stopped",
      model: null,
      thinkingLevel: "off",
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
      archivedAt: null,
      unreadCount: 0,
      errorMessage: null,
      mode: "agent",
      approvalPolicy: "auto",
    };
    await this.store.upsert(task);
    this.activeTaskId = task.id;
    this.emit(task.id, "task.created", { task });
    try {
      await this.activate(task.id);
    } catch {
      // Keep the task even if Pi is unavailable. The UI shows the boot error.
    }
    return { task: this.store.get(task.id) ?? task };
  }

  private async rename(taskId: string, title: string): Promise<{ task: TaskRecord }> {
    const task = this.requireTask(taskId);
    const next = await this.store.upsert({
      ...task,
      title,
      updatedAt: new Date().toISOString(),
    });
    this.emit(taskId, "task.updated", { task: next });
    return { task: next };
  }

  private async archive(taskId: string): Promise<{ ok: true }> {
    const task = this.requireTask(taskId);
    if (this.supervisor.has(taskId)) {
      await this.supervisor.stop(taskId);
    }
    this.removeQueued(taskId);
    this.shells.dispose(taskId);
    const next = await this.store.upsert({
      ...task,
      status: "stopped",
      archivedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    if (this.activeTaskId === taskId) {
      this.activeTaskId = this.listTasks()[0]?.id ?? null;
    }
    this.emit(taskId, "task.archived", { taskId: next.id });
    await this.drainQueue();
    return { ok: true };
  }

  private async reorderTasks(cwd: string, taskIds: string[]): Promise<{ ok: true }> {
    const members = this.store
      .listVisible()
      .filter((task) => task.cwd === cwd)
      .map((task) => task.id);
    const wanted = new Set(taskIds);
    if (members.length !== wanted.size || members.some((id) => !wanted.has(id))) {
      throw new Error("会话列表已变化，请刷新后重试。");
    }
    await this.store.persistReorder(cwd, taskIds);
    this.emit("", "tasks.reordered", { cwd, taskIds });
    return { ok: true };
  }

  async activate(taskId: string): Promise<void> {
    const task = this.requireTask(taskId);
    this.activeTaskId = taskId;
    const next = await this.store.upsert({
      ...task,
      lastOpenedAt: new Date().toISOString(),
      unreadCount: 0,
    });
    this.emit(taskId, "task.updated", { task: next });
    if (this.supervisor.has(taskId)) {
      await this.refreshAvailableModels(taskId);
      void this.refreshStats(taskId);
      return;
    }
    const pendingBoot = this.booting.get(taskId);
    if (pendingBoot) return pendingBoot;
    if (this.processSlotsUsed() >= this.config.maxProcesses) {
      if (!this.queue.includes(taskId)) this.queue.push(taskId);
      await this.apply(taskId, "queued");
      return;
    }
    await this.startBoot(taskId);
  }

  private processSlotsUsed(): number {
    const pendingOnly = [...this.booting.keys()].filter((id) => !this.supervisor.has(id)).length;
    return this.supervisor.runningCount() + pendingOnly;
  }

  private async startBoot(taskId: string): Promise<void> {
    const pendingBoot = this.booting.get(taskId);
    if (pendingBoot) return pendingBoot;
    const boot = this.boot(taskId);
    this.booting.set(taskId, boot);
    try {
      await boot;
    } finally {
      this.booting.delete(taskId);
    }
  }

  private async boot(taskId: string): Promise<void> {
    await this.apply(taskId, this.store.get(taskId)?.status === "error" ? "restart" : "activate");
    try {
      const task = this.requireTask(taskId);
      const result = await this.supervisor.boot(task);
      const next = await this.store.upsert({
        ...this.requireTask(taskId),
        sessionPath: result.sessionPath,
        model: result.model,
        thinkingLevel: result.thinkingLevel,
        errorMessage: null,
        updatedAt: new Date().toISOString(),
      });
      await this.apply(taskId, "pi_ready");
      this.emit(taskId, "task.updated", { task: next });
      const runtime = this.supervisor.snapshot(taskId);
      if (runtime) {
        this.emit(taskId, "models.updated", this.modelsUpdatedPayload(runtime.models, runtime.thinkingLevels));
        this.emit(taskId, "commands.updated", { commands: runtime.commands });
        this.emit(taskId, "runtime.status", runtime.runtime);
        this.emit(taskId, "session.tree", {
          nodes: runtime.sessionTree,
          leafId: runtime.sessionLeafId,
        });
      }
      await this.emitResources(taskId);
      await this.refreshStats(taskId);
      await this.tryStartWorkItemsForTask(taskId);
    } catch (error) {
      const message = humanizeUserFacingError(error);
      await this.apply(taskId, "spawn_failed", message);
      throw new Error(message);
    }
  }

  private async prompt(
    taskId: string,
    message: string,
    imageIds: string[] | undefined,
    mode: "prompt" | "steer" | "follow_up",
    options?: { recordedRun?: boolean },
  ): Promise<{ ok: true }> {
    const task = this.requireTask(taskId);
    this.assertWorkLinkedPrompt(taskId, mode, options);
    if (task.status === "queued") {
      throw new Error("正在排队，请稍等。");
    }
    if (task.status === "stopped" || task.status === "error") {
      await this.activate(taskId);
    }
    const latest = this.requireTask(taskId);
    // Pi queues `follow_up` until a later `prompt`. After settle that queue never
    // drains, so idle "continue the conversation" must be sent as `prompt`.
    const rpcMode: "prompt" | "steer" | "follow_up" =
      mode === "follow_up" && latest.status === "idle" ? "prompt" : mode;
    if (rpcMode === "prompt" && isBusyStatus(latest.status)) {
      throw new Error("正在回复。直接发送即可补充。");
    }
    if (rpcMode === "steer" && latest.status !== "running" && latest.status !== "waiting_approval") {
      throw new Error("只有正在回复时才能补充这条消息。");
    }
    if (rpcMode === "follow_up" && latest.status !== "running" && latest.status !== "waiting_approval") {
      throw new Error("只有正在回复时才能排队下一条消息。");
    }
    if (!this.supervisor.has(taskId)) {
      throw new Error("AI 还没启动");
    }

    const uploaded = this.uploads.peek(imageIds ?? []);
    const images = uploaded.map((item) => ({
      type: "image",
      data: item.data.toString("base64"),
      mimeType: item.mimeType,
    }));
    const pendingImages = uploaded.map((item, index): TimelineImage => {
      const dataUrl = `data:${item.mimeType};base64,${item.data.toString("base64")}`;
      return {
        mimeType: item.mimeType,
        name: `图片 ${index + 1}`,
        ...(dataUrl.length <= 1_500_000 ? { dataUrl } : {}),
      };
    });
    if (pendingImages.length > 0) this.supervisor.setPendingImages(taskId, pendingImages);

    const expanded = await this.attachMentionedFiles(latest, message);
    const payload: Record<string, unknown> & { type: string } = {
      type: rpcMode,
      message: applyModePrefix(latest.mode ?? "agent", expanded),
    };
    if (images.length > 0) payload.images = images;

    try {
      await this.supervisor.rpcData(taskId, payload);
      this.uploads.consume(imageIds ?? []);
    } catch (error) {
      this.supervisor.setPendingImages(taskId, undefined);
      const raw = error instanceof Error ? error.message : String(error);
      const text = humanizeUserFacingError(error);
      const authHint = isMissingCredentialError(raw);
      this.emit(taskId, "server.error", {
        code: authHint ? "pi.auth" : "pi.prompt",
        message: authHint
          ? "连不上 AI 服务商。打开设置登录或粘贴密钥。轻舟不会显示完整密钥。"
          : text,
        authHint,
      });
      throw new Error(text);
    }

    if (rpcMode === "prompt") {
      await this.apply(taskId, "prompt_accepted");
      if (task.title === path.basename(task.cwd) || task.title === "New task" || task.title === "新对话") {
        const titled = await this.store.upsert({
          ...this.requireTask(taskId),
          title: message.trim().slice(0, 72) || task.title,
          updatedAt: new Date().toISOString(),
        });
        this.emit(taskId, "task.updated", { task: titled });
      }
    }
    return { ok: true };
  }

  private async editQueuedPrompt(
    taskId: string,
    payload: { kind: "steering" | "followUp"; index: number; previousMessage: string; message: string },
  ): Promise<{ ok: true }> {
    const task = this.requireTask(taskId);
    if (task.status !== "running" && task.status !== "waiting_approval") {
      throw new Error("只有正在回复时才能修改队列消息。");
    }
    if (!this.supervisor.has(taskId)) throw new Error("AI 还没启动");
    if (this.queueEdits.has(taskId)) throw new Error("队列正在更新，请稍后再试。");
    this.queueEdits.add(taskId);

    try {
      const cleared = (await this.supervisor.rpcData(taskId, { type: "clear_queue" })) as {
        steering?: unknown;
        followUp?: unknown;
      };
      const queues = {
        steering: Array.isArray(cleared.steering) ? cleared.steering.filter((item): item is string => typeof item === "string") : [],
        followUp: Array.isArray(cleared.followUp) ? cleared.followUp.filter((item): item is string => typeof item === "string") : [],
      };
      const target = queues[payload.kind];
      const unchanged = target[payload.index] === payload.previousMessage;
      if (unchanged) target[payload.index] = payload.message.trim();

      for (const message of queues.steering) {
        await this.supervisor.rpcData(taskId, { type: "steer", message });
      }
      for (const message of queues.followUp) {
        await this.supervisor.rpcData(taskId, { type: "follow_up", message });
      }
      if (!unchanged) throw new Error("这条消息已经发送或发生变化，请重新编辑。");
      return { ok: true };
    } finally {
      this.queueEdits.delete(taskId);
    }
  }

  private async attachMentionedFiles(task: TaskRecord, message: string): Promise<string> {
    const mentions = extractAtMentions(message).slice(0, 6);
    if (mentions.length === 0) return message;
    const parts = [message];
    for (const mention of mentions) {
      try {
        const preview = await previewProjectFile(mention, task.cwd, this.config.allowedRoots);
        const content = preview.content.slice(0, 80_000);
        parts.push(`\n\n---\nAttached file: ${mention}\n\`\`\`\n${content}\n\`\`\``);
        if (preview.truncated || preview.content.length > 80_000) {
          parts.push("\n[truncated]");
        }
      } catch {
        // Missing or out-of-policy paths stay as @mentions in the prompt.
      }
    }
    return parts.join("");
  }

  private async abort(taskId: string): Promise<{ ok: true }> {
    const task = this.requireTask(taskId);
    if (!isBusyStatus(task.status) && task.status !== "booting") {
      return { ok: true };
    }
    await this.apply(taskId, "abort");
    try {
      await this.supervisor.rpc(taskId, { type: "abort" });
    } catch {
      // Stay in aborting until Pi settles or the fallback timer fires.
    }
    this.scheduleAbortFallback(taskId);
    return { ok: true };
  }

  private scheduleAbortFallback(taskId: string): void {
    this.clearAbortFallback(taskId);
    this.abortFallback.set(
      taskId,
      setTimeout(() => {
        this.abortFallback.delete(taskId);
        const task = this.store.get(taskId);
        if (task?.status === "aborting") {
          void this.apply(taskId, "abort_confirmed");
        }
      }, TaskService.ABORT_CONFIRM_MS),
    );
  }

  private clearAbortFallback(taskId: string): void {
    const timer = this.abortFallback.get(taskId);
    if (timer) clearTimeout(timer);
    this.abortFallback.delete(taskId);
  }

  private async refreshTaskModel(taskId: string): Promise<void> {
    const state = (await this.supervisor.rpcData(taskId, { type: "get_state" })) as Record<string, unknown>;
    const modelObj = state.model as Record<string, unknown> | null;
    const next = await this.store.upsert({
      ...this.requireTask(taskId),
      model: modelObj
        ? {
            provider: String(modelObj.provider ?? "unknown"),
            id: String(modelObj.id ?? "unknown"),
            name: typeof modelObj.name === "string" ? modelObj.name : undefined,
          }
        : null,
      thinkingLevel: (state.thinkingLevel as TaskRecord["thinkingLevel"]) ?? "off",
      updatedAt: new Date().toISOString(),
    });
    this.emit(taskId, "task.updated", { task: next });
    const fastPatch: { fastModeEnabled?: boolean; fastModeActive?: boolean } = {};
    if (typeof state.fastModeEnabled === "boolean") fastPatch.fastModeEnabled = state.fastModeEnabled;
    if (typeof state.fastModeActive === "boolean") fastPatch.fastModeActive = state.fastModeActive;
    if (Object.keys(fastPatch).length > 0) {
      this.supervisor.patchRuntime(taskId, fastPatch);
    }
    await this.refreshAvailableModels(taskId);
  }

  private resolveDefaultModel(provider: string, id: string): ModelRef {
    for (const task of this.listTasks()) {
      const models = this.supervisor.snapshot(task.id)?.models ?? [];
      const found = models.find((model) => model.provider === provider && model.id === id);
      if (found) return { provider: found.provider, id: found.id, name: found.name };
    }
    return { provider, id };
  }

  private modelsUpdatedPayload(models: ModelRef[], thinkingLevels: TaskRecord["thinkingLevel"][]): {
    models: ModelRef[];
    thinkingLevels: TaskRecord["thinkingLevel"][];
    defaultModel: ModelRef | null;
  } {
    return { models, thinkingLevels, defaultModel: this.defaultModel };
  }

  private emitModelsUpdated(taskId: string, models?: ModelRef[], thinkingLevels?: TaskRecord["thinkingLevel"][]): void {
    const runtime = this.supervisor.snapshot(taskId);
    this.emit(taskId, "models.updated", this.modelsUpdatedPayload(
      models ?? runtime?.models ?? [],
      thinkingLevels ?? runtime?.thinkingLevels ?? ["off"],
    ));
  }

  private async refreshAvailableModels(taskId: string): Promise<void> {
    if (!this.supervisor.has(taskId)) return;
    const { models, thinkingLevels } = await this.supervisor.refreshAvailableModels(taskId);
    this.emitModelsUpdated(taskId, models, thinkingLevels);
  }

  private async refreshStats(taskId: string): Promise<void> {
    const runtime = this.supervisor.snapshot(taskId);
    let raw: unknown = null;
    try {
      raw = await this.supervisor.rpcData(taskId, { type: "get_session_stats" });
    } catch {
      // Stats RPC is optional on older Pi builds.
    }
    const stats = normalizeSessionStats(raw, {
      totalMessages: runtime?.messages.length,
      toolCalls: runtime?.tools.length,
      contextWindow: runtime?.models.find((model) => model.contextWindow)?.contextWindow,
    });
    this.supervisor.setStats(taskId, stats);
    this.emit(taskId, "session.stats", { stats });
  }

  private async fileTree(taskId: string): Promise<{ entries: Array<{ path: string; name: string; kind: "file" | "dir" }> }> {
    const task = this.requireTask(taskId);
    const entries = await listProjectFiles(task.cwd);
    this.emit(taskId, "files.tree", { entries });
    return { entries };
  }

  private async filePreview(taskId: string, relativePath: string): Promise<void> {
    const task = this.requireTask(taskId);
    const preview = await previewProjectFile(relativePath, task.cwd, this.config.allowedRoots);
    this.emit(taskId, "files.preview", preview);
  }

  private async setPolicy(
    taskId: string,
    mode: TaskRecord["mode"],
    approvalPolicy: TaskRecord["approvalPolicy"],
  ): Promise<{ task: TaskRecord }> {
    const task = this.requireTask(taskId);
    const next = await this.store.upsert({
      ...task,
      mode,
      approvalPolicy,
      updatedAt: new Date().toISOString(),
    });
    this.emit(taskId, "task.updated", { task: next });
    return { task: next };
  }

  private async respondApproval(
    taskId: string,
    requestId: string,
    allow: boolean,
    remember?: boolean,
  ): Promise<{ ok: true }> {
    const pending = this.supervisor.getApproval(requestId);
    if (allow && pending) {
      await this.checkpointMutation(taskId, pending);
      if (remember) await this.remembered.remember(pending);
    }
    const ok = this.supervisor.respondApproval(requestId, allow);
    if (!ok) throw new Error("这条确认已经失效");
    return { ok: true };
  }

  private async applyStoredPolicy(taskId: string, approval: import("@qingzhou/protocol").ApprovalRequest): Promise<void> {
    const task = this.store.get(taskId);
    if (!task) return;
    const policy = effectiveApprovalPolicy(task.mode ?? "agent", task.approvalPolicy ?? "auto");
    let decision = approvalDecision(policy, approval);
    if (decision === null && this.remembered.match(approval)) decision = true;
    if (decision === null) return;
    if (decision) await this.checkpointMutation(taskId, approval);
    this.supervisor.respondApproval(approval.requestId, decision);
  }

  private async checkpointMutation(
    taskId: string,
    approval: import("@qingzhou/protocol").ApprovalRequest,
  ): Promise<void> {
    if (approval.toolName !== "write" && approval.toolName !== "edit") return;
    const task = this.store.get(taskId);
    if (!task) return;
    await this.checkpoints.save(taskId, task.cwd, approval.target, approval.toolName);
    await this.emitCheckpoints(taskId);
  }

  private async emitCheckpoints(taskId: string): Promise<{ checkpoints: Awaited<ReturnType<CheckpointStore["list"]>> }> {
    const checkpoints = await this.checkpoints.list(taskId);
    this.emit(taskId, "checkpoints.updated", { checkpoints });
    return { checkpoints };
  }

  private async restoreCheckpoint(
    taskId: string,
    payload: { checkpointId?: string; path?: string },
  ): Promise<{ ok: true }> {
    const task = this.requireTask(taskId);
    if (payload.checkpointId) {
      await this.checkpoints.restore(taskId, payload.checkpointId, task.cwd);
    } else if (payload.path) {
      await this.checkpoints.restoreLatestByPath(taskId, payload.path, task.cwd);
    } else {
      throw new Error("请选择检查点或文件路径");
    }
    await this.emitCheckpoints(taskId);
    await this.emitGitStatus(taskId);
    return { ok: true };
  }

  private async emitGitStatus(taskId: string): Promise<{ git: Awaited<ReturnType<typeof readGitStatus>> }> {
    const task = this.requireTask(taskId);
    const git = await readGitStatus(task.cwd);
    this.emit(taskId, "git.status", git);
    return { git };
  }

  private runTerm(taskId: string, command: string): { ok: true } {
    const task = this.requireTask(taskId);
    this.shells.run(taskId, {
      cwd: task.cwd,
      command,
      onChunk: (text) => this.emit(taskId, "term.chunk", { text }),
      onExit: (code, signal) => this.emit(taskId, "term.exit", { code, signal }),
    });
    return { ok: true };
  }

  private startTerm(taskId: string, payload?: { cols?: number; rows?: number }): { ok: true; shell: string; pid: number } {
    const task = this.requireTask(taskId);
    const result = this.shells.startTerminal(taskId, {
      cwd: task.cwd,
      cols: payload?.cols,
      rows: payload?.rows,
      onChunk: (text) => this.emit(taskId, "term.chunk", { text }),
      onExit: (code, signal) => this.emit(taskId, "term.exit", { code, signal }),
    });
    this.emit(taskId, "term.ready", { shell: result.shell, cwd: task.cwd, pid: result.pid });
    return { ok: true, ...result };
  }

  private inputTerm(taskId: string, data: string): { ok: true } {
    this.requireTask(taskId);
    if (!this.shells.writeTerminal(taskId, data)) {
      throw new Error("终端还没有启动。");
    }
    return { ok: true };
  }

  private resizeTerm(taskId: string, cols: number, rows: number): { ok: true } {
    this.requireTask(taskId);
    if (!this.shells.resizeTerminal(taskId, cols, rows)) {
      throw new Error("终端还没有启动。");
    }
    return { ok: true };
  }

  private closeTerm(taskId: string): { ok: true } {
    this.requireTask(taskId);
    this.shells.dispose(taskId);
    return { ok: true };
  }

  private interruptTerm(taskId: string): { ok: true } {
    this.requireTask(taskId);
    this.shells.interrupt(taskId);
    return { ok: true };
  }

  private async openNativeTerm(taskId: string): Promise<{ ok: true }> {
    const task = this.requireTask(taskId);
    await openNativeTerminal(task.cwd);
    return { ok: true };
  }

  private async emitGitDiff(taskId: string): Promise<{ diff: string }> {
    const task = this.requireTask(taskId);
    const diff = (await readGitDiff(task.cwd)) ?? "";
    this.gitDiffs.set(taskId, diff);
    this.emit(taskId, "git.diff", { diff });
    return { diff };
  }

  private async commitTaskGit(taskId: string, message: string, push?: boolean): Promise<{ ok: true }> {
    const task = this.requireTask(taskId);
    await commitGit(task.cwd, message);
    if (push) await pushGit(task.cwd);
    await this.emitGitStatus(taskId);
    await this.emitGitDiff(taskId);
    return { ok: true };
  }

  private async restoreTaskGit(taskId: string, filePath?: string): Promise<{ ok: true }> {
    const task = this.requireTask(taskId);
    if (filePath) {
      const relative = assertGitRelativePath(filePath);
      await resolveAllowedPath(relative, task.cwd, this.config.allowedRoots);
      await restoreGit(task.cwd, relative);
    } else {
      await restoreGit(task.cwd);
    }
    await this.emitGitStatus(taskId);
    await this.emitGitDiff(taskId);
    return { ok: true };
  }

  private async initTaskGit(taskId: string): Promise<{ git: Awaited<ReturnType<typeof readGitStatus>> }> {
    const task = this.requireTask(taskId);
    const git = await initGit(task.cwd);
    this.emit(taskId, "git.status", git);
    await this.emitGitDiff(taskId);
    return { git };
  }

  private async reloadResources(taskId: string): Promise<PiResources> {
    this.requireTask(taskId);
    if (this.supervisor.has(taskId)) {
      try {
        await this.supervisor.rpcData(taskId, { type: "reload_skills" });
      } catch {
        // Optional on fake-pi / older Pi builds.
      }
    }
    const resources = await this.emitResources(taskId);
    await this.emitCommands(taskId);
    return resources;
  }

  private async createAgentsFile(taskId: string): Promise<{ path: string; resources: PiResources }> {
    const task = this.requireTask(taskId);
    const relative = await createProjectAgentsFile(task.cwd);
    const resources = await this.reloadResources(taskId);
    await this.filePreview(taskId, relative);
    return { path: relative, resources };
  }

  private async resolveKnownContextFile(taskId: string, inputPath: string): Promise<string> {
    const task = this.requireTask(taskId);
    const resources = this.resources.get(taskId) ?? (await this.emitResources(taskId));
    const resolved = path.resolve(inputPath);
    const known = resources.agentsFiles.some((item) => path.resolve(item.path) === resolved);
    if (!known) throw new Error("只能打开已加载的约定文件");
    if (isProtectedWriteTarget(resolved)) throw new Error("这个文件不能改");
    const roots = [task.cwd, this.config.homeDir, this.config.piAgentDir, ...this.config.allowedRoots];
    if (!roots.some((root) => isInsideRoot(resolved, path.resolve(root)))) {
      throw new Error("约定文件超出允许范围");
    }
    return resolved;
  }

  private async readResourceFile(
    taskId: string,
    inputPath: string,
  ): Promise<{ path: string; content: string; truncated: boolean }> {
    this.requireTask(taskId);
    const resolved = await this.resolveKnownContextFile(taskId, inputPath);
    const preview = await readContextFile(resolved);
    return { path: resolved, ...preview };
  }

  private async writeResourceFile(
    taskId: string,
    inputPath: string,
    content: string,
  ): Promise<{ ok: true }> {
    this.requireTask(taskId);
    const resolved = await this.resolveKnownContextFile(taskId, inputPath);
    await writeContextFile(resolved, content);
    await this.reloadResources(taskId);
    return { ok: true };
  }

  private async checkResourceSkillUpdates(taskId: string, paths?: string[]): Promise<SkillUpdateCheckResult> {
    const task = this.requireTask(taskId);
    await this.reloadResources(taskId);
    const resources = this.resources.get(taskId) ?? (await this.emitResources(taskId));
    return checkSystemSkillUpdates({
      skills: resources.skills,
      homeDir: this.config.homeDir,
      cwd: task.cwd,
      paths,
    });
  }

  private async updateResourceSkills(taskId: string, paths?: string[]): Promise<SkillUpdateApplyResult> {
    const task = this.requireTask(taskId);
    const resources = this.resources.get(taskId) ?? (await this.emitResources(taskId));
    const result = await applySystemSkillUpdates({
      skills: resources.skills,
      homeDir: this.config.homeDir,
      cwd: task.cwd,
      paths,
    });
    if (result.updated.length > 0) await this.reloadResources(taskId);
    return result;
  }

  private async setResourceSkill(
    taskId: string,
    skillMdPath: string,
    enabled: boolean,
  ): Promise<{ ok: true }> {
    const task = this.requireTask(taskId);
    const resources = this.resources.get(taskId) ?? (await this.emitResources(taskId));
    const skill = resources.skills.find((item) => path.resolve(item.path) === path.resolve(skillMdPath));
    if (!skill) throw new Error("找不到这个技能");
    await setSkillEnabled({
      skillMdPath: skill.path,
      enabled,
      cwd: task.cwd,
      homeDir: this.config.homeDir,
      agentDir: this.config.piAgentDir,
      scope: skill.scope,
    });
    await this.reloadResources(taskId);
    return { ok: true };
  }

  private async setResourceExtension(
    taskId: string,
    extensionPath: string,
    enabled: boolean,
  ): Promise<{ ok: true }> {
    const task = this.requireTask(taskId);
    const resources = this.resources.get(taskId) ?? (await this.emitResources(taskId));
    const extension = resources.extensions.find((item) => path.resolve(item.path) === path.resolve(extensionPath));
    if (!extension) throw new Error("找不到这个插件");
    await setExtensionEnabled({
      extensionPath: extension.path,
      enabled,
      cwd: task.cwd,
      homeDir: this.config.homeDir,
      agentDir: this.config.piAgentDir,
      scope: extension.scope,
    });
    await this.reloadResources(taskId);
    return { ok: true };
  }

  private async installResourcePackages(
    taskId: string,
    ids?: string[],
  ): Promise<{
    ok: true;
    installed: string[];
    already: string[];
    piInstallError: string | null;
    resources: PiResources;
  }> {
    this.requireTask(taskId);
    const resources = this.resources.get(taskId) ?? (await this.emitResources(taskId));
    const result = await installPresetPiPackages({
      agentDir: this.config.piAgentDir,
      ids,
      packages: resources.packages,
      extensions: resources.extensions,
      piCommand: this.config.piCommand,
      prefixArgs: this.config.piPrefixArgs,
      extraEnv: this.config.piExtraEnv,
    });
    const next = await this.emitResources(taskId);
    void this.reloadResources(taskId).catch(() => undefined);
    if (result.piInstallError) throw new Error(result.piInstallError);
    return {
      ok: true,
      installed: result.installed,
      already: result.already,
      piInstallError: result.piInstallError,
      resources: next,
    };
  }

  private async openFile(taskId: string, relativePath: string): Promise<{ path: string }> {
    const task = this.requireTask(taskId);
    const resolved = await resolveAllowedPath(relativePath, task.cwd, this.config.allowedRoots);
    await this.filePreview(taskId, relativePath);
    return { path: resolved };
  }

  private async respondInteraction(
    taskId: string,
    requestId: string,
    cancelled?: boolean,
    value?: string,
  ): Promise<{ ok: true }> {
    this.requireTask(taskId);
    const ok = this.supervisor.respondInteraction(requestId, { cancelled, value });
    if (!ok) throw new Error("这条询问已经失效");
    return { ok: true };
  }

  private async emitCommands(taskId: string): Promise<{ commands: Array<{ name: string; description?: string; source?: string }> }> {
    const commands = await this.refreshCommands(taskId);
    this.emit(taskId, "commands.updated", { commands });
    return { commands };
  }

  private async refreshCommands(
    taskId: string,
  ): Promise<Array<{ name: string; description?: string; source?: string }>> {
    if (!this.supervisor.has(taskId)) return [];
    try {
      const data = (await this.supervisor.rpcData(taskId, { type: "get_commands" })) as {
        commands?: Array<{ name?: string; description?: string; source?: string }>;
      };
      const commands = (data.commands ?? [])
        .filter((item) => item.name)
        .map((item) => ({
          name: String(item.name),
          description: item.description,
          source: item.source,
        }));
      this.supervisor.setCommands(taskId, commands);
      return commands;
    } catch {
      return this.supervisor.snapshot(taskId)?.commands ?? [];
    }
  }

  private async forkSession(
    taskId: string,
    messageId: string,
    message?: string,
  ): Promise<{ ok: true; text?: string }> {
    this.assertWorkSessionNotRewritten(taskId);
    const task = this.requireTask(taskId);
    const runtime = this.supervisor.snapshot(taskId);
    const selected = runtime?.messages.find((item) => item.id === messageId);
    if (!selected || selected.role !== "user") {
      throw new Error("只能从你自己的消息重新来过");
    }
    if (isBusyStatus(task.status)) {
      throw new Error("正在回复，先停止再重试。");
    }
    const forks = (await this.supervisor.rpcData(taskId, { type: "get_fork_messages" })) as {
      messages?: Array<{ entryId?: string; text?: string }>;
    };
    const wanted = stripModePrefix(selected.text).trim();
    const match = (forks.messages ?? []).find((item) => stripModePrefix(item.text ?? "").trim() === wanted);
    if (!match?.entryId) {
      throw new Error("Pi 里找不到这条消息，没法从这里分叉。");
    }
    const result = (await this.supervisor.rpcData(taskId, { type: "fork", entryId: match.entryId })) as {
      cancelled?: boolean;
      text?: string;
    };
    if (result.cancelled) throw new Error("这次分叉被取消了");
    const messages = (await this.supervisor.rpcData(taskId, { type: "get_messages" })) as { messages?: unknown[] };
    this.supervisor.replaceMessages(taskId, piMessagesToTimeline(messages.messages ?? []));
    await this.supervisor.refreshSessionTree(taskId);
    this.supervisor.syncModelChangeNotices(taskId);
    this.emit(taskId, "snapshot", this.buildSnapshot(taskId));
    if (message?.trim()) {
      await this.prompt(taskId, message, undefined, "prompt");
    }
    return { ok: true, text: result.text };
  }

  private async emitSessionTree(
    taskId: string,
  ): Promise<{ nodes: Awaited<ReturnType<ProcessSupervisor["refreshSessionTree"]>>["nodes"]; leafId: string | null }> {
    this.requireTask(taskId);
    const tree = await this.supervisor.refreshSessionTree(taskId);
    this.emit(taskId, "session.tree", tree);
    return tree;
  }

  private async branchSession(taskId: string, entryId: string, message?: string): Promise<{ ok: true; text?: string }> {
    this.assertWorkSessionNotRewritten(taskId);
    const task = this.requireTask(taskId);
    if (isBusyStatus(task.status)) {
      throw new Error("正在回复，先停止再从这里分叉。");
    }
    const result = (await this.supervisor.rpcData(taskId, { type: "fork", entryId })) as {
      cancelled?: boolean;
      text?: string;
    };
    if (result.cancelled) throw new Error("这次分叉被取消了");
    const messages = (await this.supervisor.rpcData(taskId, { type: "get_messages" })) as { messages?: unknown[] };
    this.supervisor.replaceMessages(taskId, piMessagesToTimeline(messages.messages ?? []));
    await this.emitSessionTree(taskId);
    this.supervisor.syncModelChangeNotices(taskId);
    this.emit(taskId, "snapshot", this.buildSnapshot(taskId));
    if (message?.trim()) {
      await this.prompt(taskId, message, undefined, "prompt");
    }
    return { ok: true, text: result.text };
  }

  private async listSessions(cwd?: string): Promise<{ sessions: Awaited<ReturnType<typeof listPiSessions>> }> {
    const sessions = await listPiSessions(this.config.homeDir, cwd, this.config.piAgentDir);
    this.emit("", "sessions.listed", { sessions });
    return { sessions };
  }

  private async resumeSession(
    sessionPath: string,
    cwd?: string,
    title?: string,
  ): Promise<{ task: TaskRecord }> {
    const allowed = [
      piSessionsRoot(this.config.homeDir, this.config.piAgentDir),
      path.join(this.config.dataDir, "sessions"),
      ...this.config.allowedRoots,
    ];
    const resolvedSession = assertPiSessionPath(sessionPath, allowed);
    const listed = await listPiSessions(this.config.homeDir, undefined, this.config.piAgentDir);
    const match = listed.find((item) => path.resolve(item.path) === resolvedSession);
    const workspace = cwd?.trim() || match?.cwd;
    if (!workspace) {
      throw new Error("这个会话没有工作文件夹，请先选一个再恢复。");
    }
    const resolvedCwd = await assertAllowedCwd(workspace, this.cwdRoots());
    this.adoptAllowedRoot(resolvedCwd);
    return this.createTask(resolvedCwd, title || match?.name || match?.preview || "恢复的对话", resolvedSession);
  }

  private async exportSession(taskId: string): Promise<{ path: string }> {
    this.requireTask(taskId);
    const data = (await this.supervisor.rpcData(taskId, { type: "export_html" })) as { path?: string };
    if (!data.path) throw new Error("导出失败");
    return { path: data.path };
  }

  private async emitResources(taskId: string): Promise<PiResources> {
    const task = this.requireTask(taskId);
    const resources = await scanPiResources(
      task.cwd,
      this.config.homeDir,
      this.config.trustProject,
      this.config.piAgentDir,
    );
    this.resources.set(taskId, resources);
    this.emit(taskId, "resources.updated", resources);
    return resources;
  }

  async refreshResources(): Promise<void> {
    const taskId = this.activeTaskId;
    if (!taskId || !this.store.get(taskId)) return;
    try {
      await this.emitResources(taskId);
    } catch {
      // Resources are optional for the inspector.
    }
  }

  private async setRuntime(
    taskId: string,
    payload: { autoCompaction?: boolean; autoRetry?: boolean; fastMode?: boolean },
  ): Promise<{ ok: true }> {
    this.requireTask(taskId);
    if (payload.autoCompaction != null) {
      await this.supervisor.rpcData(taskId, {
        type: "set_auto_compaction",
        enabled: payload.autoCompaction,
      });
    }
    if (payload.autoRetry != null) {
      await this.supervisor.rpcData(taskId, {
        type: "set_auto_retry",
        enabled: payload.autoRetry,
      });
    }
    const patch: {
      autoCompaction?: boolean;
      autoRetry?: boolean;
      fastModeEnabled?: boolean;
      fastModeActive?: boolean;
    } = {};
    if (payload.autoCompaction != null) patch.autoCompaction = payload.autoCompaction;
    if (payload.autoRetry != null) patch.autoRetry = payload.autoRetry;
    if (payload.fastMode != null) {
      try {
        const data = (await this.supervisor.rpcData(taskId, {
          type: "set_fast_mode",
          enabled: payload.fastMode,
        })) as { enabled?: unknown; active?: unknown } | undefined;
        patch.fastModeEnabled = typeof data?.enabled === "boolean" ? data.enabled : payload.fastMode;
        patch.fastModeActive = typeof data?.active === "boolean" ? data.active : payload.fastMode;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/unavailable|unknown command|not found|unsupported|does not exist/i.test(message)) {
          throw new Error("当前模型不支持 Fast 模式。");
        }
        throw error;
      }
    }
    this.supervisor.patchRuntime(taskId, patch);
    return { ok: true };
  }

  private async cloneSession(taskId: string): Promise<{ task: TaskRecord }> {
    this.assertWorkSessionNotRewritten(taskId);
    const task = this.requireTask(taskId);
    const now = new Date().toISOString();
    const nextId = randomUUID();
    let sessionPath: string | null = null;
    if (task.sessionPath) {
      const sessionDir = path.join(this.config.dataDir, "sessions", nextId);
      await mkdir(sessionDir, { recursive: true });
      sessionPath = path.join(sessionDir, path.basename(task.sessionPath));
      await copyFile(task.sessionPath, sessionPath);
    }
    const cloned: TaskRecord = {
      ...task,
      id: nextId,
      title: `${task.title}（副本）`,
      sessionPath,
      status: "stopped",
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
      archivedAt: null,
      unreadCount: 0,
      errorMessage: null,
    };
    await this.store.upsert(cloned);
    this.activeTaskId = cloned.id;
    this.emit(cloned.id, "task.created", { task: cloned });
    try {
      await this.activate(cloned.id);
    } catch {
      // Keep the cloned task even if Pi is unavailable.
    }
    return { task: this.store.get(cloned.id) ?? cloned };
  }

  private async handleUnexpectedExit(taskId: string, generation: number, error: string): Promise<void> {
    if (this.supervisor.getGeneration(taskId) !== generation && this.supervisor.has(taskId)) {
      return;
    }
    await this.supervisor.stop(taskId, "SIGKILL");
    await this.apply(taskId, "pi_exit", error);
    await this.drainQueue();
  }

  private async drainQueue(): Promise<void> {
    while (this.queue.length > 0 && this.processSlotsUsed() < this.config.maxProcesses) {
      const nextId = this.queue.shift();
      if (!nextId) break;
      const task = this.store.get(nextId);
      if (!task || task.archivedAt) continue;
      try {
        await this.startBoot(nextId);
      } catch {
        // boot records error state
      }
    }
  }

  private removeQueued(taskId: string): void {
    const index = this.queue.indexOf(taskId);
    if (index >= 0) this.queue.splice(index, 1);
  }

  private async markUnread(taskId: string): Promise<void> {
    if (this.activeTaskId === taskId) return;
    const task = this.store.get(taskId);
    if (!task) return;
    const next = await this.store.upsert({
      ...task,
      unreadCount: task.unreadCount + 1,
      updatedAt: new Date().toISOString(),
    });
    this.emit(taskId, "task.updated", { task: next });
  }

  private async apply(
    taskId: string,
    event: Parameters<typeof transition>[1],
    errorMessage?: string,
  ): Promise<TaskRecord> {
    const task = this.requireTask(taskId);
    if (!canTransition(task.status, event)) {
      return task;
    }
    const status = transition(task.status, event);
    if (task.status === "aborting" && status !== "aborting") {
      this.clearAbortFallback(taskId);
    }
    const next = await this.store.upsert({
      ...task,
      status,
      errorMessage: status === "error" ? errorMessage ?? task.errorMessage ?? "Pi error" : null,
      updatedAt: new Date().toISOString(),
    });
    this.emit(taskId, "agent.status", { status: next.status, errorMessage: next.errorMessage ?? null });
    this.emit(taskId, "task.updated", { task: next });
    if (next.status === "error") {
      const run = this.workItems.activeRunForTask(taskId);
      if (run) {
        await this.workItems.updateRun(run.id, {
          status: "failed",
          errorMessage: next.errorMessage ?? "执行失败",
        });
        this.emitWorkItems();
      }
    } else if (event === "abort_confirmed") {
      await this.syncActiveWorkRun(taskId, "aborted");
    }
    if (event === "agent_settled") {
      void this.refreshStats(taskId);
      if (
        (task.status === "running" || task.status === "waiting_approval") &&
        this.workItems.findByTaskId(taskId).length === 0
      ) {
        this.emit(taskId, "notification.shown", { message: "回复完成", notifyType: "info" });
      }
      void this.onWorkItemSettled(taskId);
    }
    if (next.status === "error" && next.errorMessage) {
      // Banner + toast: server.error sticks in the workbench; notification is OS/toast.
      this.emit(taskId, "server.error", { code: "task.error", message: next.errorMessage });
      this.emit(taskId, "notification.shown", { message: next.errorMessage, notifyType: "error" });
    }
    return next;
  }

  private requireTask(taskId: string): TaskRecord {
    const task = this.store.get(taskId);
    if (!task || task.archivedAt) {
      throw new Error("找不到这个对话");
    }
    return task;
  }

  private assertWorkLinkedPrompt(
    taskId: string,
    mode: "prompt" | "steer" | "follow_up",
    options?: { recordedRun?: boolean },
  ): void {
    const message = workLinkedPromptError(
      this.workItems.findByTaskId(taskId),
      this.workItems.activeRunForTask(taskId),
      mode,
      options,
    );
    if (message) throw new Error(message);
  }

  private assertWorkSessionNotRewritten(taskId: string): void {
    const message = workLinkedSessionRewriteError(this.workItems.findByTaskId(taskId));
    if (message) throw new Error(message);
  }

  private emitWorkItems(): {
    items: ReturnType<WorkItemStore["list"]>;
    projects: ReturnType<WorkItemStore["listProjects"]>;
    activeProjectId: string | null;
  } {
    const payload = {
      items: this.workItems.list(),
      projects: this.workItems.listProjects(),
      activeProjectId: this.workItems.getActiveProjectId(),
    };
    this.emit("", "workItems.updated", payload);
    return payload;
  }

  private async createWorkProject(name: string, cwd: string): Promise<{ project: ReturnType<WorkItemStore["listProjects"]>[number] }> {
    const resolved = await assertAllowedCwd(cwd, this.cwdRoots());
    this.adoptAllowedRoot(resolved);
    const project = await this.workItems.createProject({ name, cwd: resolved });
    this.emitWorkItems();
    return { project };
  }

  private async selectWorkProject(id: string): Promise<{ project: ReturnType<WorkItemStore["listProjects"]>[number] }> {
    const project = await this.workItems.selectProject(id);
    this.emitWorkItems();
    return { project };
  }

  private async createWorkItem(
    title: string,
    description: string | undefined,
    acceptanceCriteria: string | undefined,
    cwd: string | undefined,
    projectId?: string,
    start = false,
  ): Promise<{ item: WorkItem }> {
    let project = projectId ? this.workItems.getProject(projectId) : undefined;
    if (projectId && !project) throw new Error("找不到这个项目");
    if (!project && cwd) {
      const resolved = await assertAllowedCwd(cwd, this.cwdRoots());
      this.adoptAllowedRoot(resolved);
      project =
        this.workItems.findProjectByCwd(resolved) ??
        (await this.workItems.createProject({ name: path.basename(resolved) || resolved, cwd: resolved }));
    }
    if (!project) {
      const activeId = this.workItems.getActiveProjectId();
      project = activeId ? this.workItems.getProject(activeId) : undefined;
    }
    if (!project) throw new Error("请先启动一个项目");
    const resolved = await assertAllowedCwd(project.cwd, this.cwdRoots());
    this.adoptAllowedRoot(resolved);
    const item = await this.workItems.create({
      title,
      description,
      acceptanceCriteria,
      cwd: resolved,
      projectId: project.id,
    });
    this.emitWorkItems();
    if (start) return this.startWorkItem(item.id, "initial");
    return { item: this.workItems.get(item.id) ?? item };
  }

  private async updateWorkItem(
    id: string,
    title?: string,
    description?: string,
    acceptanceCriteria?: string,
  ): Promise<{ item: WorkItem }> {
    const item = await this.workItems.update(id, { title, description, acceptanceCriteria });
    this.emitWorkItems();
    return { item };
  }

  private workItemDetails(id: string): ReturnType<WorkItemStore["getDetails"]> {
    const details = this.workItems.getDetails(id);
    if (!details) throw new Error("找不到这个目标");
    return details;
  }

  private async feedbackWorkItem(id: string, text: string): Promise<{ item: WorkItem }> {
    const item = this.workItems.get(id);
    if (!item) throw new Error("找不到这个目标");
    if (workItemIsClosed(item.state)) throw new Error("这个目标已经结束，请先重新打开。");
    if (item.taskId && this.workItems.activeRunForTask(item.taskId)) {
      throw new Error("这个目标正在执行，请在完整对话中直接补充。");
    }
    await this.workItems.addFeedback(id, text);
    this.emitWorkItems();
    return this.startWorkItem(id, "feedback", workItemFeedbackPrompt(item, text));
  }

  private async startWorkItem(
    id: string,
    kind: WorkRunKind,
    explicitInstruction?: string,
  ): Promise<{ item: WorkItem }> {
    const item = this.workItems.get(id);
    if (!item) throw new Error("找不到这个目标");
    if (workItemIsClosed(item.state)) throw new Error("这个目标已经结束，请先重新打开。");
    if (item.taskId && this.workItems.activeRunForTask(item.taskId)) {
      throw new Error("这个目标已经在执行。");
    }
    let taskId = item.taskId;
    if (!taskId || !this.store.get(taskId) || this.store.get(taskId)?.archivedAt) {
      taskId = (await this.createTask(item.cwd, item.title)).task.id;
    } else {
      try {
        await this.activate(taskId);
      } catch {
        // The run below records the boot failure and remains recoverable.
      }
    }
    const feedback = this.workItems.listFeedback(id).filter((entry) => !entry.deliveredAt);
    const instruction =
      explicitInstruction ??
      workItemPrompt({
        title: item.title,
        description: item.description,
        acceptanceCriteria: item.acceptanceCriteria,
        feedback,
      });
    const run = await this.workItems.createRun({ objectiveId: id, taskId, kind, instruction });
    this.emitWorkItems();
    const task = this.store.get(taskId);
    if (task?.status === "error") {
      await this.workItems.updateRun(run.id, {
        status: "failed",
        errorMessage: task.errorMessage ?? "AI 启动失败",
      });
      this.emitWorkItems();
    } else {
      await this.tryStartWorkItemsForTask(taskId);
    }
    return { item: this.workItems.get(id) ?? item };
  }

  private async stopWorkItem(id: string): Promise<{ item: WorkItem }> {
    const item = this.workItems.get(id);
    if (!item) throw new Error("找不到这个目标");
    if (!item.taskId) return { item };
    const task = this.store.get(item.taskId);
    if (task?.status === "queued") {
      this.removeQueued(item.taskId);
      await this.apply(item.taskId, "dequeue");
    } else if (task && (isBusyStatus(task.status) || task.status === "booting")) {
      await this.abort(item.taskId);
    }
    const run = this.workItems.activeRunForTask(item.taskId);
    if (run) await this.workItems.updateRun(run.id, { status: "aborted" });
    this.emitWorkItems();
    return { item: this.workItems.get(id) ?? item };
  }

  private async setWorkItemState(id: string, state: "open" | "completed" | "archived"): Promise<{ item: WorkItem }> {
    const item = this.workItems.get(id);
    if (!item) throw new Error("找不到这个目标");
    if (state === "completed" && item.taskId && this.workItems.activeRunForTask(item.taskId)) {
      throw new Error("Agent 还在执行，请先停止或等待本轮结束。");
    }
    if (state === "archived" && item.taskId && this.workItems.activeRunForTask(item.taskId)) {
      await this.stopWorkItem(id);
    }
    const next = await this.workItems.setState(id, state);
    this.emitWorkItems();
    return { item: next };
  }

  private async reorderWorkItem(id: string, beforeId?: string | null): Promise<{ item: WorkItem }> {
    const item = await this.workItems.reorder(id, beforeId);
    this.emitWorkItems();
    return { item };
  }

  private async legacyMoveWorkItem(
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

  private async tryStartWorkItemsForTask(taskId: string): Promise<void> {
    const task = this.store.get(taskId);
    if (!task || task.archivedAt) return;
    if (task.status === "queued" || task.status === "booting") return;
    if (!this.supervisor.has(taskId) || task.status !== "idle") return;
    const run = this.workItems.activeRunForTask(taskId);
    if (!run || run.status !== "queued") return;
    try {
      await this.prompt(taskId, run.instruction, undefined, "prompt", { recordedRun: true });
      await this.workItems.updateRun(run.id, { status: "running" });
      const feedbackIds = this.workItems
        .listFeedback(run.objectiveId)
        .filter((entry) => !entry.deliveredAt)
        .map((entry) => entry.id);
      if (feedbackIds.length > 0) await this.workItems.markFeedbackDelivered(feedbackIds, run.id);
      this.emitWorkItems();
    } catch (error) {
      const message = humanizeUserFacingError(error);
      await this.workItems.updateRun(run.id, { status: "failed", errorMessage: message });
      this.emitWorkItems();
      this.emit(taskId, "server.error", { code: "workItem.run", message });
    }
  }

  private async onWorkItemSettled(taskId: string): Promise<void> {
    const task = this.store.get(taskId);
    if (!task || task.status === "error") return;
    const run = this.workItems.activeRunForTask(taskId);
    if (run) {
      const messages = this.supervisor.snapshot(taskId)?.messages ?? [];
      const result = [...messages].reverse().find((message) => message.role === "assistant" && message.text.trim());
      await this.workItems.updateRun(run.id, {
        status: "succeeded",
        resultSummary: result ? summarizeWorkResult(result.text) : "本轮执行已结束，请打开对话检查结果。",
        resultMessageId: result?.id ?? null,
      });
      this.emitWorkItems();
      const item = this.workItems.get(run.objectiveId);
      this.emit(taskId, "notification.shown", {
        message: item ? `“${item.title}”已完成一轮执行，等待你验收。` : "工作目标等待验收。",
        notifyType: "info",
      });
    }
    await this.tryStartWorkItemsForTask(taskId);
  }

  private async syncActiveWorkRun(taskId: string, status: WorkRunStatus): Promise<void> {
    const run = this.workItems.activeRunForTask(taskId);
    if (!run || run.status === status) return;
    await this.workItems.updateRun(run.id, { status });
    this.emitWorkItems();
  }

  emit(taskId: string, type: ServerEvent["type"], payload: unknown): void {
    this.events.emit(taskId, type, payload);
  }

  sendTo(socket: SocketLike, taskId: string, type: ServerEvent["type"], payload: unknown): void {
    this.events.sendTo(socket, taskId, type, payload);
  }

  broadcast(event: ServerEvent): void {
    this.events.dispatch(event);
  }

  restoredMessages(taskId: string): TimelineMessage[] {
    return this.supervisor.snapshot(taskId)?.messages ?? [];
  }
}

export { isActiveProcessStatus };

function summarizeWorkResult(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= 280) return compact;
  return `${compact.slice(0, 277)}...`;
}
