import { z } from "zod";
import { isoTimestampSchema, type TaskStatus } from "./task-schema.js";

export const WORK_ITEM_SCHEMA_VERSION = 3;

export const workItemStateSchema = z.enum(["open", "completed", "archived"]);
export type WorkItemState = z.infer<typeof workItemStateSchema>;

export const workRunStatusSchema = z.enum([
  "queued",
  "running",
  "waiting_approval",
  "waiting_input",
  "succeeded",
  "failed",
  "aborted",
]);
export type WorkRunStatus = z.infer<typeof workRunStatusSchema>;

export const workRunKindSchema = z.enum(["initial", "feedback", "retry", "migrated"]);
export type WorkRunKind = z.infer<typeof workRunKindSchema>;

export const workItemViewStateSchema = z.enum([
  "ready",
  "queued",
  "working",
  "needs_approval",
  "needs_input",
  "needs_review",
  "failed",
  "paused",
  "completed",
  "archived",
]);
export type WorkItemViewState = z.infer<typeof workItemViewStateSchema>;

export const workProjectSchema = z.object({
  schemaVersion: z.literal(WORK_ITEM_SCHEMA_VERSION).default(WORK_ITEM_SCHEMA_VERSION),
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  cwd: z.string().min(1),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
  archivedAt: isoTimestampSchema.nullable().default(null),
});
export type WorkProject = z.infer<typeof workProjectSchema>;

export const workRunSchema = z.object({
  id: z.string().uuid(),
  objectiveId: z.string().uuid(),
  taskId: z.string().uuid(),
  kind: workRunKindSchema,
  instruction: z.string().min(1).max(30_000),
  status: workRunStatusSchema,
  resultSummary: z.string().max(2_000).nullable().default(null),
  resultMessageId: z.string().nullable().default(null),
  errorMessage: z.string().max(20_000).nullable().default(null),
  createdAt: isoTimestampSchema,
  startedAt: isoTimestampSchema.nullable().default(null),
  finishedAt: isoTimestampSchema.nullable().default(null),
});
export type WorkRun = z.infer<typeof workRunSchema>;

export const workItemFeedbackSchema = z.object({
  id: z.string().uuid(),
  objectiveId: z.string().uuid(),
  runId: z.string().uuid().nullable().default(null),
  text: z.string().min(1).max(20_000),
  createdAt: isoTimestampSchema,
  deliveredAt: isoTimestampSchema.nullable().default(null),
});
export type WorkItemFeedback = z.infer<typeof workItemFeedbackSchema>;

export const workItemSchema = z.object({
  schemaVersion: z.literal(WORK_ITEM_SCHEMA_VERSION).default(WORK_ITEM_SCHEMA_VERSION),
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(20_000).default(""),
  acceptanceCriteria: z.string().max(10_000).default(""),
  cwd: z.string().min(1),
  state: workItemStateSchema.default("open"),
  rank: z.number(),
  taskId: z.string().uuid().nullable().default(null),
  latestRunId: z.string().uuid().nullable().default(null),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
  completedAt: isoTimestampSchema.nullable().default(null),
  archivedAt: isoTimestampSchema.nullable().default(null),
});
export type WorkItem = z.infer<typeof workItemSchema>;

export const workItemSummarySchema = workItemSchema.extend({
  latestRun: workRunSchema.nullable(),
  runCount: z.number().int().nonnegative(),
  feedbackCount: z.number().int().nonnegative(),
});
export type WorkItemSummary = z.infer<typeof workItemSummarySchema>;

export const workItemDetailsSchema = z.object({
  item: workItemSchema,
  runs: z.array(workRunSchema),
  feedback: z.array(workItemFeedbackSchema),
});
export type WorkItemDetails = z.infer<typeof workItemDetailsSchema>;

export function workItemPrompt(item: {
  title: string;
  description?: string;
  acceptanceCriteria?: string;
  feedback?: Array<{ text: string }>;
}): string {
  const sections = [`标题：${item.title}`];
  const description = item.description?.trim();
  const acceptanceCriteria = item.acceptanceCriteria?.trim();
  const feedback = (item.feedback ?? []).map((entry) => entry.text.trim()).filter(Boolean);
  if (description) sections.push(`目标说明：\n${description}`);
  if (acceptanceCriteria) sections.push(`验收标准：\n${acceptanceCriteria}`);
  if (feedback.length > 0) sections.push(`补充要求：\n${feedback.join("\n\n")}`);
  return [
    "请完成下面这个工作目标。",
    "这是工作台已启动的执行轮次：用户已确认要做，不要再等确认，也不要只输出计划就结束。",
    "可先用一两句话说明本轮范围，然后立即改代码、跑相关验证并推进验收标准。",
    "若项目里的 AGENTS.md / 约定要求「先确认再改」，对本轮以本说明为准。",
    "完成本轮后总结结果、验证情况和仍需用户决定的问题。",
    "",
    sections.join("\n\n"),
  ].join("\n");
}

export function workItemFeedbackPrompt(item: { title: string }, text: string): string {
  return [
    `请继续工作目标「${item.title}」。`,
    "这是工作台补充要求后的新一轮：用户已确认继续，不要再等确认，也不要只输出计划就结束。",
    "先检查当前工作状态，不要重复已经完成的操作，然后立即实施下面的补充要求。",
    "若项目里的 AGENTS.md / 约定要求「先确认再改」，对本轮以本说明为准。",
    "",
    text.trim(),
  ].join("\n");
}

/** Compatibility alias for old callers while workItem.append remains accepted. */
export const workItemAppendPrompt = workItemFeedbackPrompt;

export function workItemIsClosed(state: WorkItemState): boolean {
  return state === "completed" || state === "archived";
}

export function workItemCanContinue(state: WorkItemState): boolean {
  return state === "open";
}

const ACTIVE_RUN_STATUSES = new Set<WorkRunStatus>(["queued", "running", "waiting_approval", "waiting_input"]);
const BUSY_TASK_STATUSES = new Set<TaskStatus>(["queued", "booting", "running", "aborting", "waiting_approval"]);

export function workRunIsActive(status: WorkRunStatus): boolean {
  return ACTIVE_RUN_STATUSES.has(status);
}

export function taskStatusIsBusy(status?: TaskStatus | null): boolean {
  return Boolean(status && BUSY_TASK_STATUSES.has(status));
}

export const WORK_PROMPT_NEEDS_BOARD = "请在工作台补充要求后再继续，这一轮需要记入执行记录。";
export const WORK_PROMPT_ITEM_CLOSED = "这个目标已经结束，请先重新打开。";
export const WORK_SESSION_NO_FORK = "任务对话不能从中间分叉。请在工作台补充要求后开启新一轮。";

export function workLinkedPromptError(
  items: Array<{ state: WorkItemState }>,
  activeRun: { status: WorkRunStatus } | undefined,
  mode: "prompt" | "steer" | "follow_up",
  options?: { recordedRun?: boolean },
): string | null {
  if (items.length === 0) return null;
  if (!items.some((item) => workItemCanContinue(item.state))) return WORK_PROMPT_ITEM_CLOSED;
  if (options?.recordedRun && mode === "prompt") return null;
  if (mode === "prompt") return WORK_PROMPT_NEEDS_BOARD;
  if (!activeRun || !workRunIsActive(activeRun.status)) return WORK_PROMPT_NEEDS_BOARD;
  return null;
}

export function workLinkedSessionRewriteError(items: Array<{ state: WorkItemState }>): string | null {
  if (items.length === 0) return null;
  return WORK_SESSION_NO_FORK;
}

export function deriveWorkItemViewState(input: {
  item: Pick<WorkItemSummary, "state" | "latestRun">;
  taskStatus?: TaskStatus | null;
  needsApproval?: boolean;
  needsInput?: boolean;
}): WorkItemViewState {
  if (input.item.state === "archived") return "archived";
  if (input.item.state === "completed") return "completed";
  if (input.needsApproval || input.taskStatus === "waiting_approval") return "needs_approval";
  if (input.needsInput) return "needs_input";
  if (input.taskStatus === "error") return "failed";
  if (input.taskStatus === "queued" || input.taskStatus === "booting") return "queued";
  if (input.taskStatus === "running" || input.taskStatus === "aborting") return "working";
  const run = input.item.latestRun;
  if (run && workRunIsActive(run.status) && input.taskStatus != null && !taskStatusIsBusy(input.taskStatus)) {
    return "paused";
  }
  if (!run) return "ready";
  switch (run.status) {
    case "queued":
      return "queued";
    case "running":
      return "working";
    case "waiting_approval":
      return "needs_approval";
    case "waiting_input":
      return "needs_input";
    case "succeeded":
      return "needs_review";
    case "failed":
      return "failed";
    case "aborted":
      return "paused";
  }
}

/** Legacy v2 column types are retained only for persisted-data migration. */
export const legacyWorkItemColumnSchema = z.enum(["todo", "doing", "review", "done", "archived"]);
export type WorkItemColumn = z.infer<typeof legacyWorkItemColumnSchema>;
