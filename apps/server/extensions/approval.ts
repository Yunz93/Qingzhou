import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const AUTO_ALLOW = new Set(["read", "grep", "find", "ls"]);
const NEED_APPROVAL = new Set(["edit", "write", "bash"]);
const APPROVAL_TIMEOUT_MS = Number(process.env.QINGZHOU_APPROVAL_TIMEOUT_MS) || 5 * 60 * 1000;

function parseRoots(): string[] {
  return (process.env.QINGZHOU_ALLOWED_ROOTS ?? process.env.MOWEN_ALLOWED_ROOTS ?? process.env.OHMYPI_ALLOWED_ROOTS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isInside(candidate: string, root: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function isProtected(resolvedPath: string): boolean {
  const parts = resolvedPath.split(path.sep);
  const base = path.basename(resolvedPath);
  if (base === ".env" || base.startsWith(".env.")) return true;
  if (parts.includes(".ssh")) return true;
  if (base === "auth.json" && (parts.includes(".pi") || parts.includes("pi-agent"))) return true;
  return false;
}

function resolveWritePath(inputPath: string, cwd: string): string {
  const absolute = path.isAbsolute(inputPath) ? inputPath : path.join(cwd, inputPath);
  let ancestor = absolute;
  const missing: string[] = [];
  for (;;) {
    try {
      return path.join(realpathSync(ancestor), ...missing);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // A dangling symlink is not a missing directory: following it on write
      // could create files outside the project once its target is created.
      if (lstatSync(ancestor, { throwIfNoEntry: false })?.isSymbolicLink()) throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      missing.unshift(path.basename(ancestor));
      ancestor = parent;
    }
  }
}

function assertWritable(inputPath: string, cwd: string, roots: string[]): string | null {
  let resolved: string;
  try {
    resolved = resolveWritePath(inputPath, cwd);
  } catch {
    return `Cannot resolve path: ${inputPath}`;
  }
  try {
    const stats = lstatSync(path.isAbsolute(inputPath) ? inputPath : path.join(cwd, inputPath));
    if (stats.isSymbolicLink() && !isInside(resolved, realpathSync(cwd))) {
      return `Symlink escapes working directory: ${inputPath}`;
    }
  } catch {
    // Missing file is fine for writes.
  }
  const realCwd = realpathSync(cwd);
  if (!isInside(resolved, realCwd)) {
    return `Path escapes working directory: ${inputPath}`;
  }
  if (roots.length > 0 && !roots.some((root) => isInside(resolved, realpathSync(root)))) {
    return `Path is outside allowed roots: ${inputPath}`;
  }
  if (isProtected(resolved)) {
    return `Writes to ${path.basename(resolved)} are blocked`;
  }
  return null;
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    const toolName = event.toolName;
    if (AUTO_ALLOW.has(toolName)) {
      return undefined;
    }

    const cwd = process.cwd();
    const roots = parseRoots();
    const mutations = process.env.QINGZHOU_MUTATIONS ?? process.env.MOWEN_MUTATIONS ?? process.env.OHMYPI_MUTATIONS ?? "approval";
    const input = (event.input ?? {}) as Record<string, unknown>;
    const target =
      toolName === "bash"
        ? String(input.command ?? "")
        : String(input.path ?? "");

    const mutating = NEED_APPROVAL.has(toolName);

    if (toolName === "write" || toolName === "edit") {
      const blocked = assertWritable(target, cwd, roots);
      if (blocked) {
        return { block: true, reason: blocked };
      }
    }

    if (mutations === "disabled") {
      return { block: true, reason: "Mutations are disabled" };
    }

    if (!ctx.hasUI) {
      return { block: true, reason: "No UI available to approve this action" };
    }

    const risk =
      toolName === "bash"
        ? "这条命令会用你的账号权限运行。轻舟不会替你判断它是否安全。"
        : mutating
          ? "这次会改项目里的文件。确认路径没问题再允许。"
          : "这个操作需要你确认后才会继续。";

    const payload = {
      kind: "qingzhou.approval",
      toolName,
      toolCallId: event.toolCallId,
      cwd,
      target,
      rawCommand: toolName === "bash" ? target : undefined,
      risk,
    };

    const message = [
      toolName === "bash" ? `Command:\n${target}` : `Path:\n${target}`,
      `Working directory:\n${cwd}`,
      risk,
      "",
      "QINGZHOU_APPROVAL_V1",
      JSON.stringify(payload),
    ].join("\n");

    const confirmed = await ctx.ui.confirm(`Allow ${toolName}?`, message, {
      timeout: APPROVAL_TIMEOUT_MS,
    });

    if (!confirmed) {
      return { block: true, reason: "Denied by user or timed out" };
    }
    return undefined;
  });
}
