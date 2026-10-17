import { requirementDesignPath, workspaceDesignSchema, type WorkspaceDesign } from "@qingzhou/protocol";
import { readWorkspaceText, writeWorkspaceText } from "./workspace-files.js";

export async function readWorkspaceDesign(cwd: string, itemId: string): Promise<WorkspaceDesign | null> {
  if (!/^[a-f0-9-]{36}$/.test(itemId)) throw new Error("无效的需求标识");
  const text = await readWorkspaceText(cwd, requirementDesignPath(itemId));
  if (text === null) return null;
  try {
    const parsed = workspaceDesignSchema.safeParse(JSON.parse(text));
    if (!parsed.success) throw new Error("设计文档字段无效，请保留 schemaVersion、prdId、content 和 moduleChanges，并检查内容长度");
    return parsed.data;
  } catch (error) { if (error instanceof SyntaxError) throw new Error("工作区设计文档不是有效 JSON，请修复后同步"); throw error; }
}
export async function writeWorkspaceDesign(cwd: string, itemId: string, document: WorkspaceDesign): Promise<void> {
  if (!/^[a-f0-9-]{36}$/.test(itemId)) throw new Error("无效的需求标识");
  await writeWorkspaceText(cwd, requirementDesignPath(itemId), JSON.stringify(document, null, 2) + "\n", true);
}
