import { z } from "zod";

export const geminiTargetRevisionSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const geminiTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("official") }),
  z.object({ kind: z.literal("custom"), origins: z.array(z.string()).min(1), revision: geminiTargetRevisionSchema }),
  z.object({ kind: z.literal("unavailable") }),
]);
export type GeminiTarget = z.infer<typeof geminiTargetSchema>;

export const authEntrySourceSchema = z.enum(["auth_file", "env", "models_json", "other"]);
export type AuthEntrySource = z.infer<typeof authEntrySourceSchema>;

export const authEntrySchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["api_key", "oauth", "other"]),
  /** Where the credential comes from; omitted payloads are treated as auth.json. */
  source: authEntrySourceSchema.optional(),
  /** Environment variable name when `source` is "env". */
  envVar: z.string().optional(),
});
export type AuthEntry = z.infer<typeof authEntrySchema>;

export const interactionRequestSchema = z.object({
  requestId: z.string(),
  taskId: z.string(),
  method: z.enum(["select", "input", "notify"]),
  title: z.string().optional(),
  message: z.string().optional(),
  options: z.array(z.string()).optional(),
  placeholder: z.string().optional(),
  notifyType: z.enum(["info", "warning", "error"]).optional(),
});
export type InteractionRequest = z.infer<typeof interactionRequestSchema>;

export const piResourceFileSchema = z.object({
  path: z.string(),
  kind: z.enum(["agents", "override", "claude", "system", "append"]),
});

export const piSkillSchema = z.object({
  name: z.string(),
  path: z.string(),
  scope: z.enum(["user", "project"]),
  enabled: z.boolean().default(true),
});

export const piExtensionSchema = z.object({
  name: z.string(),
  path: z.string(),
  scope: z.enum(["user", "project"]),
  enabled: z.boolean().default(true),
});

export const piPackageSchema = z.object({
  source: z.string(),
  scope: z.enum(["user", "project"]),
});

export const piResourcesSchema = z.object({
  agentsFiles: z.array(piResourceFileSchema),
  skills: z.array(piSkillSchema),
  templates: z.array(piSkillSchema),
  extensions: z.array(piExtensionSchema).default([]),
  packages: z.array(piPackageSchema).default([]),
  trustProject: z.boolean(),
});
export type PiResources = z.infer<typeof piResourcesSchema>;

export const runtimeStateSchema = z.object({
  compacting: z.boolean(),
  compactionReason: z.string().optional(),
  retrying: z.boolean(),
  retryAttempt: z.number().optional(),
  retryMax: z.number().optional(),
  retryError: z.string().optional(),
  steering: z.array(z.string()),
  followUp: z.array(z.string()),
  autoCompaction: z.boolean().optional(),
  autoRetry: z.boolean().optional(),
  fastModeEnabled: z.boolean().optional(),
  fastModeActive: z.boolean().optional(),
});
export type RuntimeState = z.infer<typeof runtimeStateSchema>;

export function emptyRuntime(): RuntimeState {
  return {
    compacting: false,
    retrying: false,
    steering: [],
    followUp: [],
    autoCompaction: true,
    autoRetry: true,
  };
}

export const sessionTreeNodeSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  role: z.string(),
  text: z.string(),
  leaf: z.boolean().optional(),
});
export type SessionTreeNode = z.infer<typeof sessionTreeNodeSchema>;

export const piSessionRefSchema = z.object({
  path: z.string(),
  id: z.string().optional(),
  cwd: z.string().optional(),
  name: z.string().optional(),
  preview: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type PiSessionRef = z.infer<typeof piSessionRefSchema>;
