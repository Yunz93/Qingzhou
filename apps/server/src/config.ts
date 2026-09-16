import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { defaultPiAgentDir } from "./setup/pi-agent-dir.js";

const execFileAsync = promisify(execFile);

export const mutationsSchema = z.enum(["approval", "disabled"]);

export type PiRuntime = {
  command: string;
  prefixArgs: string[];
  extraEnv: NodeJS.ProcessEnv;
};

export type AppConfig = {
  host: string;
  port: number;
  piBin: string;
  piCommand: string;
  piPrefixArgs: string[];
  piExtraEnv: NodeJS.ProcessEnv;
  dataDir: string;
  allowedRoots: string[];
  maxProcesses: number;
  mutations: "approval" | "disabled";
  nodeEnv: string;
  approvalTimeoutMs: number;
  allowedOrigins: string[];
  webDistDir: string;
  approvalExtensionPath: string;
  homeDir: string;
  piBundled: boolean;
  piAgentDir: string;
  trustProject: boolean;
};

export function qingzhouEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  for (const prefix of ["QINGZHOU_", "MOWEN_", "OHMYPI_"]) {
    const current = env[`${prefix}${name}`];
    if (current != null && current !== "") return current;
  }
  return undefined;
}

export function defaultDataDir(homeDir = os.homedir()): string {
  const current = path.join(homeDir, ".qingzhou");
  const mowen = path.join(homeDir, ".mowen");
  const ohmypi = path.join(homeDir, ".ohmypi");
  const legacy = path.join(homeDir, ".mypi-web");
  if (existsSync(current)) return current;
  if (existsSync(mowen)) return mowen;
  if (existsSync(ohmypi)) return ohmypi;
  if (existsSync(legacy)) return legacy;
  return current;
}

export function defaultAllowedRoots(homeDir = os.homedir()): string[] {
  return [homeDir];
}

export function parseAllowedRoots(
  value: string | undefined,
  fallback: string[] = defaultAllowedRoots(),
): string[] {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function resolvePiBin(bin: string): string {
  if (bin === "pi" || path.isAbsolute(bin)) return bin;
  return path.resolve(bin);
}

export function isJavaScriptFile(file: string): boolean {
  return /\.[cm]?js$/i.test(file);
}

/**
 * Desktop reuses the Electron binary as Node. macOS treats a second launch of
 * Contents/MacOS/<App> as a GUI app (generic "exec" Dock icon) even with
 * ELECTRON_RUN_AS_NODE=1. Electron Helper.app sets LSUIElement, so spawn that
 * instead. Always set ELECTRON_RUN_AS_NODE=1 on the child.
 */
export function asNodeEnv(command: string): NodeJS.ProcessEnv {
  if (process.versions.electron || command === process.execPath || isMacosElectronHelperPath(command)) {
    return { ELECTRON_RUN_AS_NODE: "1" };
  }
  return {};
}

export function isMacosElectronHelperPath(command: string): boolean {
  const normalized = command.replaceAll("\\", "/");
  return /\/[^/]+ Helper(?: \([^)]+\))?\.app\/Contents\/MacOS\/[^/]+$/.test(normalized);
}

export function macosAppContentsDir(execPath: string): string | null {
  const macosDir = path.dirname(execPath);
  if (path.basename(macosDir) !== "MacOS") return null;
  const contentsDir = path.dirname(macosDir);
  if (path.basename(contentsDir) !== "Contents") return null;
  return contentsDir;
}

/**
 * Prefer the LSUIElement Helper binary so background Node children stay out of
 * the macOS Dock. No-op on other platforms or when Helper.app is missing.
 */
export function resolveElectronNodeBin(command: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== "darwin") return command;
  const contentsDir = macosAppContentsDir(command);
  if (!contentsDir && command !== process.execPath) return command;
  const searchRoots = contentsDir
    ? [contentsDir]
    : (() => {
        const self = macosAppContentsDir(process.execPath);
        return self ? [self] : [];
      })();
  const product = path.basename(contentsDir ? command : process.execPath);
  const helperNames = [`${product} Helper`, "Electron Helper"];
  for (const root of searchRoots) {
    for (const name of helperNames) {
      const helper = path.join(root, "Frameworks", `${name}.app`, "Contents", "MacOS", name);
      if (existsSync(helper)) return helper;
    }
  }
  return command;
}

/** Merge env layers, then force ELECTRON_RUN_AS_NODE last so it cannot be dropped. */
export function envWithElectronAsNode(
  command: string,
  ...layers: Array<NodeJS.ProcessEnv | undefined>
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const layer of layers) {
    if (!layer) continue;
    Object.assign(env, layer);
  }
  Object.assign(env, asNodeEnv(command));
  return env;
}

/** Prefer package.json next to a bundled CLI so startup does not spawn Electron. */
export function readPiPackageVersion(entryFile: string): string | null {
  const resolved = path.resolve(entryFile);
  const candidates = [
    path.join(path.dirname(resolved), "package.json"),
    path.join(path.dirname(resolved), "..", "package.json"),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      const pkg = JSON.parse(readFileSync(file, "utf8")) as { version?: unknown };
      if (typeof pkg.version === "string" && pkg.version.trim()) {
        return pkg.version.trim();
      }
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/**
 * Desktop builds set QINGZHOU_PI_ENTRY (or legacy MOWEN_PI_ENTRY) to Pi's CLI file and run it with Electron's
 * Node (`ELECTRON_RUN_AS_NODE=1`). Browser/dev installs keep using `pi` on PATH.
 * A `PI_BIN` that points at a .js/.mjs/.cjs file is launched with the current
 * Node executable so Windows can run it (shebang spawn is Unix-only).
 */
export function resolvePiRuntime(env: NodeJS.ProcessEnv = process.env): PiRuntime {
  const entry = qingzhouEnv(env, "PI_ENTRY")?.trim();
  if (entry) {
    const command = resolveElectronNodeBin(qingzhouEnv(env, "NODE_BIN")?.trim() || process.execPath);
    return { command, prefixArgs: [path.resolve(entry)], extraEnv: asNodeEnv(command) };
  }
  const bin = resolvePiBin(env.PI_BIN ?? "pi");
  if (isJavaScriptFile(bin)) {
    const command = resolveElectronNodeBin(process.execPath);
    return { command, prefixArgs: [bin], extraEnv: asNodeEnv(command) };
  }
  return {
    command: bin,
    prefixArgs: [],
    extraEnv: {},
  };
}

export function expandHome(input: string, homeDir = os.homedir()): string {
  if (input === "~") return homeDir;
  if (input.startsWith("~/")) return path.join(homeDir, input.slice(2));
  return input;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: { workspaceRoot?: string | null; homeDir?: string; trustProject?: boolean } = {},
): AppConfig {
  const homeDir = path.resolve(expandHome(options.homeDir ?? qingzhouEnv(env, "HOME_DIR") ?? os.homedir()));
  const host = env.HOST ?? "127.0.0.1";
  const port = Number(env.PORT ?? "4310");
  const nodeEnv = env.NODE_ENV ?? "development";
  const origins = new Set([
    `http://${host}:${port}`,
    "http://127.0.0.1:4310",
    "http://localhost:4310",
  ]);
  if (nodeEnv !== "production") {
    origins.add("http://127.0.0.1:5173");
    origins.add("http://localhost:5173");
  }

  const allowedRootsValue = qingzhouEnv(env, "ALLOWED_ROOTS");
  const envRoots = parseAllowedRoots(
    allowedRootsValue,
    options.workspaceRoot
      ? [expandHome(options.workspaceRoot, homeDir)]
      : defaultAllowedRoots(homeDir),
  ).map((root) => path.resolve(expandHome(root, homeDir)));

  // Prefer an explicit workspace from settings when env did not override roots.
  if (!allowedRootsValue?.trim() && options.workspaceRoot) {
    const workspace = path.resolve(expandHome(options.workspaceRoot, homeDir));
    if (!envRoots.includes(workspace)) {
      envRoots.unshift(workspace);
    }
  }

  // Keep $HOME selectable after a workspace is set so 随便聊聊 and the
  // folder picker (which already browse home) do not fail cwd checks.
  // Explicit ALLOWED_ROOTS stays a hard jail for tests / locked deploys.
  if (!allowedRootsValue?.trim() && !envRoots.includes(homeDir)) {
    envRoots.push(homeDir);
  }

  const pi = resolvePiRuntime(env);

  return {
    host,
    port,
    piBin: entryDisplay(env, pi),
    piCommand: pi.command,
    piPrefixArgs: pi.prefixArgs,
    piExtraEnv: pi.extraEnv,
    dataDir: path.resolve(expandHome(qingzhouEnv(env, "DATA_DIR") ?? defaultDataDir(homeDir), homeDir)),
    allowedRoots: envRoots,
    maxProcesses: Number(qingzhouEnv(env, "MAX_PROCESSES") ?? "5"),
    mutations: mutationsSchema.parse(qingzhouEnv(env, "MUTATIONS") ?? "approval"),
    nodeEnv,
    approvalTimeoutMs: Number(qingzhouEnv(env, "APPROVAL_TIMEOUT_MS") ?? String(5 * 60 * 1000)),
    allowedOrigins: [...origins],
    webDistDir: qingzhouEnv(env, "WEB_DIST") ?? fileURLToPath(new URL("../../web/dist", import.meta.url)),
    approvalExtensionPath:
      qingzhouEnv(env, "APPROVAL_EXTENSION") ??
      fileURLToPath(new URL("../extensions/approval.ts", import.meta.url)),
    homeDir,
    piBundled: qingzhouEnv(env, "PI_BUNDLED") === "1" || Boolean(qingzhouEnv(env, "PI_ENTRY")?.trim()),
    piAgentDir: defaultPiAgentDir(homeDir),
    trustProject: options.trustProject === true,
  };
}

function entryDisplay(env: NodeJS.ProcessEnv, pi: PiRuntime): string {
  return qingzhouEnv(env, "PI_ENTRY")?.trim() || pi.command;
}

export async function readPiVersion(
  runtime: Pick<AppConfig, "piCommand" | "piPrefixArgs" | "piExtraEnv"> | string,
): Promise<{ version: string | null; error: string | null }> {
  const command = typeof runtime === "string" ? runtime : runtime.piCommand;
  const prefixArgs = typeof runtime === "string" ? [] : runtime.piPrefixArgs;
  const extraEnv = typeof runtime === "string" ? {} : runtime.piExtraEnv;
  const entry = prefixArgs[0];
  if (entry && isJavaScriptFile(entry)) {
    const bundled = readPiPackageVersion(entry);
    if (bundled) return { version: bundled, error: null };
  }
  try {
    const { stdout } = await execFileAsync(command, [...prefixArgs, "--version"], {
      timeout: 8000,
      windowsHide: true,
      env: envWithElectronAsNode(command, process.env, extraEnv),
    });
    const version = stdout.trim().split("\n")[0] ?? "";
    return { version: version || null, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ENOENT/i.test(message)) {
      return { version: null, error: "还没有安装 Pi，或找不到可执行文件。" };
    }
    return { version: null, error: `无法读取 Pi 版本：${message}` };
  }
}

export function parseHostHeader(host: string | undefined): { hostname: string; port: string | null } | null {
  if (!host?.trim()) return null;
  const value = host.trim();
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    if (end < 0) return null;
    const hostname = value.slice(1, end);
    const rest = value.slice(end + 1);
    return { hostname, port: rest.startsWith(":") ? rest.slice(1) : null };
  }
  const colon = value.lastIndexOf(":");
  if (colon >= 0 && /^\d+$/.test(value.slice(colon + 1))) {
    return { hostname: value.slice(0, colon), port: value.slice(colon + 1) };
  }
  return { hostname: value, port: null };
}

export function isLoopbackHostname(hostname: string): boolean {
  const value = hostname.trim().toLowerCase();
  return value === "127.0.0.1" || value === "localhost" || value === "::1";
}

/** Reject DNS-rebinding Host headers. Loopback binds only accept loopback hosts. */
export function isAllowedHost(hostHeader: string | undefined, bindHost = "127.0.0.1"): boolean {
  const parsed = parseHostHeader(hostHeader);
  if (!parsed?.hostname) return false;
  const hostname = parsed.hostname.toLowerCase();
  if (isLoopbackHostname(hostname)) return true;
  const bind = bindHost.trim().toLowerCase();
  if (!bind || bind === "0.0.0.0" || bind === "::" || bind === "[::]") return false;
  return hostname === bind;
}

export function isAllowedOrigin(origin: string | undefined, allowedOrigins: string[], bindHost = "127.0.0.1"): boolean {
  if (!origin) return false;
  if (allowedOrigins.includes(origin)) return true;
  if (bindHost !== "127.0.0.1" && bindHost !== "localhost") return false;
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && isLoopbackHostname(url.hostname);
  } catch {
    return false;
  }
}
