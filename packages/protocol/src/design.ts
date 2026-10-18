import { z } from "zod";

const id = z.string().uuid();
const time = z.string().datetime();
export const moduleChangeSchema = z.object({
  moduleId: id, baseRevisionId: id.nullable(), content: z.string().min(1).max(12000),
});
export const requirementPlanSchema = z.object({
  itemId: id, confirmedScopeId: id.nullable(), currentPrdId: id.nullable(),
});
export type RequirementPlan = z.infer<typeof requirementPlanSchema>;
export const requirementPrdSchema = z.object({
  codeBaseline: z.object({ commit: z.string().regex(/^[a-f0-9]{40,64}$/), moduleRevisionIds: z.record(id.nullable()) }).optional(),
  id, itemId: id, scopeId: id, version: z.number().int().positive(), previousId: id.nullable(),
  content: z.string().max(16000), reason: z.string().max(2000),
  moduleChanges: z.array(moduleChangeSchema).max(8),
  createdAt: time, confirmedAt: time.nullable(), frozenAt: time.nullable(), deliveryId: id.nullable(),
});
export type RequirementPrd = z.infer<typeof requirementPrdSchema>;
export const designModuleSchema = z.object({
  documentPath: z.string().optional(),
  id, projectId: id, name: z.string().min(1).max(200), createdAt: time,
});
export type DesignModule = z.infer<typeof designModuleSchema>;
export const moduleRevisionSchema = z.object({
  integrationId: id.optional(),
  id, moduleId: id, version: z.number().int().positive(), previousId: id.nullable(),
  content: z.string().max(12000), sourcePrdId: id.nullable(), deliveryId: id.nullable(), createdAt: time,
});
export type ModuleRevision = z.infer<typeof moduleRevisionSchema>;

export const workspaceDesignSchema = z.object({
  schemaVersion: z.literal(1), documentationVersion: z.literal(1).optional(), prdId: id, content: z.string().max(16000),
  moduleChanges: z.array(moduleChangeSchema).max(8),
});
export type WorkspaceDesign = z.infer<typeof workspaceDesignSchema>;
export const requirementDesignPath = (itemId: string) => `docs/qingzhou/requirements/${itemId}.json`;

export const designProposalInputSchema = z.object({
  schemaVersion: z.literal(1), itemId: id, scopeId: id, expectedPrdId: id.nullable(),
  content: z.string().trim().min(1).max(16000), reason: z.string().trim().min(1).max(2000),
  moduleChanges: z.array(moduleChangeSchema).max(8), questions: z.array(z.string().min(1).max(1000)).max(20),
});
export const designProposalSchema = designProposalInputSchema.extend({ id, runId: id, createdAt: time });
export type DesignProposal = z.infer<typeof designProposalSchema>;
export function extractDesignProposal(text: string) {
  const blocks = [...text.matchAll(/```qingzhou-design\s*\n([\s\S]*?)```/g)];
  if (!blocks.length) return null;
  if (blocks.length !== 1) throw new Error("请每轮只提供一个结构化设计提案");
  return designProposalInputSchema.parse(JSON.parse(blocks[0]![1]!));
}
