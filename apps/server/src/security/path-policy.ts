import { lstat, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export class PathPolicyError extends Error {
  readonly status: number;

  constructor(message: string, status = 403) {
    super(message);
    this.name = "PathPolicyError";
    this.status = status;
  }
}

export function exportAllowedRoots(input: {
  homeDir: string;
  dataDir: string;
  allowedRoots: string[];
  tmpDir?: string;
}): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const root of [...input.allowedRoots, input.homeDir, input.dataDir, input.tmpDir ?? os.tmpdir()]) {
    const resolved = path.resolve(root);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    unique.push(resolved);
  }
  return unique;
}

export async function resolveReadableExportPath(inputPath: string, roots: string[]): Promise<string> {
  const trimmed = inputPath.trim();
  if (!trimmed) {
    throw new PathPolicyError("Missing export path", 400);
  }
  const absolute = path.resolve(trimmed);
  if (path.extname(absolute).toLowerCase() !== ".html") {
    throw new PathPolicyError("Only HTML exports can be opened", 400);
  }

  let resolved: string;
  try {
    resolved = await realpath(absolute);
  } catch {
    throw new PathPolicyError("Export file not found", 404);
  }

  if (path.extname(resolved).toLowerCase() !== ".html") {
    throw new PathPolicyError("Only HTML exports can be opened", 400);
  }

  const stats = await lstat(resolved);
  if (!stats.isFile()) {
    throw new PathPolicyError("Export path is not a file", 400);
  }

  const realRoots = await Promise.all(
    roots.map(async (root) => {
      try {
        return await realpath(root);
      } catch {
        return path.resolve(root);
      }
    }),
  );
  if (!realRoots.some((root) => isInsideRoot(resolved, root))) {
    throw new PathPolicyError("Export path is outside allowed roots", 403);
  }
  return resolved;
}

export function isInsideRoot(candidate: string, root: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Roots the user can pick: configured workspaces plus $HOME (same as the folder browser). */
export function userCwdRoots(homeDir: string, allowedRoots: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const root of [...allowedRoots, homeDir]) {
    const trimmed = root.trim();
    if (!trimmed) continue;
    const resolved = path.resolve(trimmed);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    unique.push(resolved);
  }
  return unique;
}

export async function resolveExistingRoots(roots: string[]): Promise<string[]> {
  const resolved: string[] = [];
  for (const root of roots) {
    try {
      resolved.push(await realpath(root));
    } catch {
      // Stale settings / deleted folders should not fail every cwd check.
    }
  }
  return resolved;
}

export function isProtectedWriteTarget(resolvedPath: string): boolean {
  const parts = resolvedPath.split(path.sep);
  const base = path.basename(resolvedPath);
  if (base === ".env" || base.startsWith(".env.")) return true;
  if (parts.includes(".ssh")) return true;
  if (base === "auth.json" && (parts.includes(".pi") || parts.includes("pi-agent"))) return true;
  return false;
}

export async function resolveAllowedPath(
  inputPath: string,
  cwd: string,
  allowedRoots: string[],
): Promise<string> {
  const absolute = path.isAbsolute(inputPath) ? inputPath : path.join(cwd, inputPath);
  let ancestor = absolute;
  let resolved: string;
  const missing: string[] = [];
  for (;;) {
    try {
      resolved = path.join(await realpath(ancestor), ...missing);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const stats = await lstat(ancestor).catch((statError: NodeJS.ErrnoException) => {
        if (statError.code !== "ENOENT") throw statError;
        return null;
      });
      if (stats?.isSymbolicLink()) throw new PathPolicyError(`Cannot resolve symlink: ${inputPath}`);
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      missing.unshift(path.basename(ancestor));
      ancestor = parent;
    }
  }

  const realCwd = await realpath(cwd);
  if (!isInsideRoot(resolved, realCwd)) {
    throw new PathPolicyError(`Path escapes working directory: ${inputPath}`);
  }

  const realRoots = await resolveExistingRoots(allowedRoots);
  if (!realRoots.some((root) => isInsideRoot(resolved, root))) {
    throw new PathPolicyError(`路径不在允许的范围内：${inputPath}`);
  }

  try {
    const stats = await lstat(absolute);
    if (stats.isSymbolicLink()) {
      if (!isInsideRoot(resolved, realCwd)) {
        throw new PathPolicyError(`Symlink escapes working directory: ${inputPath}`);
      }
    }
  } catch {
    // File may not exist yet.
  }

  if (isProtectedWriteTarget(resolved)) {
    throw new PathPolicyError(`Writes to ${path.basename(resolved)} are blocked`);
  }

  return resolved;
}

export async function assertAllowedCwd(cwd: string, allowedRoots: string[]): Promise<string> {
  let resolved: string;
  try {
    resolved = await realpath(cwd);
  } catch {
    throw new PathPolicyError(`工作文件夹不存在：${cwd}`);
  }
  const stats = await lstat(cwd).catch(() => null);
  if (stats?.isSymbolicLink()) {
    const real = await realpath(cwd);
    if (real !== resolved) {
      throw new PathPolicyError(`工作文件夹的符号链接无效：${cwd}`);
    }
  }
  const realRoots = await resolveExistingRoots(allowedRoots);
  if (realRoots.length === 0 || !realRoots.some((root) => isInsideRoot(resolved, root))) {
    throw new PathPolicyError("工作文件夹不在允许的范围内");
  }
  return resolved;
}
