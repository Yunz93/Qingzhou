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
  id, itemId: id, scopeId: id, version: z.number().int().positive(), previousId: id.nullable(),
  content: z.string().max(16000), reason: z.string().max(2000),
  moduleChanges: z.array(moduleChangeSchema).max(8),
  createdAt: time, confirmedAt: time.nullable(), frozenAt: time.nullable(), deliveryId: id.nullable(),
});
export type RequirementPrd = z.infer<typeof requirementPrdSchema>;
export const designModuleSchema = z.object({
  id, projectId: id, name: z.string().min(1).max(200), createdAt: time,
});
export type DesignModule = z.infer<typeof designModuleSchema>;
export const moduleRevisionSchema = z.object({
  id, moduleId: id, version: z.number().int().positive(), previousId: id.nullable(),
  content: z.string().max(12000), sourcePrdId: id.nullable(), deliveryId: id.nullable(), createdAt: time,
});
export type ModuleRevision = z.infer<typeof moduleRevisionSchema>;

export const workspaceDesignSchema = z.object({
  schemaVersion: z.literal(1), prdId: id, content: z.string().max(16000),
  moduleChanges: z.array(moduleChangeSchema).max(8),
});
export type WorkspaceDesign = z.infer<typeof workspaceDesignSchema>;
export const requirementDesignPath = (itemId: string) => `docs/qingzhou/requirements/${itemId}.json`;
