import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, readFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { proxiedFetch } from "./http-proxy.js";

const execFileAsync = promisify(execFile);

export const DEFAULT_QINGZHOU_REPO = "Yunz93/Qingzhou";
export const APP_BUNDLE_NAME = "Qingzhou.app";
const CHECK_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
const PROGRESS_EMIT_BYTES = 256 * 1024;

export type QingzhouRelease = {
  tagName: string;
  version: string;
  name: string;
  url: string;
  body: string;
  publishedAt: string | null;
  prerelease: boolean;
  assets: Array<{ name: string; url: string; size: number }>;
};

export type QingzhouUpdateAsset = {
  name: string;
  url: string;
  size: number;
  sha256: string;
};

export type UpdateDownloadEvent =
  | { event: "Started"; data?: { contentLength?: number | null } }
  | { event: "Progress"; data?: { chunkLength?: number } }
  | { event: "Finished" };

export type UpdateInstallResult = {
  ok: true;
  version: string;
  platform: string;
  relaunch: boolean;
};

export function qingzhouRepo(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.QINGZHOU_REPO?.trim() || env.MOWEN_REPO?.trim() || DEFAULT_QINGZHOU_REPO;
  if (!/^[\w.-]+\/[\w.-]+$/.test(value)) throw new Error("轻舟更新仓库配置无效。");
  return value;
}

export function parseReleaseTagFromGithubUrl(url: string): string | null {
  const match = url.trim().match(/\/releases\/tag\/(v?[A-Za-z0-9][A-Za-z0-9.-]*)/);
  if (!match?.[1]) return null;
  const tag = match[1].startsWith("v") ? match[1] : `v${match[1]}`;
  return normalizeVersion(tag) ? tag : null;
}

export function githubReleaseDownloadUrl(repo: string, tag: string, name: string): string {
  return `https://github.com/${repo}/releases/download/${tag}/${name}`;
}

export function syntheticGithubRelease(repo: string, tag: string): Record<string, unknown> {
  const names = [
    "Qingzhou-mac-arm64.zip",
    "Qingzhou-mac-x64.zip",
    "Qingzhou-win-x64-setup.exe",
    "Qingzhou-win-arm64-setup.exe",
    "SHA256SUMS.txt",
  ];
  return {
    tag_name: tag,
    name: tag,
    html_url: `https://github.com/${repo}/releases/tag/${tag}`,
    body: "",
    published_at: null,
    prerelease: false,
    assets: names.map((name) => ({
      name,
      browser_download_url: githubReleaseDownloadUrl(repo, tag, name),
      size: 0,
    })),
  };
}

export const LATEST_JSON_NAME = "latest.json";

const ASSET_PLATFORM_KEYS: Record<string, string[]> = {
  "Qingzhou-mac-arm64.zip": ["darwin-arm64", "darwin-aarch64"],
  "Qingzhou-mac-x64.zip": ["darwin-x64", "darwin-x86_64"],
  "Qingzhou-win-x64-setup.exe": ["win32-x64", "windows-x86_64"],
  "Qingzhou-win-arm64-setup.exe": ["win32-arm64", "windows-arm64"],
};

const PLATFORM_KEY_ALIASES: Record<string, string> = {
  "darwin-aarch64": "darwin-arm64",
  "darwin-x86_64": "darwin-x64",
  "windows-x86_64": "win32-x64",
  "windows-aarch64": "win32-arm64",
  "windows-arm64": "win32-arm64",
};

export type QingzhouLatestPlatform = {
  url: string;
  sha256: string;
};

export type QingzhouLatestJson = {
  version: string;
  notes: string;
  pub_date: string;
  platforms: Record<string, QingzhouLatestPlatform>;
};

export function latestJsonDownloadUrl(repo: string): string {
  return `https://github.com/${repo}/releases/latest/download/${LATEST_JSON_NAME}`;
}

export function canonicalizeUpdaterPlatformKey(key: string): string {
  return PLATFORM_KEY_ALIASES[key] ?? key;
}

export function changelogNotesForVersion(markdown: string, version: string): string {
  const normalized = version.replace(/^v/i, "");
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${normalized}`);
  if (start < 0) return "";
  const end = lines.findIndex((line, index) => index > start && /^## /.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
}

export function buildQingzhouLatestJson(input: {
  repo: string;
  tag: string;
  sums: Map<string, string>;
  notes?: string;
  pubDate?: string;
}): QingzhouLatestJson {
  const tag = normalizeReleaseTag(input.tag);
  const version = normalizeVersion(tag);
  if (!version) throw new Error("无法从版本标签生成 latest.json。");
  const platforms: QingzhouLatestJson["platforms"] = {};
  for (const [file, keys] of Object.entries(ASSET_PLATFORM_KEYS)) {
    const sha256 = input.sums.get(file);
    if (!sha256) continue;
    const entry = { url: githubReleaseDownloadUrl(input.repo, tag, file), sha256 };
    for (const key of keys) platforms[key] = entry;
  }
  if (Object.keys(platforms).length === 0) {
    throw new Error("SHA256SUMS.txt 没有可写入 latest.json 的平台安装包。");
  }
  return {
    version,
    notes: input.notes ?? "",
    pub_date: input.pubDate ?? new Date().toISOString(),
    platforms,
  };
}

export function parseQingzhouLatestJson(
  raw: unknown,
  repo = qingzhouRepo(),
): { release: QingzhouRelease; sums: Map<string, string> } {
  if (!raw || typeof raw !== "object") throw new Error("无法解析 latest.json。");
  const item = raw as Record<string, unknown>;
  const version = normalizeVersion(typeof item.version === "string" ? item.version : "");
  if (!version) throw new Error("latest.json 没有有效版本号。");
  const tagName = normalizeReleaseTag(version);
  const platforms = item.platforms;
  if (!platforms || typeof platforms !== "object" || Array.isArray(platforms)) {
    throw new Error("latest.json 缺少 platforms，已终止安装。");
  }
  const assets: QingzhouRelease["assets"] = [];
  const sums = new Map<string, string>();
  const seen = new Set<string>();
  for (const [key, value] of Object.entries(platforms as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    const url = typeof entry.url === "string" ? entry.url.trim() : "";
    if (!url) continue;
    let name = "";
    try {
      name = path.basename(new URL(url).pathname);
    } catch {
      name = "";
    }
    if (!name || !ASSET_PLATFORM_KEYS[name]) {
      try {
        name = requiredAssetNames(canonicalizeUpdaterPlatformKey(key))[0] ?? "";
      } catch {
        name = "";
      }
    }
    if (!name || seen.has(name)) continue;
    seen.add(name);
    assets.push({ name, url, size: typeof entry.size === "number" ? entry.size : 0 });
    const sha256 = typeof entry.sha256 === "string" ? entry.sha256.trim().toLowerCase() : "";
    if (/^[a-f0-9]{64}$/.test(sha256)) sums.set(name, sha256);
  }
  if (assets.length === 0) throw new Error("latest.json 缺少平台安装包，已终止安装。");
  return {
    release: {
      tagName,
      version,
      name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : tagName,
      url: typeof item.url === "string" ? item.url : `https://github.com/${repo}/releases/tag/${tagName}`,
      body: typeof item.notes === "string" ? item.notes : "",
      publishedAt: typeof item.pub_date === "string" ? item.pub_date : null,
      prerelease: false,
      assets,
    },
    sums,
  };
}

const GITHUB_ACCESS_LIMITED =
  /HTTP 401|HTTP 403|HTTP 429|rate limit|限制了检查次数|限流|拒绝访问/i;

export function isGithubAccessLimited(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return GITHUB_ACCESS_LIMITED.test(message);
}

/** latest.json 404/限流时改读公开发布页，绝不调用 GitHub API。 */
export function shouldFallbackGithubRelease(error: unknown): boolean {
  if (isGithubAccessLimited(error)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /HTTP 404/.test(message);
}

export function humanizeGithubHttpStatus(status: number, body = ""): string {
  if (status === 429 || (status === 403 && /rate limit/i.test(body))) {
    return "GitHub 限制了检查次数，请稍后再试。";
  }
  if (status === 403) {
    return "GitHub 拒绝访问（HTTP 403）。打不开 GitHub 时请设置 HTTPS_PROXY 后重试。";
  }
  return `GitHub 返回 HTTP ${status}`;
}

export function isQingzhouDesktop(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.QINGZHOU_DESKTOP === "1" || env.MOWEN_DESKTOP === "1";
}

export function canUpdateOnPlatform(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "darwin" || platform === "win32";
}

export function parseQingzhouRelease(raw: unknown): QingzhouRelease {
  if (!raw || typeof raw !== "object") throw new Error("无法解析轻舟 Release。");
  const item = raw as Record<string, unknown>;
  const tagName = typeof item.tag_name === "string" ? item.tag_name.trim() : "";
  const version = normalizeVersion(tagName);
  if (!tagName || !version) throw new Error("轻舟 Release 没有有效版本号。");
  const assets = Array.isArray(item.assets)
    ? item.assets.flatMap((asset) => {
        if (!asset || typeof asset !== "object") return [];
        const entry = asset as Record<string, unknown>;
        return typeof entry.name === "string" && typeof entry.browser_download_url === "string"
          ? [{ name: entry.name, url: entry.browser_download_url, size: typeof entry.size === "number" ? entry.size : 0 }]
          : [];
      })
    : [];
  return {
    tagName,
    version,
    name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : tagName,
    url: typeof item.html_url === "string" ? item.html_url : `https://github.com/${qingzhouRepo()}/releases/tag/${tagName}`,
    body: typeof item.body === "string" ? item.body : "",
    publishedAt: typeof item.published_at === "string" ? item.published_at : null,
    prerelease: item.prerelease === true,
    assets,
  };
}

export function normalizeVersion(value: string | null | undefined): string | null {
  const match = value?.trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}` : null;
}

export function normalizeReleaseTag(tag: string): string {
  const trimmed = tag.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

export function isValidReleaseTag(tag: string): boolean {
  if (!tag.startsWith("v") || tag.length > 32) return false;
  const payload = tag.slice(1);
  return payload.length > 0 && /^[A-Za-z0-9.-]+$/.test(payload);
}

export function currentQingzhouVersion(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.QINGZHOU_VERSION?.trim() || env.MOWEN_VERSION?.trim() || env.OHMYPI_VERSION?.trim();
  if (fromEnv) return fromEnv.replace(/^v/i, "");
  try {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8")) as {
      version?: string;
    };
    if (pkg.version?.trim()) return pkg.version.trim();
  } catch {
    // packaged or test environments may not ship the nearby package.json
  }
  return "0.0.0";
}

export function parseSha256Sums(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^([a-fA-F0-9]{64})\s+\*?(\S+)$/);
    if (match) sums.set(path.basename(match[2]!), match[1]!.toLowerCase());
  }
  return sums;
}

export function sha256Hex(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex");
}

export function assertChecksum(name: string, content: string | Buffer, sums: Map<string, string>): void {
  const expected = sums.get(path.basename(name));
  if (!expected) throw new Error(`更新清单里没有 ${name}。`);
  if (sha256Hex(content) !== expected) throw new Error(`${name} 校验和不匹配，已中止更新。`);
}

export async function assertFileChecksum(filePath: string, expected: string): Promise<void> {
  const actual = await sha256File(filePath);
  if (actual !== expected.toLowerCase()) {
    throw new Error(`${path.basename(filePath)} 校验和不匹配，已终止安装。`);
  }
}

export function isQingzhouUpdateAvailable(latest: string | null | undefined, current: string | null | undefined): boolean {
  const next = normalizeVersion(latest);
  const have = normalizeVersion(current);
  if (!next) return false;
  if (!have) return true;
  const a = next.split(".").map(Number);
  const b = have.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index]! > b[index]!) return true;
    if (a[index]! < b[index]!) return false;
  }
  return false;
}

export function updaterPlatformKey(platform: NodeJS.Platform, arch: string): string {
  if (platform === "darwin") {
    if (arch === "arm64" || arch === "aarch64") return "darwin-arm64";
    if (arch === "x64" || arch === "x86_64") return "darwin-x64";
    throw new Error(`不支持的 CPU 架构: ${arch}`);
  }
  if (platform === "win32") {
    if (arch === "arm64") return "win32-arm64";
    if (arch === "x64" || arch === "x86_64" || arch === "ia32") return "win32-x64";
    throw new Error(`不支持的 CPU 架构: ${arch}`);
  }
  throw new Error("当前平台暂不支持应用内更新。");
}

export function requiredAssetNames(platformKey: string): string[] {
  switch (platformKey) {
    case "darwin-arm64":
      return ["Qingzhou-mac-arm64.zip"];
    case "darwin-x64":
      return ["Qingzhou-mac-x64.zip"];
    case "win32-x64":
      return ["Qingzhou-win-x64-setup.exe"];
    case "win32-arm64":
      return ["Qingzhou-win-arm64-setup.exe"];
    default:
      throw new Error(`不支持的更新平台: ${platformKey}`);
  }
}

export function requireChecksummedAsset(
  release: QingzhouRelease,
  sums: Map<string, string>,
  platform: NodeJS.Platform,
  arch: string,
): QingzhouUpdateAsset {
  if (sums.size === 0) throw new Error("SHA256SUMS.txt 无效或为空，已终止安装。");
  const platformKey = updaterPlatformKey(platform, arch);
  const names = requiredAssetNames(platformKey);
  for (const name of names) {
    const asset = release.assets.find((item) => item.name === name);
    const sha256 = sums.get(name);
    if (asset && sha256) {
      return { name: asset.name, url: asset.url, size: asset.size, sha256 };
    }
  }
  const wanted = names.join(" / ");
  if (!names.some((name) => release.assets.some((asset) => asset.name === name))) {
    throw new Error(`Release 缺少平台安装包 ${wanted}，已终止安装。`);
  }
  throw new Error(`SHA256SUMS.txt 缺少 ${wanted}，已终止安装。`);
}

export function macosBundlePathFromExecPath(execPath: string): string | null {
  const match = execPath.match(/^(.*\.app)(?=\/Contents\/MacOS\/)/);
  return match?.[1] ?? null;
}

export function installedAppPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  const fromEnv = env.QINGZHOU_APP_PATH?.trim();
  if (fromEnv) return fromEnv;
  if (platform === "darwin") {
    const fromExec = macosBundlePathFromExecPath(env.QINGZHOU_EXEC_PATH?.trim() || "");
    if (fromExec) return fromExec;
    return path.join("/Applications", APP_BUNDLE_NAME);
  }
  if (platform === "win32") {
    const local = env.LOCALAPPDATA?.trim() || path.join(env.USERPROFILE?.trim() || "", "AppData", "Local");
    return path.join(local, "Programs", "Qingzhou", "Qingzhou.exe");
  }
  throw new Error("当前平台暂不支持应用内更新。");
}

export function relaunchWaiterCommand(pid: number, appPath: string): string {
  return `while kill -0 ${pid} 2>/dev/null; do sleep 0.2; done; open "${appPath}"`;
}

export function windowsInstallWaiterScript(pid: number, installer: string, appPath: string): string {
  const safeInstaller = assertSafeWindowsPath(installer);
  const safeApp = assertSafeWindowsPath(appPath);
  return [
    `while (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 200 }`,
    `Start-Process -FilePath '${safeInstaller}' -ArgumentList '/S' -Wait`,
    `if (Test-Path -LiteralPath '${safeApp}') { Start-Process -FilePath '${safeApp}' }`,
    `Remove-Item -LiteralPath '${safeInstaller}' -Force -ErrorAction SilentlyContinue`,
  ].join("; ");
}

function assertSafeWindowsPath(value: string): string {
  if (!value || /[\0\r\n']/.test(value)) throw new Error("更新路径无效。");
  return value;
}

async function movePath(source: string, dest: string): Promise<void> {
  try {
    await rename(source, dest);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
    if (code !== "EXDEV") throw error;
    await cp(source, dest, { recursive: true });
    await rm(source, { recursive: true, force: true });
  }
}

async function removePath(target: string): Promise<void> {
  if (!existsSync(target)) return;
  await rm(target, { recursive: true, force: true });
}

export async function replaceAppAtomically(target: string, incoming: string, backup: string): Promise<void> {
  if (!existsSync(incoming)) throw new Error(`安装新版本失败: 找不到 ${incoming}`);
  await removePath(backup);
  const targetExisted = existsSync(target);
  if (targetExisted) {
    try {
      await movePath(target, backup);
    } catch (error) {
      throw new Error(`备份现有应用失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  try {
    await mkdir(path.dirname(target), { recursive: true });
    await movePath(incoming, target);
  } catch (error) {
    if (targetExisted) {
      try {
        await movePath(backup, target);
      } catch (restoreError) {
        throw new Error(
          `安装新版本失败: ${error instanceof Error ? error.message : String(error)}；并且回滚失败: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`,
        );
      }
    }
    throw new Error(`安装新版本失败: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (targetExisted) {
    await removePath(backup);
  }
}

export async function extractAppBundle(archive: string, destDir: string): Promise<string> {
  if (!archive.endsWith(".zip")) {
    throw new Error("应用内更新只接受已校验的 zip 安装包，已终止安装。");
  }
  await mkdir(destDir, { recursive: true });
  try {
    await execFileAsync("unzip", ["-q", archive, "-d", destDir]);
  } catch (error) {
    throw new Error(`解压更新包失败: ${error instanceof Error ? error.message : String(error)}`);
  }
  const expected = path.join(destDir, APP_BUNDLE_NAME);
  if (existsSync(expected)) return expected;
  const { readdir } = await import("node:fs/promises");
  const stack = [destDir];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name === APP_BUNDLE_NAME) return full;
      if (entry.isDirectory()) stack.push(full);
    }
  }
  throw new Error(`更新包中未找到 ${APP_BUNDLE_NAME}`);
}

export function clearQuarantine(appPath: string): void {
  const result = spawnSync("xattr", ["-cr", appPath], { stdio: "ignore" });
  if (result.error || result.status !== 0) {
    throw new Error("清理隔离属性失败。");
  }
}

export async function downloadUpdateFile(
  url: string,
  dest: string,
  onEvent?: (event: UpdateDownloadEvent) => void,
  fetchImpl?: typeof fetch,
): Promise<void> {
  const doFetch = fetchImpl ?? githubFetch;
  const response = await doFetch(url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    headers: { "user-agent": "qingzhou-updater" },
  });
  if (!response.ok) throw new Error(`下载安装包失败（HTTP ${response.status}）。`);
  const headerLength = Number(response.headers.get("content-length"));
  const contentLength = Number.isFinite(headerLength) && headerLength > 0 ? headerLength : null;
  onEvent?.({ event: "Started", data: { contentLength } });
  if (!response.body) throw new Error("下载安装包失败：响应没有内容。");
  await mkdir(path.dirname(dest), { recursive: true });
  const file = createWriteStream(dest);
  try {
    const reader = response.body.getReader();
    let pending = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      await new Promise<void>((resolve, reject) => {
        file.write(value, (error) => (error ? reject(error) : resolve()));
      });
      pending += value.byteLength;
      if (pending >= PROGRESS_EMIT_BYTES) {
        onEvent?.({ event: "Progress", data: { chunkLength: pending } });
        pending = 0;
      }
    }
    if (pending > 0) onEvent?.({ event: "Progress", data: { chunkLength: pending } });
    await new Promise<void>((resolve, reject) => {
      file.end((error?: Error | null) => (error ? reject(error) : resolve()));
    });
    onEvent?.({ event: "Finished" });
  } catch (error) {
    file.destroy();
    await rm(dest, { force: true });
    throw error instanceof Error ? error : new Error("下载安装包失败。");
  }
}

export async function fetchLatestQingzhouRelease(options: {
  env?: NodeJS.ProcessEnv;
  fetchJson?: (url: string) => Promise<unknown>;
  fetchLatestLocation?: (url: string) => Promise<string>;
} = {}): Promise<{ release: QingzhouRelease | null; sums: Map<string, string> | null; error: string | null }> {
  const repo = qingzhouRepo(options.env);
  const fetchJson = options.fetchJson ?? fetchJsonDocument;
  try {
    const parsed = parseQingzhouLatestJson(await fetchJson(latestJsonDownloadUrl(repo)), repo);
    return { release: parsed.release, sums: parsed.sums, error: null };
  } catch (error) {
    if (!shouldFallbackGithubRelease(error)) {
      return { release: null, sums: null, error: error instanceof Error ? error.message : "无法检查轻舟更新。" };
    }
    try {
      const tag = await resolveLatestReleaseTag(repo, options.fetchLatestLocation);
      return { release: parseQingzhouRelease(syntheticGithubRelease(repo, tag)), sums: null, error: null };
    } catch {
      return { release: null, sums: null, error: error instanceof Error ? error.message : "无法检查轻舟更新。" };
    }
  }
}

export async function inspectQingzhouUpdate(options: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  arch?: string;
  fetchJson?: (url: string) => Promise<unknown>;
  fetchText?: (url: string) => Promise<string>;
} = {}): Promise<{
  release: QingzhouRelease | null;
  asset: QingzhouUpdateAsset | null;
  error: string | null;
}> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const result = await fetchLatestQingzhouRelease({ env, fetchJson: options.fetchJson });
  if (!result.release) return { release: null, asset: null, error: result.error };
  if (!canUpdateOnPlatform(platform)) {
    return { release: result.release, asset: null, error: null };
  }
  try {
    const arch = options.arch ?? process.arch;
    let sums = result.sums;
    if (!sums || sums.size === 0) {
      const fetchText = options.fetchText ?? fetchTextDocument;
      const repo = qingzhouRepo(env);
      const sumsText = await fetchText(
        `https://github.com/${repo}/releases/download/${result.release.tagName}/SHA256SUMS.txt`,
      );
      sums = parseSha256Sums(sumsText);
    }
    const asset = requireChecksummedAsset(result.release, sums, platform, arch);
    return { release: result.release, asset, error: null };
  } catch (error) {
    return {
      release: result.release,
      asset: null,
      error: error instanceof Error ? error.message : "无法校验轻舟更新包。",
    };
  }
}

export async function installQingzhouUpdate(options: {
  version: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  arch?: string;
  fetchJson?: (url: string) => Promise<unknown>;
  fetchText?: (url: string) => Promise<string>;
  fetchToFile?: (url: string, dest: string, onEvent?: (event: UpdateDownloadEvent) => void) => Promise<void>;
  extractApp?: (archive: string, destDir: string) => Promise<string>;
  replaceApp?: (target: string, incoming: string, backup: string) => Promise<void>;
  clearQuarantine?: (appPath: string) => void;
  spawnWaiter?: (kind: "macos" | "windows", targetPath: string) => void;
  onEvent?: (event: UpdateDownloadEvent) => void;
}): Promise<UpdateInstallResult> {
  const env = options.env ?? process.env;
  const version = normalizeVersion(options.version);
  if (!version) throw new Error("更新版本号无效。");
  const tag = normalizeReleaseTag(version);
  if (!isValidReleaseTag(tag)) throw new Error(`无效的版本标签: ${tag}`);
  const platform = options.platform ?? process.platform;
  if (!canUpdateOnPlatform(platform)) throw new Error("当前平台暂不支持应用内更新。");
  const arch = options.arch ?? process.arch;
  const inspected = await inspectQingzhouUpdate({
    env,
    platform,
    arch,
    fetchJson: options.fetchJson,
    fetchText: options.fetchText,
  });
  if (!inspected.release) throw new Error(inspected.error ?? "无法检查轻舟更新。");
  if (inspected.release.version !== version) throw new Error("可更新版本已变化，请重新检查。");
  if (!inspected.asset) throw new Error(inspected.error ?? "更新包缺少校验信息，已终止安装。");

  const tmpDir = await mkdtemp(path.join(tmpdir(), "qingzhou-update-"));
  const archivePath = path.join(tmpDir, inspected.asset.name);
  const extractDir = path.join(tmpDir, "extract");
  const backupPath = path.join(tmpDir, `${APP_BUNDLE_NAME}.bak`);
  const target = installedAppPath(env, platform);
  let keepTemp = false;

  try {
    const fetchToFile = options.fetchToFile ?? ((url, dest, onEvent) => downloadUpdateFile(url, dest, onEvent));
    await fetchToFile(inspected.asset.url, archivePath, options.onEvent);
    await assertFileChecksum(archivePath, inspected.asset.sha256);

    if (platform === "win32") {
      const spawnWaiter = options.spawnWaiter ?? spawnWindowsInstallWaiter;
      spawnWaiter("windows", archivePath);
      keepTemp = options.spawnWaiter == null;
      return { ok: true, version: tag, platform, relaunch: false };
    }

    const extractApp = options.extractApp ?? extractAppBundle;
    const incoming = await extractApp(archivePath, extractDir);
    const clear = options.clearQuarantine ?? clearQuarantine;
    clear(incoming);
    const replaceApp = options.replaceApp ?? replaceAppAtomically;
    await replaceApp(target, incoming, backupPath);
    const spawnWaiter = options.spawnWaiter ?? spawnMacosRelaunchWaiter;
    spawnWaiter("macos", target);
    return { ok: true, version: tag, platform, relaunch: false };
  } finally {
    if (!keepTemp) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }
}

/** @deprecated Use installQingzhouUpdate. Kept for call sites that still expect the old name. */
export async function startQingzhouUpdate(options: {
  version: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  arch?: string;
  fetchJson?: (url: string) => Promise<unknown>;
  fetchText?: (url: string) => Promise<string>;
  fetchToFile?: (url: string, dest: string, onEvent?: (event: UpdateDownloadEvent) => void) => Promise<void>;
  extractApp?: (archive: string, destDir: string) => Promise<string>;
  replaceApp?: (target: string, incoming: string, backup: string) => Promise<void>;
  spawnWaiter?: (kind: "macos" | "windows", targetPath: string) => void;
  onEvent?: (event: UpdateDownloadEvent) => void;
}): Promise<UpdateInstallResult> {
  return installQingzhouUpdate(options);
}

export function spawnMacosRelaunchWaiter(kind: "macos" | "windows", appPath: string, pid = process.pid): void {
  if (kind !== "macos") return;
  const child = spawn("/bin/bash", ["-c", relaunchWaiterCommand(pid, appPath)], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

export function spawnWindowsInstallWaiter(kind: "macos" | "windows", installerPath: string, pid = process.pid, env: NodeJS.ProcessEnv = process.env): void {
  if (kind !== "windows") return;
  const appPath = installedAppPath(env, "win32");
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", windowsInstallWaiterScript(pid, installerPath, appPath)],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
}

async function resolveLatestReleaseTag(
  repo: string,
  fetchLatestLocation?: (url: string) => Promise<string>,
): Promise<string> {
  const latestUrl = `https://github.com/${repo}/releases/latest`;
  if (fetchLatestLocation) {
    const tag = parseReleaseTagFromGithubUrl(await fetchLatestLocation(latestUrl));
    if (!tag) throw new Error("无法从 GitHub 发布页读取版本。");
    return tag;
  }
  const response = await githubFetch(latestUrl, {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    headers: { "user-agent": "qingzhou-update-check" },
  });
  const location = response.headers.get("location") || response.url;
  const tag = parseReleaseTagFromGithubUrl(location);
  if (!tag) throw new Error(humanizeGithubHttpStatus(response.status));
  return tag;
}

export async function githubFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("user-agent")) headers.set("user-agent", "qingzhou-update-check");
  return proxiedFetch(url, { ...init, headers });
}

async function fetchJsonDocument(url: string): Promise<unknown> {
  const response = await githubFetch(url, {
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    headers: { "user-agent": "qingzhou-update-check", accept: "application/json" },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(humanizeGithubHttpStatus(response.status, body));
  }
  return response.json();
}

async function fetchTextDocument(url: string): Promise<string> {
  const response = await githubFetch(url, {
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    headers: { "user-agent": "qingzhou-updater" },
  });
  if (!response.ok) throw new Error(`无法下载更新清单（HTTP ${response.status}）。`);
  return response.text();
}
