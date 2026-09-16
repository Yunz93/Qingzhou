import { z } from "zod";
import { approvalPolicySchema, interactionModeSchema, thinkingLevelSchema } from "./task-schema.js";

export const PROMPT_MESSAGE_MAX = 100_000;

const commandBase = {
  id: z.string().min(1),
  taskId: z.string().optional(),
};

const promptPayloadSchema = z
  .object({
    message: z.string().max(PROMPT_MESSAGE_MAX),
    imageIds: z.array(z.string()).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.message.trim() && (!value.imageIds || value.imageIds.length === 0)) {
      ctx.addIssue({ code: "custom", message: "需要文字或图片" });
    }
  });

export const clientCommandSchema = z.discriminatedUnion("type", [
  z.object({
    ...commandBase,
    type: z.literal("task.create"),
    payload: z.object({
      cwd: z.string().min(1).optional(),
      title: z.string().min(1).optional(),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("task.activate"),
    taskId: z.string().min(1),
    payload: z.object({}).optional(),
  }),
  z.object({
    ...commandBase,
    type: z.literal("task.rename"),
    taskId: z.string().min(1),
    payload: z.object({ title: z.string().min(1).max(200) }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("task.archive"),
    taskId: z.string().min(1),
    payload: z.object({}).optional(),
  }),
  z.object({
    ...commandBase,
    type: z.literal("task.reorder"),
    payload: z.object({
      cwd: z.string().min(1),
      taskIds: z.array(z.string().uuid()).min(1),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("prompt.send"),
    taskId: z.string().min(1),
    payload: promptPayloadSchema,
  }),
  z.object({
    ...commandBase,
    type: z.literal("prompt.steer"),
    taskId: z.string().min(1),
    payload: promptPayloadSchema,
  }),
  z.object({
    ...commandBase,
    type: z.literal("prompt.followUp"),
    taskId: z.string().min(1),
    payload: promptPayloadSchema,
  }),
  z.object({
    ...commandBase,
    type: z.literal("prompt.queue.edit"),
    taskId: z.string().min(1),
    payload: z.object({
      kind: z.enum(["steering", "followUp"]),
      index: z.number().int().nonnegative(),
      previousMessage: z.string().min(1).max(PROMPT_MESSAGE_MAX),
      message: z.string().trim().min(1).max(PROMPT_MESSAGE_MAX),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("agent.abort"),
    taskId: z.string().min(1),
    payload: z.object({}).optional(),
  }),
  z.object({
    ...commandBase,
    type: z.literal("model.set"),
    taskId: z.string().min(1),
    payload: z.object({
      provider: z.string().min(1),
      modelId: z.string().min(1),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("model.default.set"),
    taskId: z.string().min(1),
    payload: z.object({
      provider: z.string().min(1),
      modelId: z.string().min(1),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("thinking.set"),
    taskId: z.string().min(1),
    payload: z.object({ level: thinkingLevelSchema }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("approval.respond"),
    taskId: z.string().min(1),
    payload: z.object({
      requestId: z.string().min(1),
      allow: z.boolean(),
      remember: z.boolean().optional(),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("task.policy.set"),
    taskId: z.string().min(1),
    payload: z.object({
      mode: interactionModeSchema,
      approvalPolicy: approvalPolicySchema,
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("session.fork"),
    taskId: z.string().min(1),
    payload: z.object({
      messageId: z.string().min(1),
      message: z.string().min(1).optional(),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("session.clone"),
    taskId: z.string().min(1),
    payload: z.object({}).optional(),
  }),
  z.object({
    ...commandBase,
    type: z.literal("git.status"),
    taskId: z.string().min(1),
    payload: z.object({}).optional(),
  }),
  z.object({
    ...commandBase,
    type: z.literal("checkpoint.list"),
    taskId: z.string().min(1),
    payload: z.object({}).optional(),
  }),
  z.object({
    ...commandBase,
    type: z.literal("checkpoint.restore"),
    taskId: z.string().min(1),
    payload: z.object({
      checkpointId: z.string().min(1).optional(),
      path: z.string().min(1).optional(),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("git.diff"),
    taskId: z.string().min(1),
    payload: z.object({}).optional(),
  }),
  z.object({
    ...commandBase,
    type: z.literal("git.commit"),
    taskId: z.string().min(1),
    payload: z.object({
      message: z.string().min(1).max(400),
      push: z.boolean().optional(),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("git.init"),
    taskId: z.string().min(1),
    payload: z.object({}).optional(),
  }),
  z.object({
    ...commandBase,
    type: z.literal("git.restore"),
    taskId: z.string().min(1),
    payload: z.object({
      path: z.string().min(1).optional(),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("resources.reload"),
    taskId: z.string().min(1),
    payload: z.object({}).optional(),
  }),
  z.object({
    ...commandBase,
    type: z.literal("resources.createAgents"),
    taskId: z.string().min(1),
    payload: z.object({}).optional(),
  }),
  z.object({
    ...commandBase,
    type: z.literal("resources.read"),
    taskId: z.string().min(1),
    payload: z.object({ path: z.string().min(1) }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("resources.write"),
    taskId: z.string().min(1),
    payload: z.object({
      path: z.string().min(1),
      content: z.string().max(200_000),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("resources.skill.set"),
    taskId: z.string().min(1),
    payload: z.object({
      path: z.string().min(1),
      enabled: z.boolean(),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("resources.extension.set"),
    taskId: z.string().min(1),
    payload: z.object({
      path: z.string().min(1),
      enabled: z.boolean(),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("resources.skill.updates"),
    taskId: z.string().min(1),
    payload: z
      .object({
        paths: z.array(z.string().min(1)).max(80).optional(),
      })
      .optional(),
  }),
  z.object({
    ...commandBase,
    type: z.literal("resources.skill.update"),
    taskId: z.string().min(1),
    payload: z
      .object({
        paths: z.array(z.string().min(1)).max(80).optional(),
      })
      .optional(),
  }),
  z.object({
    ...commandBase,
    type: z.literal("resources.package.install"),
    taskId: z.string().min(1),
    payload: z
      .object({
        ids: z.array(z.string().min(1).max(80)).max(20).optional(),
      })
      .optional(),
  }),
  z.object({
    ...commandBase,
    type: z.literal("files.open"),
    taskId: z.string().min(1),
    payload: z.object({ path: z.string().min(1) }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("interaction.respond"),
    taskId: z.string().min(1),
    payload: z.object({
      requestId: z.string().min(1),
      cancelled: z.boolean().optional(),
      value: z.string().optional(),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("commands.list"),
    taskId: z.string().min(1),
    payload: z.object({}).optional(),
  }),
  z.object({
    ...commandBase,
    type: z.literal("session.compact"),
    taskId: z.string().min(1),
    payload: z.object({ customInstructions: z.string().optional() }).optional(),
  }),
  z.object({
    ...commandBase,
    type: z.literal("session.stats"),
    taskId: z.string().min(1),
    payload: z.object({}).optional(),
  }),
  z.object({
    ...commandBase,
    type: z.literal("snapshot.request"),
    payload: z.object({ taskId: z.string().optional() }).optional(),
  }),
  z.object({
    ...commandBase,
    type: z.literal("files.tree"),
    taskId: z.string().min(1),
    payload: z.object({}).optional(),
  }),
  z.object({
    ...commandBase,
    type: z.literal("files.read"),
    taskId: z.string().min(1),
    payload: z.object({ path: z.string().min(1) }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("task.search"),
    payload: z.object({ query: z.string() }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("session.tree"),
    taskId: z.string().min(1),
    payload: z.object({}).optional(),
  }),
  z.object({
    ...commandBase,
    type: z.literal("session.branch"),
    taskId: z.string().min(1),
    payload: z.object({ entryId: z.string().min(1), message: z.string().optional() }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("sessions.list"),
    payload: z.object({ cwd: z.string().optional() }).optional(),
  }),
  z.object({
    ...commandBase,
    type: z.literal("session.resume"),
    payload: z.object({
      sessionPath: z.string().min(1),
      cwd: z.string().min(1).optional(),
      title: z.string().min(1).optional(),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("session.export"),
    taskId: z.string().min(1),
    payload: z.object({}).optional(),
  }),
  z.object({
    ...commandBase,
    type: z.literal("resources.list"),
    taskId: z.string().min(1),
    payload: z.object({}).optional(),
  }),
  z.object({
    ...commandBase,
    type: z.literal("runtime.set"),
    taskId: z.string().min(1),
    payload: z.object({
      autoCompaction: z.boolean().optional(),
      autoRetry: z.boolean().optional(),
      fastMode: z.boolean().optional(),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("term.start"),
    taskId: z.string().min(1),
    payload: z.object({ cols: z.number().int().min(20).max(500).optional(), rows: z.number().int().min(10).max(200).optional() }).optional(),
  }),
  z.object({
    ...commandBase,
    type: z.literal("term.input"),
    taskId: z.string().min(1),
    payload: z.object({ data: z.string().max(20_000) }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("term.resize"),
    taskId: z.string().min(1),
    payload: z.object({ cols: z.number().int().min(20).max(500), rows: z.number().int().min(10).max(200) }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("term.close"),
    taskId: z.string().min(1),
    payload: z.object({}).optional(),
  }),
  z.object({
    ...commandBase,
    type: z.literal("term.run"),
    taskId: z.string().min(1),
    payload: z.object({ command: z.string().min(1).max(8000) }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("term.interrupt"),
    taskId: z.string().min(1),
    payload: z.object({}).optional(),
  }),
  z.object({
    ...commandBase,
    type: z.literal("term.openNative"),
    taskId: z.string().min(1),
    payload: z.object({}).optional(),
  }),
  z.object({
    ...commandBase,
    type: z.literal("workItem.list"),
    payload: z.object({}).optional(),
  }),
  z.object({
    ...commandBase,
    type: z.literal("workProject.create"),
    payload: z.object({
      name: z.string().min(1).max(200),
      cwd: z.string().min(1),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("workProject.select"),
    payload: z.object({ id: z.string().uuid() }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("workItem.create"),
    payload: z
      .object({
        title: z.string().min(1).max(200),
        description: z.string().max(20_000).optional(),
        acceptanceCriteria: z.string().max(10_000).optional(),
        start: z.boolean().optional(),
        cwd: z.string().min(1).optional(),
        projectId: z.string().uuid().optional(),
      })
      .superRefine((value, ctx) => {
        if (!value.cwd && !value.projectId) {
          ctx.addIssue({ code: "custom", message: "需要项目或文件夹" });
        }
      }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("workItem.update"),
    payload: z.object({
      id: z.string().uuid(),
      title: z.string().min(1).max(200).optional(),
      description: z.string().max(20_000).optional(),
      acceptanceCriteria: z.string().max(10_000).optional(),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("workItem.start"),
    payload: z.object({ id: z.string().uuid() }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("workItem.feedback"),
    payload: z.object({
      id: z.string().uuid(),
      text: z.string().min(1).max(20_000),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("workItem.stop"),
    payload: z.object({ id: z.string().uuid() }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("workItem.accept"),
    payload: z.object({ id: z.string().uuid() }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("workItem.reopen"),
    payload: z.object({ id: z.string().uuid() }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("workItem.archive"),
    payload: z.object({ id: z.string().uuid() }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("workItem.reorder"),
    payload: z.object({
      id: z.string().uuid(),
      beforeId: z.string().uuid().nullable().optional(),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("workItem.details"),
    payload: z.object({ id: z.string().uuid() }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("workItem.append"),
    payload: z.object({
      id: z.string().uuid(),
      text: z.string().min(1).max(20_000),
    }),
  }),
  z.object({
    ...commandBase,
    type: z.literal("workItem.move"),
    payload: z.object({
      id: z.string().uuid(),
      column: z.enum(["todo", "doing", "review", "done", "archived"]),
      beforeId: z.string().uuid().nullable().optional(),
    }),
  }),
]);

export type ClientCommand = z.infer<typeof clientCommandSchema>;
export type ClientCommandType = ClientCommand["type"];

export function formatClientCommandError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "请求无法识别。";
  if (issue.code === "invalid_union_discriminator" || issue.path[0] === "type") {
    return "界面和引擎版本不一致。请完全退出轻舟后重新打开。";
  }
  if (issue.path[0] === "taskId") {
    return "没有对话。";
  }
  return "请求无法识别。";
}
