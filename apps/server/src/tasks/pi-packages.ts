import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { normalizePackageSource, packageSourceInstalled, packageSourcesEqual } from "@qingzhou/protocol";
import { envWithElectronAsNode, qingzhouEnv } from "../config.js";
import { isInsideRoot } from "../security/path-policy.js";
import { extractErrorText, humanizeUserFacingError, piNpmEnv } from "../setup/pi-agent-dir.js";

const execFileAsync = promisify(execFile);
const PI_PACKAGE_INSTALL_TIMEOUT_MS = 5 * 60 * 1000;

export function shouldRunPiCliInstall(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.VITEST === "true") return false;
  if (qingzhouEnv(env, "E2E") === "1") return false;
  if (qingzhouEnv(env, "SKIP_PI_PACKAGE_INSTALL") === "1") return false;
  return true;
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${path.basename(filePath)} 不是对象`);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

function packageSourceList(settings: Record<string, unknown>): string[] {
  const packages = settings.packages;
  if (!Array.isArray(packages)) return [];
  const out: string[] = [];
  for (const item of packages) {
    if (typeof item === "string" && item.trim()) {
      out.push(item.trim());
      continue;
    }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const source = (item as { source?: unknown }).source;
      if (typeof source === "string" && source.trim()) out.push(source.trim());
    }
  }
  return out;
}

async function writeJson(filePath: string, value: Record<string, unknown>): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function assertAgentFile(filePath: string, agentDir: string): void {
  if (!isInsideRoot(path.resolve(filePath), path.resolve(agentDir))) {
    throw new Error("插件设置文件路径不合法");
  }
}

export async function addPackageSources(
  agentDir: string,
  sources: string[],
): Promise<{ added: string[]; already: string[] }> {
  const settingsPath = path.join(agentDir, "settings.json");
  assertAgentFile(settingsPath, agentDir);
  const settings = await readJsonObject(settingsPath);
  const current = packageSourceList(settings);
  const added: string[] = [];
  const already: string[] = [];
  const next = [...current];
  for (const raw of sources) {
    const source = normalizePackageSource(raw);
    if (!source) continue;
    if (next.some((item) => packageSourcesEqual(item, source))) {
      already.push(source);
      continue;
    }
    next.push(source);
    added.push(source);
  }
  if (added.length > 0) {
    settings.packages = next;
    await writeJson(settingsPath, settings);
  }
  return { added, already };
}

export async function removePackageSources(agentDir: string, sources: string[]): Promise<string[]> {
  const settingsPath = path.join(agentDir, "settings.json");
  assertAgentFile(settingsPath, agentDir);
  const settings = await readJsonObject(settingsPath);
  const packages = settings.packages;
  if (!Array.isArray(packages) || sources.length === 0) return [];
  const wanted = sources.map((item) => normalizePackageSource(item)).filter(Boolean);
  const removed: string[] = [];
  const next = packages.filter((item) => {
    let source = "";
    if (typeof item === "string") source = item.trim();
    else if (item && typeof item === "object" && !Array.isArray(item)) {
      const raw = (item as { source?: unknown }).source;
      if (typeof raw === "string") source = raw.trim();
    }
    if (!source) return true;
    if (!wanted.some((candidate) => packageSourcesEqual(candidate, source))) return true;
    removed.push(normalizePackageSource(source));
    return false;
  });
  if (removed.length > 0) {
    settings.packages = next;
    await writeJson(settingsPath, settings);
  }
  return removed;
}

export async function removeMcpServer(agentDir: string, name: string): Promise<boolean> {
  const mcpPath = path.join(agentDir, "mcp.json");
  assertAgentFile(mcpPath, agentDir);
  const settings = await readJsonObject(mcpPath);
  const existing = settings.mcpServers;
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) return false;
  const servers = { ...(existing as Record<string, unknown>) };
  if (!(name in servers)) return false;
  delete servers[name];
  settings.mcpServers = servers;
  await writeJson(mcpPath, settings);
  return true;
}

export async function ensureMcpServer(
  agentDir: string,
  mcp: { name: string; command: string; args?: string[] },
): Promise<boolean> {
  const mcpPath = path.join(agentDir, "mcp.json");
  assertAgentFile(mcpPath, agentDir);
  const settings = await readJsonObject(mcpPath);
  const existing = settings.mcpServers;
  const servers =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  if (servers[mcp.name]) return false;
  servers[mcp.name] = mcp.args?.length ? { command: mcp.command, args: [...mcp.args] } : { command: mcp.command };
  settings.mcpServers = servers;
  await writeJson(mcpPath, settings);
  return true;
}

export function piCliInstallArgs(prefixArgs: string[], source: string): string[] {
  return [...prefixArgs, "install", source];
}

export async function runPiCliInstall(input: {
  piCommand: string;
  prefixArgs: string[];
  extraEnv?: NodeJS.ProcessEnv;
  sources: string[];
  env?: NodeJS.ProcessEnv;
  agentDir?: string;
}): Promise<string> {
  if (input.sources.length === 0) return "";
  const npmEnv = input.agentDir ? piNpmEnv(input.agentDir) : {};
  const logs: string[] = [];
  for (const source of input.sources) {
    const { stdout, stderr } = await execFileAsync(input.piCommand, piCliInstallArgs(input.prefixArgs, source), {
      timeout: PI_PACKAGE_INSTALL_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
      env: envWithElectronAsNode(input.piCommand, process.env, input.env, input.extraEnv, npmEnv),
    });
    const text = `${stdout}\n${stderr}`.trim();
    if (text) logs.push(text);
  }
  return logs.join("\n");
}

export function formatPiInstallError(error: unknown): string {
  const extra =
    error && typeof error === "object" && "stderr" in error && typeof (error as { stderr?: unknown }).stderr === "string"
      ? (error as { stderr: string }).stderr
      : "";
  const combined = [error instanceof Error ? error.message : extractErrorText(error), extra]
    .filter(Boolean)
    .join("\n");
  return `插件下载失败。${humanizeUserFacingError(new Error(combined || String(error)))}`;
}

export async function installPiPackages(input: {
  agentDir: string;
  sources: string[];
  packages: Array<{ source: string }>;
  extensions?: Array<{ name: string }>;
  piCommand: string;
  prefixArgs: string[];
  extraEnv?: NodeJS.ProcessEnv;
  env?: NodeJS.ProcessEnv;
  runCli?: boolean;
}): Promise<{
  installed: string[];
  already: string[];
  addedSources: string[];
  piInstallError: string | null;
}> {
  const unique: string[] = [];
  for (const raw of input.sources) {
    const source = normalizePackageSource(raw);
    if (!source) continue;
    if (unique.some((item) => packageSourcesEqual(item, source))) continue;
    unique.push(source);
  }
  if (unique.length === 0) throw new Error("需要指定要安装的插件");

  const already: string[] = [];
  const toInstall: string[] = [];
  for (const source of unique) {
    if (packageSourceInstalled(source, input.packages, input.extensions ?? [])) {
      already.push(source);
    } else {
      toInstall.push(source);
    }
  }

  const addedSources: string[] = [];
  if (toInstall.length > 0) {
    const result = await addPackageSources(input.agentDir, toInstall);
    addedSources.push(...result.added);
  }

  let piInstallError: string | null = null;
  const runCli = input.runCli ?? shouldRunPiCliInstall(input.env ?? process.env);
  if (runCli && toInstall.length > 0) {
    try {
      await runPiCliInstall({
        piCommand: input.piCommand,
        prefixArgs: input.prefixArgs,
        extraEnv: input.extraEnv,
        sources: toInstall,
        env: input.env,
        agentDir: input.agentDir,
      });
    } catch (error) {
      if (addedSources.length > 0) await removePackageSources(input.agentDir, addedSources);
      piInstallError = formatPiInstallError(error);
    }
  }

  return {
    installed: toInstall,
    already,
    addedSources,
    piInstallError,
  };
}
