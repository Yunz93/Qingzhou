import { spawnSync } from "node:child_process";
import { createWriteStream, existsSync, readdirSync } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { qingzhouEnv } from "../config.js";
import { pathEnvKey, prependPath } from "./install-pi.js";

export const PINNED_FD_VERSION = "10.2.0";
export const PINNED_RIPGREP_VERSION = "14.1.1";

export type SearchToolId = "fd" | "rg";

const BINARY_NAMES: Record<SearchToolId, readonly string[]> = {
  fd: ["fd", "fdfind"],
  rg: ["rg"],
};

export function searchToolBinaryName(tool: SearchToolId, platform = process.platform): string {
  const name = tool === "rg" ? "rg" : "fd";
  return platform === "win32" ? `${name}.exe` : name;
}

export function searchToolDownloadUrl(
  tool: SearchToolId,
  platform = process.platform,
  architecture = os.arch(),
): string | null {
  const arch = architecture === "arm64" ? "aarch64" : "x86_64";
  if (tool === "fd") {
    const version = PINNED_FD_VERSION;
    if (platform === "darwin") {
      return `https://github.com/sharkdp/fd/releases/download/v${version}/fd-v${version}-${arch}-apple-darwin.tar.gz`;
    }
    if (platform === "linux") {
      return `https://github.com/sharkdp/fd/releases/download/v${version}/fd-v${version}-${arch}-unknown-linux-gnu.tar.gz`;
    }
    if (platform === "win32") {
      return `https://github.com/sharkdp/fd/releases/download/v${version}/fd-v${version}-${arch}-pc-windows-msvc.zip`;
    }
    return null;
  }

  const version = PINNED_RIPGREP_VERSION;
  if (platform === "darwin") {
    return `https://github.com/BurntSushi/ripgrep/releases/download/${version}/ripgrep-${version}-${arch}-apple-darwin.tar.gz`;
  }
  if (platform === "linux") {
    const linuxArch = architecture === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-musl";
    return `https://github.com/BurntSushi/ripgrep/releases/download/${version}/ripgrep-${version}-${linuxArch}.tar.gz`;
  }
  if (platform === "win32") {
    return `https://github.com/BurntSushi/ripgrep/releases/download/${version}/ripgrep-${version}-${arch}-pc-windows-msvc.zip`;
  }
  return null;
}

export function guiSearchToolDirs(homeDir: string, platform = process.platform): string[] {
  if (platform === "win32") {
    return [
      path.join(homeDir, "scoop", "shims"),
      path.join(homeDir, "AppData", "Local", "Microsoft", "WinGet", "Links"),
    ];
  }
  if (platform === "darwin") {
    return ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];
  }
  return ["/usr/local/bin", "/usr/bin"];
}

export function shouldFetchPinnedSearchTools(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.VITEST === "true") return false;
  if (qingzhouEnv(env, "E2E") === "1") return false;
  if (qingzhouEnv(env, "SKIP_PI_TOOLS_FETCH") === "1") return false;
  return true;
}

export function humanizeSearchToolDownloadError(text: string): string | null {
  const mentionsTools = /\bfd\b|ripgrep/i.test(text);
  const looksLikeDownload =
    /not found\. Downloading|Failed to download|GitHub API error:\s*403/i.test(text);
  if (!mentionsTools || !looksLikeDownload) return null;
  return [
    "找不到搜索工具 fd / ripgrep，GitHub 拒绝了自动下载。",
    "在终端运行：",
    "  brew install fd ripgrep",
    "然后重新打开轻舟。",
  ].join("\n");
}

export function resolveBundledSearchToolsDir(env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = qingzhouEnv(env, "PI_TOOLS")?.trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  return null;
}

function pathDirs(env: NodeJS.ProcessEnv, platform = process.platform): string[] {
  const key = pathEnvKey(env, platform);
  const sep = platform === "win32" ? ";" : ":";
  return (env[key] ?? "").split(sep).filter(Boolean);
}

function findBinaryInDirs(names: readonly string[], dirs: string[], platform = process.platform): string | null {
  const suffix = platform === "win32" ? ".exe" : "";
  for (const dir of dirs) {
    for (const name of names) {
      const files = suffix && !name.endsWith(suffix) ? [`${name}${suffix}`, name] : [name];
      for (const file of files) {
        const candidate = path.join(dir, file);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

export async function installSearchToolFrom(source: string, destDir: string, destName: string): Promise<string> {
  await mkdir(destDir, { recursive: true, mode: 0o700 });
  const dest = path.join(destDir, destName);
  if (path.resolve(source) === path.resolve(dest)) return dest;
  await copyFile(source, dest);
  if (process.platform !== "win32") {
    await chmod(dest, 0o755);
  }
  return dest;
}

function findExtractedBinary(rootDir: string, binaryName: string): string | null {
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isFile() && entry.name === binaryName) return fullPath;
      if (entry.isDirectory()) stack.push(fullPath);
    }
  }
  return null;
}

async function extractArchive(archivePath: string, extractDir: string): Promise<void> {
  await mkdir(extractDir, { recursive: true });
  const result = spawnSync("tar", ["xf", archivePath, "-C", extractDir], { stdio: "pipe" });
  if (result.status !== 0) {
    const detail = result.stderr?.toString().trim() || result.stdout?.toString().trim() || `exit ${result.status}`;
    throw new Error(`Failed to extract ${path.basename(archivePath)}: ${detail}`);
  }
}

export async function downloadPinnedSearchTool(
  tool: SearchToolId,
  destDir: string,
  options: {
    platform?: NodeJS.Platform;
    architecture?: string;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<string> {
  const platform = options.platform ?? process.platform;
  const architecture = options.architecture ?? os.arch();
  const url = searchToolDownloadUrl(tool, platform, architecture);
  if (!url) throw new Error(`No pinned ${tool} build for ${platform}/${architecture}`);

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(url, {
    headers: { "User-Agent": "qingzhou-desktop" },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${tool}: ${response.status}`);
  }

  const tmp = await mkdtemp(path.join(os.tmpdir(), `qingzhou-${tool}-`));
  try {
    const archivePath = path.join(tmp, path.basename(url));
    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(archivePath));
    const extractDir = path.join(tmp, "extract");
    await extractArchive(archivePath, extractDir);
    const binaryName = searchToolBinaryName(tool, platform);
    const extracted = findExtractedBinary(extractDir, binaryName);
    if (!extracted) throw new Error(`Binary ${binaryName} missing from ${path.basename(url)}`);
    return await installSearchToolFrom(extracted, destDir, binaryName);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

export function applySearchToolsPath(
  env: NodeJS.ProcessEnv,
  dirs: string[],
  platform = process.platform,
): void {
  for (const dir of [...dirs].reverse()) {
    if (!dir) continue;
    prependPath(dir, env, platform);
  }
}

export async function ensurePiSearchTools(options: {
  agentDir: string;
  env: NodeJS.ProcessEnv;
  homeDir: string;
  bundledDir?: string | null;
  fetchMissing?: boolean;
  platform?: NodeJS.Platform;
  download?: typeof downloadPinnedSearchTool;
}): Promise<{ fd: string | null; rg: string | null }> {
  const platform = options.platform ?? process.platform;
  const binDir = path.join(options.agentDir, "bin");
  const bundledDir = options.bundledDir ?? resolveBundledSearchToolsDir(options.env);
  const extraDirs = [
    ...(bundledDir ? [bundledDir] : []),
    binDir,
    ...guiSearchToolDirs(options.homeDir, platform),
    ...pathDirs(options.env, platform),
  ];

  applySearchToolsPath(options.env, extraDirs, platform);

  const installed: { fd: string | null; rg: string | null } = { fd: null, rg: null };
  const fetchMissing = options.fetchMissing ?? shouldFetchPinnedSearchTools(options.env);
  const download = options.download ?? downloadPinnedSearchTool;

  for (const tool of ["fd", "rg"] as const) {
    const destName = searchToolBinaryName(tool, platform);
    const dest = path.join(binDir, destName);
    if (existsSync(dest)) {
      installed[tool] = dest;
      continue;
    }

    const source = findBinaryInDirs(BINARY_NAMES[tool], extraDirs, platform);
    if (source) {
      try {
        installed[tool] = await installSearchToolFrom(source, binDir, destName);
        continue;
      } catch (error) {
        console.warn(`[qingzhou] could not copy ${tool} into ${binDir}: ${error instanceof Error ? error.message : error}`);
        installed[tool] = source;
        continue;
      }
    }

    if (!fetchMissing) continue;
    try {
      installed[tool] = await download(tool, binDir, { platform });
    } catch (error) {
      console.warn(`[qingzhou] could not download ${tool}: ${error instanceof Error ? error.message : error}`);
    }
  }

  applySearchToolsPath(options.env, [binDir, ...(bundledDir ? [bundledDir] : [])], platform);
  return installed;
}
