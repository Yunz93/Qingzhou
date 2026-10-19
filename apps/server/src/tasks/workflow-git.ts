import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const exec = promisify(execFile);
const hooksDirectory = mkdtemp(path.join(os.tmpdir(), "qingzhou-empty-hooks-"));
export async function workflowGit(cwd: string, args: string[], input?: string): Promise<string> {
  // Requirement and module baseline paths can exceed Windows' legacy MAX_PATH.
  const execution = exec("git", ["--literal-pathspecs", "-c", "core.longpaths=true", "-c", "core.quotePath=false", "-c", `core.hooksPath=${await hooksDirectory}`,
    "-c", "commit.gpgsign=false", "-c", "user.name=Qingzhou", "-c", "user.email=qingzhou@local", ...args], {
    cwd, timeout: 30_000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_MERGE_AUTOEDIT: "no", GIT_EDITOR: "true", GIT_OPTIONAL_LOCKS: "0" },
  });
  if (input !== undefined) execution.child.stdin?.end(input);
  const { stdout } = await execution;
  return stdout.trimEnd();
}

export async function repositoryInfo(cwd: string): Promise<{ repository: string; commonDir: string; branch: string; head: string; branches: string[]; dirty: string[] }> {
  const repository = await realpath(await workflowGit(cwd, ["rev-parse", "--show-toplevel"]));
  const commonDir = await realpath(await workflowGit(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
  const [branch, head, branches, dirty] = await Promise.all([
    workflowGit(cwd, ["branch", "--show-current"]), workflowGit(cwd, ["rev-parse", "HEAD"]),
    workflowGit(cwd, ["for-each-ref", "--format=%(refname:short)", "refs/heads/"]), changedPaths(cwd),
  ]);
  return { repository, commonDir, branch, head, branches: branches.split("\n").filter(Boolean), dirty };
}

export async function changedPaths(cwd: string): Promise<string[]> {
  const raw = await workflowGit(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const entries = raw.split("\0");
  const paths: string[] = [];
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (!entry) continue;
    paths.push(entry.slice(3));
    if (/[RC]/.test(entry.slice(0, 2)) && entries[index + 1]) paths.push(entries[++index]!);
  }
  return [...new Set(paths)];
}

export function safeWorkflowPath(file: string): string {
  if (!file || file.includes("\0") || file.includes("\\") || file.startsWith("/") || /^[A-Za-z]:/.test(file)
    || file.split("/").some((segment) => segment === ".." || segment === ".git" || segment === "." || !segment)) throw new Error("无效的交付文件路径");
  return file;
}

export function redactWorkflowLog(text: string): string {
  let result = text;
  for (const [key, value] of Object.entries(process.env)) {
    if (value && value.length >= 8 && /(?:token|secret|password|api[_-]?key|credential)/i.test(key)) result = result.replaceAll(value, "[已隐藏]");
  }
  return result.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[已隐藏]@")
    .replace(/((?:api[_-]?key|token|password|secret|authorization)\s*[:=]\s*)(?:Bearer\s+)?[^\s"',;]+/gi, "$1[已隐藏]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "[已隐藏]");
}

/** Read a bounded artifact from the immutable Git object, never the live workspace. */
export async function workflowArtifact(cwd: string, commit: string, file: string): Promise<{ mimeType: string; dataUrl?: string; text?: string }> {
  safeWorkflowPath(file);
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error("无效的交付版本");
  const spec = `${commit}:${file}`;
  const size = Number(await workflowGit(cwd, ["cat-file", "-s", spec]));
  if (!Number.isFinite(size) || size > 2 * 1024 * 1024) throw new Error("产物超过 2 MiB，请在本地审阅");
  const { stdout } = await exec("git", ["show", spec], { cwd, encoding: "buffer", timeout: 10000, maxBuffer: 2 * 1024 * 1024 + 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
  const mimeType = ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" } as Record<string, string>)[path.extname(file).toLowerCase()];
  if (mimeType) return { mimeType, dataUrl: `data:${mimeType};base64,${stdout.toString("base64")}` };
  if (stdout.includes(0)) throw new Error("该二进制产物需在本地打开");
  return { mimeType: "text/plain", text: stdout.toString("utf8") };
}
