import type { DesignModule, RequirementPrd, WorkflowState } from "@qingzhou/protocol";
import { readWorkspaceText, writeWorkspaceText } from "./workspace-files.js";
import { workflowGit as git } from "./workflow-git.js";

const marker = "<!-- qingzhou-module-content -->\n";
export function moduleDocument(module: DesignModule, prd: RequirementPrd, content: string): string {
  return `# ${module.name}\n\n模块 ID：${module.id}\n来源 PRD：${prd.id}\n需求设计：../qingzhou/requirements/${prd.itemId}/PRD.md\n\n设计提案随代码交付；确认与合入状态以平台记录及当前 Git 版本为准。\n\n${marker}${content}\n`;
}
export function moduleDocumentContent(text: string): string {
  const index = text.indexOf(marker);
  if (index < 0) throw new Error("模块文档缺少设计正文标记，请恢复文档结构");
  const content = text.slice(index + marker.length).trimEnd();
  if (!content.trim() || content.length > 12000) throw new Error("模块设计正文不能为空且不能超过 12000 字符");
  return content;
}
export async function materializeModuleDocuments(cwd: string, prd: RequirementPrd, state: WorkflowState): Promise<void> {
  const pending: Array<[string, string]> = [];
  for (const change of prd.moduleChanges) {
    const module = state.modules?.find((entry) => entry.id === change.moduleId);
    if (!module?.documentPath) continue;
    const desired = moduleDocument(module, prd, change.content);
    const existing = await readWorkspaceText(cwd, module.documentPath);
    if (existing !== null && existing !== desired) {
      const tracked = await git(cwd, ["show", `HEAD:${module.documentPath}`]).catch(() => null);
      const previous = state.prds?.some((entry) => entry.itemId === prd.itemId && entry.moduleChanges.some((item) =>
        item.moduleId === module.id && moduleDocument(module, entry, item.content) === existing));
      if (!previous && (tracked === null || tracked !== existing.trimEnd())) throw new Error("模块仓库文档有未同步编辑，请先合并至需求模块提案再继续");
      if (!existing.includes(marker)) throw new Error("模块路径已有手工文档，未覆盖；请先明确文档归属");
    }
    pending.push([module.documentPath, desired]);
  }
  for (const [file, content] of pending) await writeWorkspaceText(cwd, file, content, true);
}
