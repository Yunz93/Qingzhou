import { z } from "zod";
import { documentPathsSchema } from "./documents.js";

export const PROJECT_STANDARD_VERSION = 1;
export const AGENT_CONTEXT_MARKER = "\n\n[轻舟 Agent 执行上下文]\n";
export const PROJECT_STANDARD_PATHS = {
  manifest: "docs/qingzhou/project.json",
  index: "docs/README.md",
  layout: "docs/standards/project-layout.md",
  overview: "docs/project/overview.md",
  architecture: "docs/project/architecture.md",
  verification: "docs/project/verification.md",
  workflow: "docs/agents/workflow.md",
  roles: "docs/agents/roles.md",
  modules: "docs/modules/README.md",
  requirements: "docs/requirements/README.md",
  decisions: "docs/decisions/README.md",
} as const;
export const projectStandardManifestSchema = z.object({
  documentPaths: documentPathsSchema.optional(),
  schemaVersion: z.literal(1), standard: z.literal("qingzhou-project"),
  paths: z.object(Object.fromEntries(Object.entries(PROJECT_STANDARD_PATHS).filter(([key]) => key !== "manifest").map(([key, value]) => [key, z.literal(value)])) as Record<Exclude<keyof typeof PROJECT_STANDARD_PATHS, "manifest">, z.ZodLiteral<string>>),
});
export type ProjectStandardInspection = {
  version: number; ready: boolean;
  files: Array<{ path: string; purpose: string; status: "missing" | "present"; preview?: string }>;
};
export const requirementFiles = (itemId: string, prdPath?: string) => {
  const directory = prdPath ? prdPath.slice(0, prdPath.lastIndexOf("/")) : `docs/qingzhou/requirements/${itemId}`;
  return {
    directory, prd: `${directory}/PRD.md`, context: `${directory}/CONTEXT.md`,
    agents: `${directory}/AGENTS.md`, implementation: `${directory}/IMPLEMENTATION.md`,
    verification: `${directory}/VERIFICATION.md`,
    module: (moduleId: string) => `${directory}/modules/${moduleId}.md`,
    baseline: (moduleId: string, revisionId: string) => `${directory}/baselines/${moduleId}-${revisionId}.md`,
  };
};
export const projectAgentContext = () => `\n\n项目协作入口：先阅读根 AGENTS.md、${PROJECT_STANDARD_PATHS.overview}、${PROJECT_STANDARD_PATHS.architecture}、${PROJECT_STANDARD_PATHS.verification} 和 ${PROJECT_STANDARD_PATHS.workflow}（文件存在时）。遵守当前用户授权、仓库约定和本轮阶段边界。运行结果、验收决定与合入事实分别记录，不用文字声明替代真实证据。`;
