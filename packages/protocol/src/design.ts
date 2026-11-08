import { z } from "zod";
import { documentSourceSchema } from "./documents.js";

const id = z.string().uuid();
const time = z.string().datetime();
export const moduleChangeSchema = z.object({
  document: documentSourceSchema.optional(),
  moduleId: id, baseRevisionId: id.nullable(), content: z.string().min(1).max(12000),
});
export const requirementPlanSchema = z.object({
  itemId: id, confirmedScopeId: id.nullable(), currentPrdId: id.nullable(),
});
export type RequirementPlan = z.infer<typeof requirementPlanSchema>;
export const requirementPrdSchema = z.object({
  document: documentSourceSchema.optional(), documentError: z.string().optional(),
  codeBaseline: z.object({ commit: z.string().regex(/^[a-f0-9]{40,64}$/), moduleRevisionIds: z.record(id.nullable()) }).optional(),
  id, itemId: id, scopeId: id, version: z.number().int().positive(), previousId: id.nullable(),
  content: z.string().max(16000), reason: z.string().max(2000),
  moduleChanges: z.array(moduleChangeSchema).max(8),
  createdAt: time, confirmedAt: time.nullable(), frozenAt: time.nullable(), deliveryId: id.nullable(),
});
export type RequirementPrd = z.infer<typeof requirementPrdSchema>;
export const designModuleSchema = z.object({
  documentPath: z.string().optional(),
  documentFormat: z.literal("markdown").optional(),
  id, projectId: id, name: z.string().min(1).max(200), createdAt: time,
});
export type DesignModule = z.infer<typeof designModuleSchema>;
export const moduleRevisionSchema = z.object({
  document: documentSourceSchema.optional(), documentError: z.string().optional(),
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
  moduleChanges: z.array(moduleChangeSchema.omit({ document: true })).max(8), questions: z.array(z.string().min(1).max(1000)).max(20),
});
export const designProposalSchema = designProposalInputSchema.extend({ id, runId: id, createdAt: time });
export type DesignProposal = z.infer<typeof designProposalSchema>;
export function extractDesignProposal(text: string) {
  const proposals = [];
  const lines = text.split(/\r\n?|\n/);
  let opened: { marker: string; length: number; info: string; start: number } | null = null;
  // Track every outer code block so examples stay examples. Each line is visited once,
  // including malformed replies with thousands of opening fences and no closing one.
  for (let index = 0; index < lines.length; index++) {
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[index]!);
    if (!fence) continue;
    const marker = fence[1]![0]!;
    const info = fence[2]!;
    if (!opened) {
      if (marker === "`" && info.includes("`")) continue;
      opened = { marker, length: fence[1]!.length, info, start: index + 1 };
      continue;
    }
    if (marker !== opened.marker || fence[1]!.length < opened.length || !/^[ \t]*$/.test(info)) continue;
    const block = opened;
    opened = null;
    const language = /^[ \t]*(qingzhou-design|json)[ \t]*$/.exec(block.info)?.[1];
    if (!language) continue;
    const body = lines.slice(block.start, index).join("\n");
    let value: unknown;
    try { value = JSON.parse(body); }
    catch (error) {
      if (language === "qingzhou-design") throw error;
      if (/"schemaVersion"\s*:/.test(body) && /"itemId"\s*:/.test(body) && /"scopeId"\s*:/.test(body)) throw new Error("设计提案 JSON 格式无效，请让 Agent 重新生成。");
      continue;
    }
    // Generic JSON is a proposal only when it carries the proposal's identity.
    if (language === "json" && !(value && typeof value === "object" && "schemaVersion" in value && "itemId" in value && "scopeId" in value)) continue;
    proposals.push(designProposalInputSchema.parse(value));
  }
  if (proposals.length > 1) throw new Error("请每轮只提供一个结构化设计提案");
  return proposals[0] ?? null;
}
