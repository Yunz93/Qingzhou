import { spawn } from "node:child_process";
import { accessSync, constants, existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { qingzhouEnv } from "../config.js";
import { redactSecrets } from "../security/redact.js";

const execFileAsync = promisify(execFile);

export const DEFAULT_PI_INSTALL_SCRIPT_URL = "https://pi.dev/install.sh";
export const PI_NPM_PACKAGE = "@earendil-works/pi-coding-agent";
export const DEFAULT_PI_NPM_LATEST_URL = `https://registry.npmjs.org/${PI_NPM_PACKAGE}/latest`;
export const PI_INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const LOG_TAIL = 8_000;

export class InstallPiError extends Error {
  constructor(
    message: string,
    readonly statusCode = 500,
    readonly log = "",
  ) {
    super(message);
    this.name = "InstallPiError";
  }
}

class InstallerTerminationError extends InstallPiError {}

export function piInstallScriptUrl(env: NodeJS.ProcessEnv = process.env): string {
  return qingzhouEnv(env, "PI_INSTALL_SCRIPT_URL")?.trim() || DEFAULT_PI_INSTALL_SCRIPT_URL;
}

export function piNpmLatestUrl(env: NodeJS.ProcessEnv = process.env): string {
  return qingzhouEnv(env, "PI_NPM_LATEST_URL")?.trim() || DEFAULT_PI_NPM_LATEST_URL;
}

export function parsePiVersion(raw: string | null | undefined): [number, number, number] | null {
  if (!raw) return null;
  const match = raw.trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isPiUpdateAvailable(
  latest: string | null | undefined,
  current: string | null | undefined,
): boolean {
  const next = parsePiVersion(latest);
  const have = parsePiVersion(current);
  if (!next) return false;
  if (!have) return true;
  for (let i = 0; i < 3; i += 1) {
    if (next[i]! > have[i]!) return true;
    if (next[i]! < have[i]!) return false;
  }
  return false;
}

export async function fetchLatestPiVersion(
  options: {
    env?: NodeJS.ProcessEnv;
    fetchText?: (url: string) => Promise<string>;
  } = {},
): Promise<{ version: string | null; error: string | null }> {
  const env = options.env ?? process.env;
  const url = piNpmLatestUrl(env);
  try {
    assertInstallScriptUrl(url);
  } catch {
    return { version: null, error: "检查更新的地址无效。" };
  }
  try {
    const fetchText = options.fetchText ?? fetchLatestDocument;
    const raw = await fetchText(url);
    const parsed = JSON.parse(raw) as { version?: unknown };
    const version = typeof parsed.version === "string" ? parsed.version.trim() : "";
    if (!version) return { version: null, error: "无法解析 Pi 最新版本。" };
    return { version, error: null };
  } catch (error) {
    if (error instanceof SyntaxError) return { version: null, error: "无法解析 Pi 最新版本。" };
    return { version: null, error: "无法检查 Pi 更新。请检查网络后重试。" };
  }
}

async function fetchLatestDocument(url: string): Promise<string> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8_000);
  try {
    const response = await fetch(url, {
      signal: ac.signal,
      redirect: "follow",
      headers: { "user-agent": "qingzhou-pi-update-check", accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

export function windowsNpmInstallArgs(): string[] {
  return [
    "install",
    "-g",
    "--ignore-scripts",
    "--min-release-age=0",
    "--no-fund",
    "--no-audit",
    "--progress=false",
    PI_NPM_PACKAGE,
  ];
}

export function unixInstallChildEnv(
  base: NodeJS.ProcessEnv,
  homeDir: string,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...base,
    HOME: homeDir,
    TERM: "dumb",
    CI: "1",
    npm_config_progress: "false",
  };
  if (platform !== "win32") {
    for (const dir of ["/usr/bin", "/bin", "/usr/sbin", "/sbin"]) {
      const parts = (env.PATH ?? "").split(":").filter(Boolean);
      if (!parts.includes(dir)) env.PATH = [...parts, dir].join(":");
    }
  }
  return env;
}

export function pathEnvKey(env: NodeJS.ProcessEnv, platform = process.platform): string {
  if (platform !== "win32") return "PATH";
  return Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
}

export function prependPath(dir: string, env: NodeJS.ProcessEnv, platform = process.platform): void {
  const key = pathEnvKey(env, platform);
  const sep = platform === "win32" ? ";" : ":";
  const parts = (env[key] ?? "").split(sep).filter(Boolean);
  env[key] = [dir, ...parts.filter((item) => item !== dir)].join(sep);
}

export function applyPiBinToEnv(bin: string, env: NodeJS.ProcessEnv, platform = process.platform): void {
  env.PI_BIN = bin;
  prependPath(path.dirname(bin), env, platform);
}

export function candidatePiPaths(
  homeDir: string,
  npmPrefix: string | null,
  platform = process.platform,
): string[] {
  const names = platform === "win32" ? ["pi.cmd", "pi.exe", "pi"] : ["pi"];
  const dirs = [
    path.join(homeDir, ".pi", "agent", "bin"),
    npmPrefix ? (platform === "win32" ? npmPrefix : path.join(npmPrefix, "bin")) : null,
    path.join(homeDir, ".local", "bin"),
    path.join(homeDir, "bin"),
  ].filter((dir): dir is string => Boolean(dir));
  return dirs.flatMap((dir) => names.map((name) => path.join(dir, name)));
}

export function isRunnableFile(file: string, platform = process.platform): boolean {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return platform === "win32" && existsSync(file);
  }
}

export function stripInstallerLog(input: string): string {
  const esc = String.fromCharCode(27);
  const bel = String.fromCharCode(7);
  const withoutAnsi = input
    .replace(new RegExp(`${esc}\\[[0-9;?]*[ -/]*[@-~]`, "g"), "")
    .replace(new RegExp(`${esc}\\][^${bel}]*${bel}`, "g"), "")
    .replace(/\r/g, "");
  const redacted = redactSecrets(withoutAnsi);
  if (redacted.length <= LOG_TAIL) return redacted.trim();
  return redacted.slice(-LOG_TAIL).trim();
}

export async function readNpmGlobalPrefix(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(process.platform === "win32" ? "npm.cmd" : "npm", ["prefix", "-g"], {
      timeout: 8000,
      env,
      shell: process.platform === "win32",
    });
    const prefix = stdout.trim();
    return prefix || null;
  } catch {
    return null;
  }
}

export async function discoverPiExecutable(options: {
  homeDir: string;
  env?: NodeJS.ProcessEnv;
  npmPrefix?: string | null;
  exists?: (file: string) => boolean;
  platform?: NodeJS.Platform;
}): Promise<string | null> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const exists = options.exists ?? ((file) => isRunnableFile(file, platform));
  const npmPrefix = options.npmPrefix === undefined ? await readNpmGlobalPrefix(env) : options.npmPrefix;
  for (const candidate of candidatePiPaths(options.homeDir, npmPrefix, platform)) {
    if (exists(candidate)) return candidate;
  }
  const fromEnv = env.PI_BIN?.trim();
  if (fromEnv && fromEnv !== "pi" && path.isAbsolute(fromEnv) && exists(fromEnv)) {
    return fromEnv;
  }
  const which = await whichPi(env, platform);
  if (which && exists(which)) return which;
  return null;
}

async function whichPi(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): Promise<string | null> {
  try {
    if (platform === "win32") {
      const { stdout } = await execFileAsync("where", ["pi"], { timeout: 5000, env });
      const first = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
      return first ?? null;
    }
    const { stdout } = await execFileAsync("sh", ["-c", "command -v pi"], { timeout: 5000, env });
    const found = stdout.trim();
    return found || null;
  } catch {
    return null;
  }
}

type RunResult = { code: number | null; stdout: string; stderr: string };

export type InstallPiResult = {
  ok: boolean;
  log: string;
  bin: string | null;
};

let inflight: Promise<InstallPiResult> | null = null;

export function resetInstallPiLock(): void {
  inflight = null;
}

export async function runOfficialPiInstall(options: {
  homeDir: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  timeoutMs?: number;
  download?: (url: string) => Promise<string>;
  runCommand?: (command: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number) => Promise<RunResult>;
}): Promise<InstallPiResult> {
  if (inflight) return inflight;
  let keepLock = false;
  inflight = runOfficialPiInstallUnserialized(options)
    .catch((error) => {
      keepLock = error instanceof InstallerTerminationError;
      throw error;
    })
    .finally(() => {
      if (!keepLock) inflight = null;
    });
  return inflight;
}

async function runOfficialPiInstallUnserialized(options: {
  homeDir: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  timeoutMs?: number;
  download?: (url: string) => Promise<string>;
  runCommand?: (command: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number) => Promise<RunResult>;
}): Promise<InstallPiResult> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const timeoutMs = options.timeoutMs ?? PI_INSTALL_TIMEOUT_MS;
  const runCommand = options.runCommand ?? spawnLogged;
  const download = options.download ?? downloadText;

  let result: RunResult;
  if (platform === "win32") {
    result = await runCommand(
      "npm.cmd",
      windowsNpmInstallArgs(),
      unixInstallChildEnv(env, options.homeDir, platform),
      timeoutMs,
    );
  } else {
    const url = piInstallScriptUrl(env);
    assertInstallScriptUrl(url);
    const script = await download(url);
    if (!script.trim()) {
      throw new InstallPiError("下载的 Pi 安装脚本是空的。");
    }
    const dir = mkdtempSync(path.join(tmpdir(), "qingzhou-pi-install-"));
    const scriptPath = path.join(dir, "install.sh");
    try {
      writeFileSync(scriptPath, script, { mode: 0o700 });
      result = await runCommand("/bin/sh", [scriptPath], unixInstallChildEnv(env, options.homeDir, platform), timeoutMs);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const log = stripInstallerLog(`${result.stdout}\n${result.stderr}`);
  if (result.code !== 0) {
    throw new InstallPiError(installFailureMessage(log), 500, log);
  }

  const bin = await discoverPiExecutable({
    homeDir: options.homeDir,
    env: unixInstallChildEnv(env, options.homeDir, platform),
    platform,
  });
  return { ok: true, log, bin };
}

function installFailureMessage(log: string): string {
  if (/Node\.js 22\.19/i.test(log) || /Node.js 22.19/.test(log)) {
    return "Pi 需要 Node.js 22.19 或更高版本，以及 npm。请先升级 Node，再点「安装 Pi」。";
  }
  if (/npm is required/i.test(log) || /error: npm/i.test(log)) {
    return "安装 Pi 需要 npm。请先安装 Node.js 和 npm，再点「安装 Pi」。";
  }
  if (/No terminal detected; install Node/i.test(log)) {
    return "这台电脑还没有可用的 Node.js / npm，无法自动安装 Pi。";
  }
  return log ? `Pi 安装失败。\n${log.slice(-1200)}` : "Pi 安装失败。";
}

export function assertInstallScriptUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new InstallPiError("安装脚本地址无效。");
  }
  const local = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (parsed.protocol === "https:") return;
  if (parsed.protocol === "http:" && local) return;
  throw new InstallPiError("安装脚本必须使用 HTTPS。");
}

async function downloadText(url: string): Promise<string> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: ac.signal,
      redirect: "follow",
      headers: { "user-agent": "qingzhou-pi-installer" },
    });
    if (!response.ok) {
      throw new InstallPiError(`无法下载 Pi 官方安装脚本（HTTP ${response.status}）。`);
    }
    return await response.text();
  } catch (error) {
    if (error instanceof InstallPiError) throw error;
    throw new InstallPiError("无法下载 Pi 官方安装脚本。请检查网络后重试。");
  } finally {
    clearTimeout(timer);
  }
}

function spawnLogged(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      // npm.cmd and its arguments are fixed above; batch files require cmd.exe.
      shell: process.platform === "win32" && command === "npm.cmd",
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      const finish = () => reject(new InstallPiError("安装 Pi 超时。请检查网络后重试。"));
      if (process.platform === "win32" && child.pid) {
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          stdio: "ignore", windowsHide: true,
        });
        const failed = (detail: string) => reject(new InstallerTerminationError(
          `安装 Pi 超时，无法终止安装进程 ${child.pid}：${detail}。请先在任务管理器结束安装进程，再重启轻舟。`,
        ));
        killer.once("close", (code) => {
          if (code === 0) finish();
          else failed(`taskkill exit ${code}`);
        });
        killer.once("error", (error) => {
          failed(error.message);
        });
      } else {
        child.kill("SIGTERM");
        finish();
      }
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(new InstallPiError(`无法启动安装程序：${error.message}`));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return;
      resolve({ code, stdout, stderr });
    });
  });
}
