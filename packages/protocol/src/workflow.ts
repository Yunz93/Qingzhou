import { z } from "zod";
import type { DocumentPaths } from "./documents.js";
import { requirementPlanSchema, requirementPrdSchema, designModuleSchema, moduleRevisionSchema, designProposalSchema } from "./design.js";

const id = z.string().uuid();
const time = z.string().datetime();
const sha = z.string().regex(/^[a-f0-9]{40,64}$/);

export const workflowCheckSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  command: z.string().min(1).max(4000),
  required: z.boolean(),
  timeoutMs: z.number().int().min(100).max(3_600_000).default(600_000),
  /** Checks sharing this resource run serially across projects. */
  resource: z.string().max(120).default(""),
});
export type WorkflowCheck = z.infer<typeof workflowCheckSchema>;

export const workflowConfigSchema = z.object({
  projectId: id,
  repository: z.string(),
  commonDir: z.string(),
  targetBranch: z.string().min(1).max(200),
  concurrency: z.number().int().min(1).max(16).default(1),
  checks: z.array(workflowCheckSchema).max(30),
  revision: z.number().int().positive(),
  paused: z.boolean().default(false),
  updatedAt: time,
});
export type WorkflowConfig = z.infer<typeof workflowConfigSchema>;

export const scopeRevisionSchema = z.object({
  id, itemId: id, version: z.number().int().positive(),
  title: z.string(), description: z.string(), acceptanceCriteria: z.string(), createdAt: time,
});
export type ScopeRevision = z.infer<typeof scopeRevisionSchema>;

export const requirementWorkspaceSchema = z.object({
  itemId: id, path: z.string(), branch: z.string(), baseline: sha,
  originalPath: z.string(), createdAt: time, removedAt: time.nullable(),
});
export type RequirementWorkspace = z.infer<typeof requirementWorkspaceSchema>;

export const workflowTicketSchema = z.object({
  id, requestId: z.string(), itemId: id, projectId: id, scopeId: id, prdId: id.optional(), documentationVersion: z.literal(1).optional(),
  kind: z.enum(["initial", "feedback", "retry", "migrated", "discussion"]), instruction: z.string(),
  imageIds: z.array(z.string()).max(20).optional(),
  phase: z.enum(["implementation", "integration", "discussion"]),
  status: z.enum(["queued", "running", "finished", "failed", "interrupted", "cancelled"]),
  runId: id.nullable(), integrationId: id.nullable(), error: z.string().nullable(), createdAt: time,
});
export type WorkflowTicket = z.infer<typeof workflowTicketSchema>;

export const verificationSchema = z.object({
  id, projectId: id, itemId: id.nullable(), subjectId: id,
  phase: z.enum(["delivery", "integration", "main"]),
  commit: sha, tree: sha, configRevision: z.number().int().positive(),
  environment: z.string(),
  status: z.enum(["queued", "running", "passed", "failed", "unverified", "interrupted"]),
  startedAt: time, finishedAt: time.nullable(),
  checks: z.array(z.object({
    id: z.string(), name: z.string(), command: z.string(), required: z.boolean(), cwd: z.string(),
    startedAt: time, finishedAt: time.nullable(), exitCode: z.number().nullable(),
    status: z.enum(["running", "passed", "failed", "interrupted"]),
    output: z.string(), truncated: z.boolean(),
  })),
  error: z.string().nullable(),
});
export type Verification = z.infer<typeof verificationSchema>;

export const deliveryReviewSchema = z.object({
  behaviors: z.string().max(6000), unresolved: z.string().max(6000),
  artifactPaths: z.array(z.string().min(1).max(1000)).max(20),
});
export const criterionEvidenceSchema = z.object({
  criterion: z.string().max(10000), note: z.string().max(2000),
  checkIds: z.array(z.string()).max(30), artifactPaths: z.array(z.string()).max(20),
});
export const deliverySchema = z.object({
  review: deliveryReviewSchema.optional(),
  id, itemId: id, scopeId: id, prdId: id.optional(), runId: id.nullable(), ticketId: id.nullable(),
  commit: sha, tree: sha, baseline: sha, files: z.array(z.string()), patch: z.string(),
  summary: z.string(), verificationId: id, createdAt: time,
});
export type Delivery = z.infer<typeof deliverySchema>;

export const deliveryAcceptanceSchema = z.object({
  id, itemId: id, deliveryId: id, scopeId: id,
  evidence: z.array(criterionEvidenceSchema).max(100).optional(),
  decision: z.enum(["accepted", "rejected"]), note: z.string(), createdAt: time,
});
export type DeliveryAcceptance = z.infer<typeof deliveryAcceptanceSchema>;

export const integrationAttemptSchema = z.object({
  documentIndexTree: sha.optional(),
  review: z.object({ candidate: sha, tree: sha, prdId: id.optional(), decision: z.enum(["compatible", "design_changed"]), note: z.string(), createdAt: time }).optional(),
  id, requestId: z.string(), projectId: id, itemId: id, deliveryId: id,
  repositoryKey: z.string(), targetBranch: z.string(),
  status: z.enum(["queued", "preparing", "conflicts", "verifying", "ready", "merging", "merged", "failed", "stale", "cancelled"]),
  baseline: sha.nullable(), candidate: sha.nullable(), tree: sha.nullable(),
  workspace: z.string().nullable(), verificationId: id.nullable(),
  conflicts: z.array(z.string()), patch: z.string(), error: z.string().nullable(),
  mergedCommit: sha.nullable(), createdAt: time, updatedAt: time,
  includedItemIds: z.array(id).optional(),
});
export type IntegrationAttempt = z.infer<typeof integrationAttemptSchema>;

export const workflowCycleSchema = z.object({
  id, requestId: z.string(), itemId: id, scopeId: id, prdId: id.optional(), configRevision: z.number().int().positive(),
  maxRepairs: z.number().int().min(0).max(3), repairs: z.number().int().nonnegative(),
  status: z.enum(["running", "verifying", "ready_for_review", "paused", "cancelled", "interrupted"]),
  error: z.string().nullable(), createdAt: time, deliveryId: id.nullable(),
});
export type WorkflowCycle = z.infer<typeof workflowCycleSchema>;

export const workflowEventSchema = z.object({
  id, sequence: z.number().int().positive(), projectId: id, itemId: id.nullable(),
  type: z.string(), subjectId: z.string().nullable(), message: z.string(), createdAt: time,
  facts: z.object({
    integration: integrationAttemptSchema.optional(),
    ticket: workflowTicketSchema.optional(),
  }).optional(),
});
export type WorkflowEvent = z.infer<typeof workflowEventSchema>;

export const workflowStateSchema = z.object({
  documentFiles: z.array(z.object({ projectId: id, path: z.string(), hash: z.string() })).optional(),
  proposals: z.array(designProposalSchema).optional(), cycles: z.array(workflowCycleSchema).optional(),
  schemaVersion: z.literal(1),
  plans: z.array(requirementPlanSchema).optional(), prds: z.array(requirementPrdSchema).optional(),
  modules: z.array(designModuleSchema).optional(), moduleRevisions: z.array(moduleRevisionSchema).optional(),
  configs: z.array(workflowConfigSchema), scopes: z.array(scopeRevisionSchema),
  workspaces: z.array(requirementWorkspaceSchema),
  dependencies: z.record(z.array(id)), tickets: z.array(workflowTicketSchema),
  deliveries: z.array(deliverySchema), acceptances: z.array(deliveryAcceptanceSchema),
  verifications: z.array(verificationSchema), integrations: z.array(integrationAttemptSchema),
  events: z.array(workflowEventSchema),
});
export type WorkflowState = z.infer<typeof workflowStateSchema>;

export type WorkflowProjectState = WorkflowState & {
  documentPaths?: DocumentPaths;
  documentPathsError?: string;
  mainDesignBaseline?: NonNullable<import("./design.js").RequirementPrd["codeBaseline"]>;
  designBaselines?: Record<string, NonNullable<import("./design.js").RequirementPrd["codeBaseline"]>>;
  queue?: { running: number; verifying: number; reserved: number; used: number; limit: number; reasons: Record<string, string>; resourceWaits: Record<string, string> };
  baselineRelations?: Record<string, { behind: boolean; includedItemIds: string[]; error?: string }>;
  head: string | null;
  mainVerification: Verification | null;
  workspaceStates: Record<string, { head: string | null; dirty: boolean; error: string | null }>;
};

export const ACTIVE_INTEGRATIONS = ["queued", "preparing", "conflicts", "verifying", "ready", "merging"] as const;

/** Only real command evidence at the current tree/config can satisfy required checks. */
export function verificationIsValid(verification: Verification | undefined, config: WorkflowConfig, tree: string): boolean {
  const required = config.checks.filter((check) => check.required);
  return required.length > 0 && !!verification && verification.status === "passed"
    && verification.tree === tree && verification.configRevision === config.revision
    && required.every((check) => verification.checks.some((result) =>
      result.id === check.id && result.command === check.command && result.status === "passed" && result.exitCode === 0));
}
