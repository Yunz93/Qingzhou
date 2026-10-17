import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { requirementDesignPath, workspaceDesignSchema, type WorkspaceDesign } from "@qingzhou/protocol";

async function designPath(cwd: string, itemId: string, create: boolean): Promise<string> {
  if (!/^[a-f0-9-]{36}$/.test(itemId)) throw new Error("无效的需求标识");
  const root = await realpath(cwd);
  let parent = root;
  for (const segment of ["docs", "qingzhou", "requirements"]) {
    parent = path.join(parent, segment);
    if (create) await mkdir(parent).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
    const stat = await lstat(parent);
    if (stat.isSymbolicLink() || !stat.isDirectory() || await realpath(parent) !== parent) throw new Error("设计文档路径包含链接或非目录，请恢复正常目录后重试");
  }
  return path.join(root, requirementDesignPath(itemId));
}
export async function readWorkspaceDesign(cwd: string, itemId: string): Promise<WorkspaceDesign | null> {
  let handle;
  try {
    const file = await designPath(cwd, itemId, false);
    if ((await lstat(file)).isSymbolicLink()) throw new Error("设计文档不能是符号链接");
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 512 * 1024) throw new Error("设计文档无效或超过 512 KiB");
    const parsed = workspaceDesignSchema.safeParse(JSON.parse(await handle.readFile("utf8")));
    if (!parsed.success) throw new Error("设计文档字段无效，请保留 schemaVersion、prdId、content 和 moduleChanges，并检查内容长度");
    return parsed.data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof SyntaxError) throw new Error("工作区设计文档不是有效 JSON，请修复后同步");
    throw error;
  } finally { await handle?.close(); }
}
export async function writeWorkspaceDesign(cwd: string, itemId: string, document: WorkspaceDesign): Promise<void> {
  const file = await designPath(cwd, itemId, true);
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(document, null, 2) + "\n"); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, file);
  } finally { await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; }); }
}
