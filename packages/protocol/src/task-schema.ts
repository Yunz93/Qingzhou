import { z } from "zod";

export const thinkingLevelSchema = z.enum([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

export const interactionModeSchema = z.enum(["ask", "plan", "agent", "review"]);
export type InteractionMode = z.infer<typeof interactionModeSchema>;

export const approvalPolicySchema = z.enum(["ask", "workspace", "auto", "read_only"]);
export type ApprovalPolicy = z.infer<typeof approvalPolicySchema>;

export type ThinkingLevel = z.infer<typeof thinkingLevelSchema>;

export const taskStatusSchema = z.enum([
  "queued",
  "booting",
  "idle",
  "running",
  "waiting_approval",
  "aborting",
  "error",
  "stopped",
]);

export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const toolExecutionStatusSchema = z.enum([
  "pending",
  "waiting_approval",
  "running",
  "succeeded",
  "failed",
  "blocked",
  "aborted",
]);

export type ToolExecutionStatus = z.infer<typeof toolExecutionStatusSchema>;

export const modelRefSchema = z.object({
  provider: z.string(),
  id: z.string(),
  name: z.string().optional(),
  reasoning: z.boolean().optional(),
  contextWindow: z.number().optional(),
  thinkingLevels: z.array(thinkingLevelSchema).optional(),
});

export type ModelRef = z.infer<typeof modelRefSchema>;

export const TASK_SCHEMA_VERSION = 1;

export const isoTimestampSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid timestamp");

export const taskRecordSchema = z.object({
  schemaVersion: z.literal(TASK_SCHEMA_VERSION).default(TASK_SCHEMA_VERSION),
  id: z.string().uuid(),
  title: z.string(),
  cwd: z.string(),
  sessionPath: z.string().nullable(),
  status: taskStatusSchema,
  model: modelRefSchema.nullable(),
  thinkingLevel: thinkingLevelSchema,
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
  lastOpenedAt: isoTimestampSchema,
  archivedAt: isoTimestampSchema.nullable(),
  unreadCount: z.number().int().nonnegative(),
  errorMessage: z.string().nullable().optional(),
  mode: interactionModeSchema.default("agent"),
  approvalPolicy: approvalPolicySchema.default("auto"),
});

export type TaskRecord = z.infer<typeof taskRecordSchema>;

export const toolExecutionSchema = z.object({
  toolCallId: z.string(),
  toolName: z.string(),
  target: z.string().optional(),
  args: z.unknown().optional(),
  status: toolExecutionStatusSchema,
  startedAt: isoTimestampSchema.optional(),
  endedAt: isoTimestampSchema.optional(),
  durationMs: z.number().optional(),
  isError: z.boolean().optional(),
  resultText: z.string().optional(),
});

export type ToolExecution = z.infer<typeof toolExecutionSchema>;

export const approvalRequestSchema = z.object({
  requestId: z.string(),
  taskId: z.string(),
  toolCallId: z.string(),
  toolName: z.string(),
  cwd: z.string(),
  target: z.string(),
  rawCommand: z.string().optional(),
  risk: z.string(),
  expiresAt: isoTimestampSchema,
  oldText: z.string().optional(),
  newText: z.string().optional(),
  content: z.string().optional(),
});

export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;

const finiteNumber = z.number().finite();
const optionalFinite = finiteNumber.optional();
const nullableFinite = finiteNumber.nullable().optional();

export const sessionStatsSchema = z
  .object({
    sessionFile: z.string().optional(),
    sessionId: z.string().optional(),
    userMessages: optionalFinite,
    assistantMessages: optionalFinite,
    toolCalls: optionalFinite,
    toolResults: optionalFinite,
    totalMessages: optionalFinite,
    tokens: z
      .object({
        input: optionalFinite,
        output: optionalFinite,
        cacheRead: optionalFinite,
        cacheWrite: optionalFinite,
        total: optionalFinite,
      })
      .passthrough()
      .optional(),
    cost: optionalFinite,
    contextUsage: z
      .object({
        tokens: nullableFinite,
        contextWindow: optionalFinite,
        percent: nullableFinite,
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type SessionStats = z.infer<typeof sessionStatsSchema>;

export type SessionStatsFallback = {
  totalMessages?: number;
  toolCalls?: number;
  contextWindow?: number;
};

export function normalizeSessionStats(raw: unknown, fallback: SessionStatsFallback = {}): SessionStats {
  const parsed = sessionStatsSchema.safeParse(raw && typeof raw === "object" ? raw : {});
  const stats: SessionStats = parsed.success ? parsed.data : {};
  const tokensTotal = stats.tokens?.total;
  const window = stats.contextUsage?.contextWindow ?? fallback.contextWindow;
  let contextUsage = stats.contextUsage;
  if (!contextUsage && (tokensTotal != null || window != null)) {
    const tokens = tokensTotal ?? null;
    contextUsage = {
      tokens,
      contextWindow: window,
      percent: tokens != null && window ? Math.min(100, (tokens / window) * 100) : null,
    };
  }
  return {
    ...stats,
    totalMessages: stats.totalMessages ?? fallback.totalMessages,
    toolCalls: stats.toolCalls ?? fallback.toolCalls,
    contextUsage,
  };
}

export const timelineImageSchema = z.object({
  mimeType: z.string().min(1),
  dataUrl: z.string().min(1).optional(),
  name: z.string().optional(),
});

export type TimelineImage = z.infer<typeof timelineImageSchema>;

export const timelineMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "toolResult", "system"]),
  text: z.string(),
  thinking: z.string().optional(),
  thinkingDurationMs: z.number().optional(),
  createdAt: isoTimestampSchema,
  streaming: z.boolean().optional(),
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
  isError: z.boolean().optional(),
  images: z.array(timelineImageSchema).optional(),
});

export type TimelineMessage = z.infer<typeof timelineMessageSchema>;
