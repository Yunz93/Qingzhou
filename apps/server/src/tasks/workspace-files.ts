import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { safeWorkflowPath } from "./workflow-git.js";

async function workspacePath(cwd: string, relative: string, create: boolean): Promise<string> {
  safeWorkflowPath(relative);
  const root = await realpath(cwd);
  const parts = relative.split("/"); let parent = root;
  for (const segment of parts.slice(0, -1)) {
    parent = path.join(parent, segment);
    if (create) await mkdir(parent).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
    const stat = await lstat(parent);
    if (stat.isSymbolicLink() || !stat.isDirectory() || await realpath(parent) !== parent) throw new Error("文档路径包含链接或非目录，请恢复正常目录后重试");
  }
  const file = path.join(root, ...parts);
  const stat = await lstat(file).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
  if (stat?.isSymbolicLink()) throw new Error("文档不能是符号链接");
  if (stat && !stat.isFile()) throw new Error("文档路径不是普通文件");
  return file;
}
export async function readWorkspaceText(cwd: string, relative: string, maxBytes = 512 * 1024): Promise<string | null> {
  let handle;
  try {
    const file = await workspacePath(cwd, relative, false);
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new Error(`文档无效或超过 ${Math.round(maxBytes / 1024)} KiB`);
    const buffer = Buffer.alloc(maxBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
      if (!bytesRead) break; offset += bytesRead;
    }
    if (offset > maxBytes) throw new Error(`文档无效或超过 ${Math.round(maxBytes / 1024)} KiB`);
    return buffer.subarray(0, offset).toString("utf8");
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  finally { await handle?.close(); }
}
/** Default to create-only: project-owned instructions are never overwritten by scaffolding. */
export async function writeWorkspaceText(cwd: string, relative: string, content: string, replace = false): Promise<boolean> {
  const file = await workspacePath(cwd, relative, true);
  const temporary = replace ? `${file}.${randomUUID()}.tmp` : file;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(content); await handle.sync(); await handle.close(); handle = undefined;
    if (replace) await rename(temporary, file);
    return true;
  } catch (error) { if (!replace && (error as NodeJS.ErrnoException).code === "EEXIST") return false; throw error; }
  finally {
    await handle?.close();
    if (replace) await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  }
}
