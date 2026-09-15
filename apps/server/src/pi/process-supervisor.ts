import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type {
  ApprovalRequest,
  InteractionRequest,
  ModelRef,
  RuntimeState,
  ServerEvent,
  SessionStats,
  SessionTreeNode,
  TaskRecord,
  ThinkingLevel,
  TimelineImage,
  TimelineMessage,
  ToolExecution,
} from "@qingzhou/protocol";
import { emptyRuntime, mergeCompletedTimelineMessage, thinkingLevelsFromPiModel } from "@qingzhou/protocol";
import type { AppConfig } from "../config.js";
import { RpcClient, type RpcEvent } from "./rpc-client.js";
import { normalizePiEvent, piMessagesToTimeline } from "./event-normalizer.js";
import { redactSecrets } from "../security/redact.js";
import { flattenSessionTree } from "../tasks/session-tree.js";
import { isModelChangeNotice, mergeModelChangeNotices } from "../tasks/model-change.js";
import { buildPiRpcArgs } from "./rpc-args.js";
import { humanizeUserFacingError, shouldSurfacePiStderr } from "../setup/pi-agent-dir.js";

export type AgentCommand = {
  name: string;
  description?: string;
  source?: string;
};

export type RuntimeSnapshot = {
  messages: TimelineMessage[];
  tools: ToolExecution[];
  approval: ApprovalRequest | null;
  models: ModelRef[];
  thinkingLevels: ThinkingLevel[];
  stats: SessionStats | null;
  generation: number;
  commands: AgentCommand[];
  runtime: RuntimeState;
  sessionTree: SessionTreeNode[];
  sessionLeafId: string | null;
};

type ApprovalPending = {
  requestId: string;
  taskId: string;
  generation: number;
  payload: ApprovalRequest;
  timer: ReturnType<typeof setTimeout>;
};

type InteractionPending = {
  requestId: string;
  taskId: string;
  generation: number;
  payload: InteractionRequest;
  timer: ReturnType<typeof setTimeout>;
};

type Listener = (event: ServerEvent) => void;

export function matchApprovalTool(tools: ToolExecution[], toolCallId: string): ToolExecution | undefined {
  if (!toolCallId) return undefined;
  return tools.find((item) => item.toolCallId === toolCallId);
}

function attachPendingImages(
  runtime: { pendingImages?: TimelineImage[] },
  message: TimelineMessage,
): TimelineMessage {
  if (message.role !== "user") return message;
  const pending = runtime.pendingImages;
  runtime.pendingImages = undefined;
  if (message.images?.length || !pending?.length) return message;
  return { ...message, images: pending };
}

function parseApprovalMessage(
  requestId: string,
  taskId: string,
  title: string | undefined,
  message: string | undefined,
  timeoutMs: number,
): ApprovalRequest | null {
  if (!message || (!message.includes("QINGZHOU_APPROVAL_V1") && !message.includes("MOWEN_APPROVAL_V1") && !message.includes("OHMYPI_APPROVAL_V1"))) {
    if (title?.startsWith("Allow ")) {
      return {
        requestId,
        taskId,
        toolCallId: "",
        toolName: title.replace(/^Allow\s+/, "").replace(/\?$/, ""),
        cwd: "",
        target: message ?? "",
        risk: "这次操作需要你确认。",
        expiresAt: new Date(Date.now() + timeoutMs).toISOString(),
      };
    }
    return null;
  }
  const jsonLine = message
    .split("\n")
    .map((line) => line.trim())
    .find((line, index, lines) => lines[index - 1] === "QINGZHOU_APPROVAL_V1" || lines[index - 1] === "MOWEN_APPROVAL_V1" || lines[index - 1] === "OHMYPI_APPROVAL_V1");
  if (!jsonLine) return null;
  try {
    const parsed = JSON.parse(jsonLine) as {
      toolName?: string;
      toolCallId?: string;
      cwd?: string;
      target?: string;
      rawCommand?: string;
      risk?: string;
    };
    return {
      requestId,
      taskId,
      toolCallId: parsed.toolCallId ?? "",
      toolName: parsed.toolName ?? "tool",
      cwd: parsed.cwd ?? "",
      target: parsed.target ?? "",
      rawCommand: parsed.rawCommand,
      risk: parsed.risk ?? "这次操作需要你确认。",
      expiresAt: new Date(Date.now() + timeoutMs).toISOString(),
    };
  } catch {
    return null;
  }
}

export class ProcessSupervisor {
  private readonly runtimes = new Map<
    string,
    {
      generation: number;
      client: RpcClient;
      messages: TimelineMessage[];
      tools: Map<string, ToolExecution>;
      liveAssistantId: string | null;
      pendingImages?: TimelineImage[];
      approval: ApprovalRequest | null;
      models: ModelRef[];
      thinkingLevels: ThinkingLevel[];
      stats: SessionStats | null;
      commands: AgentCommand[];
      runtime: RuntimeState;
      sessionTree: SessionTreeNode[];
      sessionLeafId: string | null;
      stderrAlerted: string | null;
    }
  >();
  private readonly pendingApprovals = new Map<string, ApprovalPending>();
  private readonly pendingInteractions = new Map<string, InteractionPending>();
  private readonly listeners = new Set<Listener>();
  private readonly sequences = new Map<string, number>();
  private readonly serverInstanceId = randomUUID();

  constructor(
    private config: AppConfig,
    private readonly onUnexpectedExit: (taskId: string, generation: number, error: string) => void,
    private readonly onApprovalNeeded: (taskId: string) => void,
    private readonly onSettled: (taskId: string) => void,
    private readonly onAbortConfirmed: (taskId: string) => void,
  ) {}

  updateConfig(config: AppConfig): void {
    this.config = config;
  }

  onEvent(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  runningCount(): number {
    return this.runtimes.size;
  }

  has(taskId: string): boolean {
    return this.runtimes.has(taskId);
  }

  listApprovals(): ApprovalRequest[] {
    return [...this.pendingApprovals.values()].map((item) => item.payload);
  }

  listInteractions(): InteractionRequest[] {
    return [...this.pendingInteractions.values()].map((item) => item.payload);
  }

  getApproval(requestId: string): ApprovalRequest | null {
    return this.pendingApprovals.get(requestId)?.payload ?? null;
  }

  setPendingImages(taskId: string, images: TimelineImage[] | undefined): void {
    const runtime = this.runtimes.get(taskId);
    if (!runtime) return;
    runtime.pendingImages = images?.length ? images : undefined;
  }

  replaceMessages(taskId: string, messages: TimelineMessage[]): void {
    const runtime = this.runtimes.get(taskId);
    if (!runtime) return;
    runtime.messages = messages.map((item) => ({ ...item }));
    runtime.liveAssistantId = null;
  }

  appendNotice(taskId: string, message: TimelineMessage): TimelineMessage | null {
    const runtime = this.runtimes.get(taskId);
    if (!runtime) return null;
    const last = runtime.messages[runtime.messages.length - 1];
    if (last && isModelChangeNotice(last) && last.text === message.text) return last;
    runtime.messages.push(message);
    this.emit(taskId, "message.completed", { message });
    return message;
  }

  syncModelChangeNotices(taskId: string): TimelineMessage[] {
    const runtime = this.runtimes.get(taskId);
    if (!runtime) return [];
    runtime.messages = mergeModelChangeNotices(runtime.messages, runtime.sessionTree, runtime.models);
    return runtime.messages;
  }

  setStats(taskId: string, stats: SessionStats | null): void {
    const runtime = this.runtimes.get(taskId);
    if (!runtime) return;
    runtime.stats = stats;
  }

  setCommands(taskId: string, commands: Array<{ name: string; description?: string; source?: string }>): void {
    const runtime = this.runtimes.get(taskId);
    if (!runtime) return;
    runtime.commands = commands;
  }

  /** Re-query Pi for models/thinking levels (e.g. after auth changes or warm activate). */
  async refreshAvailableModels(taskId: string): Promise<{ models: ModelRef[]; thinkingLevels: ThinkingLevel[] }> {
    const runtime = this.runtimes.get(taskId);
    if (!runtime) return { models: [], thinkingLevels: ["off"] };
    const models = await this.rpcData(taskId, { type: "get_available_models" });
    const levels = await this.rpcData(taskId, { type: "get_available_thinking_levels" });
    runtime.models = parseAvailableModels(models);
    runtime.thinkingLevels = parseThinkingLevels(levels);
    if (runtime.thinkingLevels.length === 0) runtime.thinkingLevels = ["off"];
    return { models: runtime.models, thinkingLevels: runtime.thinkingLevels };
  }

  snapshot(taskId: string): RuntimeSnapshot | null {
    const runtime = this.runtimes.get(taskId);
    if (!runtime) return null;
    return {
      messages: runtime.messages.map((item) => ({ ...item })),
      tools: [...runtime.tools.values()].map((item) => ({ ...item })),
      approval: runtime.approval,
      models: runtime.models,
      thinkingLevels: runtime.thinkingLevels,
      stats: runtime.stats,
      generation: runtime.generation,
      commands: runtime.commands,
      runtime: { ...runtime.runtime, steering: [...runtime.runtime.steering], followUp: [...runtime.runtime.followUp] },
      sessionTree: runtime.sessionTree.map((item) => ({ ...item })),
      sessionLeafId: runtime.sessionLeafId,
    };
  }

  getGeneration(taskId: string): number {
    return this.runtimes.get(taskId)?.generation ?? 0;
  }

  async boot(task: TaskRecord): Promise<{ sessionPath: string | null; model: TaskRecord["model"]; thinkingLevel: ThinkingLevel }> {
    await this.stop(task.id, "SIGTERM");
    const generation = Date.now();
    const sessionDir = path.join(this.config.dataDir, "sessions", task.id);
    await mkdir(sessionDir, { recursive: true });
    const args = buildPiRpcArgs({
      approvalExtensionPath: this.config.approvalExtensionPath,
      trustProject: this.config.trustProject,
      sessionPath: task.sessionPath,
      sessionDir,
    });

    const runtime = {
      generation,
      client: null as unknown as RpcClient,
      messages: [] as TimelineMessage[],
      tools: new Map<string, ToolExecution>(),
      liveAssistantId: null as string | null,
      approval: null as ApprovalRequest | null,
      models: [] as ModelRef[],
      thinkingLevels: ["off"] as ThinkingLevel[],
      stats: null as SessionStats | null,
      commands: [] as AgentCommand[],
      runtime: emptyRuntime(),
      sessionTree: [] as SessionTreeNode[],
      sessionLeafId: null as string | null,
      stderrAlerted: null as string | null,
    };

    const client = new RpcClient({
      bin: this.config.piCommand,
      prefixArgs: this.config.piPrefixArgs,
      extraEnv: this.config.piExtraEnv,
      args,
      cwd: task.cwd,
      env: {
        QINGZHOU_MUTATIONS: this.config.mutations,
        QINGZHOU_ALLOWED_ROOTS: this.config.allowedRoots.join(","),
        QINGZHOU_TASK_ID: task.id,
        MOWEN_MUTATIONS: this.config.mutations,
        MOWEN_ALLOWED_ROOTS: this.config.allowedRoots.join(","),
        MOWEN_TASK_ID: task.id,
        OHMYPI_MUTATIONS: this.config.mutations,
        OHMYPI_ALLOWED_ROOTS: this.config.allowedRoots.join(","),
        OHMYPI_TASK_ID: task.id,
      },
      onEvent: (event) => this.handlePiEvent(task.id, generation, event),
      onStderr: (chunk) => {
        if (chunk.trim()) {
          console.warn(`[pi ${task.id}] ${redactSecrets(chunk.trim())}`);
        }
        const current = this.runtimes.get(task.id);
        if (!current || current.generation !== generation) return;
        if (!shouldSurfacePiStderr(chunk)) return;
        const message = humanizeUserFacingError(new Error(chunk));
        if (current.stderrAlerted === message) return;
        current.stderrAlerted = message;
        this.emit(task.id, "server.error", {
          code: "pi.stderr",
          message,
        });
      },
      onExit: (code, signal) => {
        const current = this.runtimes.get(task.id);
        if (!current || current.generation !== generation) return;
        const stderr = redactSecrets(current.client?.getStderr?.().trim() ?? "");
        const detail = stderr ? `\n${stderr}` : "";
        this.onUnexpectedExit(
          task.id,
          generation,
          humanizeUserFacingError(new Error(`Pi 进程退出（code=${code} signal=${signal}）。${detail}`)),
        );
      },
    });
    runtime.client = client;
    this.runtimes.set(task.id, runtime);

    await client.start();
    const state = await this.rpcData(task.id, { type: "get_state" });
    const messages = await this.rpcData(task.id, { type: "get_messages" });
    const models = await this.rpcData(task.id, { type: "get_available_models" });
    const levels = await this.rpcData(task.id, { type: "get_available_thinking_levels" });
    try {
      const commands = await this.rpcData(task.id, { type: "get_commands" });
      runtime.commands = Array.isArray((commands as { commands?: unknown[] })?.commands)
        ? ((commands as { commands: Array<Record<string, unknown>> }).commands).map((command) => ({
            name: String(command.name ?? ""),
            description: typeof command.description === "string" ? command.description : undefined,
            source: typeof command.source === "string" ? command.source : undefined,
          }))
        : [];
    } catch {
      runtime.commands = [];
    }

    const stateData = (state ?? {}) as Record<string, unknown>;
    const messageData = (messages ?? {}) as { messages?: unknown[] };
    runtime.messages = piMessagesToTimeline(messageData.messages ?? []);
    runtime.models = parseAvailableModels(models);
    runtime.thinkingLevels = parseThinkingLevels(levels);
    if (runtime.thinkingLevels.length === 0) runtime.thinkingLevels = ["off"];

    runtime.runtime = {
      ...emptyRuntime(),
      compacting: Boolean(stateData.isCompacting),
      autoCompaction: stateData.autoCompactionEnabled !== false,
      autoRetry: typeof stateData.autoRetryEnabled === "boolean" ? stateData.autoRetryEnabled : true,
      ...(typeof stateData.fastModeEnabled === "boolean" ? { fastModeEnabled: stateData.fastModeEnabled } : {}),
      ...(typeof stateData.fastModeActive === "boolean" ? { fastModeActive: stateData.fastModeActive } : {}),
    };
    await this.refreshSessionTree(task.id);
    this.syncModelChangeNotices(task.id);

    const modelObj = stateData.model as Record<string, unknown> | null | undefined;
    const model =
      modelObj && typeof modelObj === "object"
        ? {
            provider: String(modelObj.provider ?? "unknown"),
            id: String(modelObj.id ?? "unknown"),
            name: typeof modelObj.name === "string" ? modelObj.name : undefined,
          }
        : null;

    return {
      sessionPath: typeof stateData.sessionFile === "string" ? stateData.sessionFile : null,
      model,
      thinkingLevel: (stateData.thinkingLevel as ThinkingLevel) ?? "off",
    };
  }

  async stop(taskId: string, signal: NodeJS.Signals = "SIGTERM"): Promise<void> {
    const runtime = this.runtimes.get(taskId);
    if (!runtime) return;
    this.runtimes.delete(taskId);
    this.clearApprovalsForTask(taskId, "Task stopped");
    this.clearInteractionsForTask(taskId);
    await runtime.client.stop(signal);
  }

  async rpc(taskId: string, command: Record<string, unknown> & { type: string }): Promise<import("./rpc-client.js").RpcResponse> {
    const runtime = this.runtimes.get(taskId);
    if (!runtime) {
      throw new Error("Pi process is not running for this task");
    }
    return runtime.client.send(command);
  }

  async rpcData(taskId: string, command: Record<string, unknown> & { type: string }): Promise<unknown> {
    const response = await this.rpc(taskId, command);
    if (!response.success) {
      throw new Error(response.error ?? `${command.type} failed`);
    }
    return response.data;
  }

  respondApproval(requestId: string, allow: boolean): boolean {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending) return false;
    const runtime = this.runtimes.get(pending.taskId);
    if (!runtime || runtime.generation !== pending.generation) {
      this.pendingApprovals.delete(requestId);
      clearTimeout(pending.timer);
      return false;
    }
    runtime.client.sendUiResponse(
      allow
        ? { id: requestId, confirmed: true }
        : { id: requestId, confirmed: false, cancelled: true },
    );
    this.finishApproval(requestId, allow);
    return true;
  }

  respondInteraction(requestId: string, payload: { cancelled?: boolean; value?: string }): boolean {
    const pending = this.pendingInteractions.get(requestId);
    if (!pending) return false;
    const runtime = this.runtimes.get(pending.taskId);
    if (!runtime || runtime.generation !== pending.generation) {
      this.pendingInteractions.delete(requestId);
      clearTimeout(pending.timer);
      return false;
    }
    if (payload.cancelled) {
      runtime.client.sendUiResponse({ id: requestId, cancelled: true });
    } else {
      runtime.client.sendUiResponse({
        id: requestId,
        value: payload.value ?? "",
        confirmed: true,
      });
    }
    this.finishInteraction(requestId, payload.cancelled === true, payload.value);
    return true;
  }

  denyAllApprovals(reason: string): void {
    for (const requestId of [...this.pendingApprovals.keys()]) {
      this.denyOne(requestId, reason);
    }
  }

  denyApprovalsForTask(taskId: string, reason: string): void {
    this.clearApprovalsForTask(taskId, reason);
  }

  private denyOne(requestId: string, reason: string): void {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending) return;
    const runtime = this.runtimes.get(pending.taskId);
    if (runtime && runtime.generation === pending.generation) {
      runtime.client.sendUiResponse({ id: requestId, confirmed: false, cancelled: true });
    }
    this.finishApproval(requestId, false, reason);
  }

  private finishApproval(requestId: string, allow: boolean, reason?: string): void {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingApprovals.delete(requestId);
    const runtime = this.runtimes.get(pending.taskId);
    if (runtime) runtime.approval = null;
    this.emit(pending.taskId, "approval.resolved", { requestId, allow, reason });
  }

  private finishInteraction(requestId: string, cancelled: boolean, value?: string): void {
    const pending = this.pendingInteractions.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingInteractions.delete(requestId);
    this.emit(pending.taskId, "interaction.resolved", { requestId, cancelled, value });
  }

  private clearInteractionsForTask(taskId: string): void {
    for (const [requestId, pending] of this.pendingInteractions) {
      if (pending.taskId !== taskId) continue;
      const runtime = this.runtimes.get(pending.taskId);
      if (runtime && runtime.generation === pending.generation) {
        runtime.client.sendUiResponse({ id: requestId, cancelled: true });
      }
      this.finishInteraction(requestId, true);
    }
  }

  private clearApprovalsForTask(taskId: string, reason: string): void {
    for (const [requestId, pending] of this.pendingApprovals) {
      if (pending.taskId === taskId) {
        this.denyOne(requestId, reason);
      }
    }
  }

  private handlePiEvent(taskId: string, generation: number, event: RpcEvent): void {
    const runtime = this.runtimes.get(taskId);
    if (!runtime || runtime.generation !== generation) return;

    const normalized = normalizePiEvent(event);
    switch (normalized.kind) {
      case "status":
        if (normalized.settled) {
          runtime.liveAssistantId = null;
          this.onSettled(taskId);
        }
        break;
      case "message.started": {
        const message = attachPendingImages(runtime, normalized.message);
        if (message.role === "assistant" && message.streaming) {
          runtime.liveAssistantId = message.id;
        }
        runtime.messages.push(message);
        this.emit(taskId, "message.started", { message });
        break;
      }
      case "message.delta": {
        const id = runtime.liveAssistantId ?? normalized.messageId;
        const existing = runtime.messages.find((item) => item.id === id);
        if (existing) {
          if (normalized.field === "text") existing.text += normalized.delta;
          if (normalized.field === "thinking") {
            existing.thinking = `${existing.thinking ?? ""}${normalized.delta}`;
          }
        }
        this.emit(taskId, "message.delta", {
          messageId: id,
          field: normalized.field,
          delta: normalized.delta,
        });
        break;
      }
      case "message.completed": {
        const id =
          normalized.message.role === "assistant" && runtime.liveAssistantId
            ? runtime.liveAssistantId
            : normalized.message.id;
        const index = runtime.messages.findIndex((item) => item.id === id);
        const existing = index >= 0 ? runtime.messages[index] : undefined;
        const message = mergeCompletedTimelineMessage(existing, { ...normalized.message, id });
        if (index >= 0) {
          runtime.messages[index] = message;
        } else {
          runtime.messages.push(message);
        }
        if (normalized.message.role === "assistant") {
          runtime.liveAssistantId = null;
        }
        this.emit(taskId, "message.completed", { message });
        break;
      }
      case "tool.started": {
        runtime.tools.set(normalized.tool.toolCallId, normalized.tool);
        this.emit(taskId, "tool.started", { tool: normalized.tool });
        break;
      }
      case "tool.updated": {
        const current = runtime.tools.get(normalized.tool.toolCallId);
        if (current) {
          const next = { ...current, ...normalized.tool };
          runtime.tools.set(next.toolCallId, next);
          this.emit(taskId, "tool.updated", { tool: next });
        }
        break;
      }
      case "tool.completed": {
        const current = runtime.tools.get(normalized.tool.toolCallId);
        const started = current?.startedAt ? Date.parse(current.startedAt) : Date.now();
        const next = {
          ...(current ?? {
            toolCallId: normalized.tool.toolCallId,
            toolName: "tool",
            status: "failed" as const,
          }),
          ...normalized.tool,
          durationMs: Date.now() - started,
        };
        runtime.tools.set(next.toolCallId, next);
        this.emit(taskId, "tool.completed", { tool: next });
        break;
      }
      case "approval.ui": {
        if (normalized.method === "notify") {
          const message = normalized.message ?? normalized.title ?? "通知";
          this.emit(taskId, "notification.shown", {
            message,
            notifyType: normalized.notifyType ?? "info",
          });
          runtime.client.sendUiResponse({ id: normalized.requestId, confirmed: true });
          break;
        }
        if (normalized.method === "select" || normalized.method === "input") {
          const interaction: InteractionRequest = {
            requestId: normalized.requestId,
            taskId,
            method: normalized.method,
            title: normalized.title,
            message: normalized.message,
            options: normalized.options,
            placeholder: normalized.placeholder,
          };
          const timer = setTimeout(() => {
            this.respondInteraction(interaction.requestId, { cancelled: true });
          }, this.config.approvalTimeoutMs);
          this.pendingInteractions.set(interaction.requestId, {
            requestId: interaction.requestId,
            taskId,
            generation,
            payload: interaction,
            timer,
          });
          this.emit(taskId, "interaction.requested", { interaction });
          break;
        }
        if (normalized.method !== "confirm") break;
        const approval = parseApprovalMessage(
          normalized.requestId,
          taskId,
          normalized.title,
          normalized.message,
          this.config.approvalTimeoutMs,
        );
        if (!approval) break;
        const tool = matchApprovalTool([...runtime.tools.values()], approval.toolCallId);
        if (tool) {
          tool.status = "waiting_approval";
          const args = tool.args && typeof tool.args === "object" ? (tool.args as Record<string, unknown>) : {};
          if (typeof args.oldText === "string") approval.oldText = args.oldText;
          if (typeof args.newText === "string") approval.newText = args.newText;
          if (typeof args.content === "string") approval.content = args.content;
          this.emit(taskId, "tool.updated", { tool });
        }
        runtime.approval = approval;
        const timer = setTimeout(() => {
          this.denyOne(approval.requestId, "Approval timed out");
        }, this.config.approvalTimeoutMs);
        this.pendingApprovals.set(approval.requestId, {
          requestId: approval.requestId,
          taskId,
          generation,
          payload: approval,
          timer,
        });
        this.emit(taskId, "approval.requested", { approval });
        this.emit(taskId, "notification.shown", {
          message: "需要你确认一次操作",
          notifyType: "warning",
        });
        this.onApprovalNeeded(taskId);
        break;
      }
      case "extension_error":
        this.emit(taskId, "server.error", { code: "extension", message: normalized.error });
        break;
      case "agent_error":
        this.emit(taskId, "server.error", {
          code: "pi.agent",
          message: humanizeUserFacingError(new Error(normalized.error)),
        });
        break;
      case "runtime.compaction":
        runtime.runtime = {
          ...runtime.runtime,
          compacting: normalized.phase === "start",
          compactionReason: normalized.phase === "start" ? normalized.reason : undefined,
        };
        this.emit(taskId, "runtime.status", runtime.runtime);
        break;
      case "runtime.retry":
        runtime.runtime = {
          ...runtime.runtime,
          retrying: normalized.phase === "start",
          retryAttempt: normalized.attempt,
          retryMax: normalized.maxAttempts,
          retryError: normalized.error,
        };
        this.emit(taskId, "runtime.status", runtime.runtime);
        if (normalized.phase === "end" && normalized.error?.trim()) {
          this.emit(taskId, "server.error", {
            code: "pi.retry",
            message: humanizeUserFacingError(new Error(normalized.error)),
          });
        }
        break;
      case "runtime.queue":
        runtime.runtime = {
          ...runtime.runtime,
          steering: normalized.steering,
          followUp: normalized.followUp,
        };
        this.emit(taskId, "runtime.status", runtime.runtime);
        break;
      default:
        break;
    }
  }

  patchRuntime(taskId: string, patch: Partial<RuntimeState>): RuntimeState | null {
    const runtime = this.runtimes.get(taskId);
    if (!runtime) return null;
    runtime.runtime = { ...runtime.runtime, ...patch };
    this.emit(taskId, "runtime.status", runtime.runtime);
    return runtime.runtime;
  }

  async refreshSessionTree(taskId: string): Promise<{ nodes: SessionTreeNode[]; leafId: string | null }> {
    const runtime = this.runtimes.get(taskId);
    if (!runtime) return { nodes: [], leafId: null };
    try {
      const data = (await this.rpcData(taskId, { type: "get_tree" })) as {
        tree?: unknown;
        leafId?: string | null;
      };
      const leafId = typeof data.leafId === "string" ? data.leafId : null;
      const nodes = flattenSessionTree(data.tree, leafId);
      runtime.sessionTree = nodes;
      runtime.sessionLeafId = leafId;
      return { nodes, leafId };
    } catch {
      return { nodes: runtime.sessionTree, leafId: runtime.sessionLeafId };
    }
  }

  emit(taskId: string, type: ServerEvent["type"], payload: unknown): void {
    const event = {
      ...this.nextSequence(taskId),
      taskId,
      type,
      payload,
    } as ServerEvent;
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  nextSequence(taskId: string): { eventId: string; serverInstanceId: string; timestamp: string; sequence: number } {
    const sequence = (this.sequences.get(taskId) ?? 0) + 1;
    this.sequences.set(taskId, sequence);
    return {
      eventId: randomUUID(),
      serverInstanceId: this.serverInstanceId,
      timestamp: new Date().toISOString(),
      sequence,
    };
  }
}

function parseAvailableModels(raw: unknown): ModelRef[] {
  const models = (raw as { models?: unknown[] } | null)?.models;
  if (!Array.isArray(models)) return [];
  return models.map((model) => {
    const item = model as Record<string, unknown>;
    return {
      provider: String(item.provider ?? "unknown"),
      id: String(item.id ?? "unknown"),
      name: typeof item.name === "string" ? item.name : undefined,
      reasoning: Boolean(item.reasoning),
      contextWindow: typeof item.contextWindow === "number" ? item.contextWindow : undefined,
      thinkingLevels: thinkingLevelsFromPiModel(item),
    };
  });
}

function parseThinkingLevels(raw: unknown): ThinkingLevel[] {
  const levels = (raw as { levels?: unknown[] } | null)?.levels;
  if (!Array.isArray(levels)) return ["off"];
  return levels.filter((level): level is ThinkingLevel =>
    ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(String(level)),
  );
}
