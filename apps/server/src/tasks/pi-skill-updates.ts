import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import type { PiResources, SkillUpdateApplyResult, SkillUpdateCheckResult, SkillUpdateItem } from "@qingzhou/protocol";
import { qingzhouEnv } from "../config.js";
import { isInsideRoot } from "../security/path-policy.js";
import { githubFetch, humanizeGithubHttpStatus, isGithubAccessLimited } from "../setup/qingzhou-update.js";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 20_000;
const FETCH_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

export type SkillLockEntry = {
  name: string;
  source: string;
  sourceUrl?: string;
  skillPath?: string;
  skillFolderHash?: string;
  ref?: string;
};

export type GithubRepoRef = {
  owner: string;
  repo: string;
  ref: string;
  skillPath: string;
};

export type GithubTree = {
  sha: string;
  tree: Array<{ path: string; type: string; sha: string }>;
};

export type SkillUpdateHooks = {
  gitHead?: (gitRoot: string) => Promise<string | null>;
  gitLsRemote?: (gitRoot: string) => Promise<string | null>;
  gitPull?: (gitRoot: string) => Promise<void>;
  fetchGithubTree?: (input: GithubRepoRef, token?: string) => Promise<GithubTree | null>;
  applyGithub?: (input: { dest: string; remote: GithubRepoRef; token?: string }) => Promise<string>;
  githubFolderContentHash?: (input: { dest: string; remote: GithubRepoRef; token?: string }) => Promise<string | null>;
};

export function shouldFetchSkillRemotes(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.VITEST === "true") return false;
  if (qingzhouEnv(env, "E2E") === "1") return false;
  if (qingzhouEnv(env, "SKIP_SKILL_UPDATE") === "1") return false;
  return true;
}

export function githubToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const token = env.GITHUB_TOKEN?.trim() || env.GH_TOKEN?.trim();
  return token || undefined;
}

export function githubHttpsRemoteUrl(owner: string, repo: string, token?: string): string {
  if (token) return `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  return `https://github.com/${owner}/${repo}.git`;
}

/** Force git@ / ssh GitHub remotes onto HTTPS so Electron can check without SSH keys. */
export function gitRemoteCommand(args: string[]): string[] {
  return [
    "-c",
    "url.https://github.com/.insteadOf=git@github.com:",
    "-c",
    "url.https://github.com/.insteadOf=ssh://git@github.com/",
    ...args,
  ];
}

export function gitPromptlessEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "echo" };
}

export function isGithubPermissionError(error: unknown): boolean {
  if (isGithubAccessLimited(error)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /Permission denied \(publickey\)|Authentication failed|could not read Username|terminal prompts disabled/i.test(
    message,
  );
}

export function skillFolderFromExtract(extractedRoot: string, skillPath?: string): string {
  let folder = (skillPath ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (folder.toLowerCase().endsWith("/skill.md")) folder = folder.slice(0, -9);
  else if (folder.toLowerCase().endsWith("skill.md")) folder = folder.slice(0, -8);
  folder = folder.replace(/\/+$/g, "");
  return folder ? path.join(extractedRoot, ...folder.split("/")) : extractedRoot;
}

export async function hashSkillFolder(root: string): Promise<string> {
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) files.push(path.relative(root, full).replaceAll("\\", "/"));
    }
  }
  await walk(root);
  files.sort();
  const hash = createHash("sha256");
  for (const rel of files) {
    hash.update(rel);
    hash.update("\0");
    hash.update(await readFile(path.join(root, rel)));
    hash.update("\n");
  }
  return hash.digest("hex");
}

export function parseGithubRepo(raw: string | undefined | null): { owner: string; repo: string } | null {
  if (!raw?.trim()) return null;
  const trimmed = raw.trim().replace(/\.git$/i, "");
  const match = trimmed.match(/(?:github\.com[:/]|git@github\.com:)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i);
  if (!match) {
    const short = trimmed.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
    if (!short) return null;
    return { owner: short[1]!, repo: short[2]! };
  }
  return { owner: match[1]!, repo: match[2]! };
}

export function parseSkillFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const out: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const pair = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.+)$/);
    if (!pair) continue;
    out[pair[1]!] = pair[2]!.trim().replace(/^['"]|['"]$/g, "");
  }
  return out;
}

export function parseSkillLock(raw: unknown): SkillLockEntry[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const skills = (raw as { skills?: unknown }).skills;
  if (!skills || typeof skills !== "object" || Array.isArray(skills)) return [];
  const out: SkillLockEntry[] = [];
  for (const [name, value] of Object.entries(skills as Record<string, unknown>)) {
    if (!name.trim() || !value || typeof value !== "object" || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    const source =
      typeof record.source === "string"
        ? record.source.trim()
        : typeof record.sourceUrl === "string"
          ? record.sourceUrl.trim()
          : "";
    if (!source) continue;
    out.push({
      name: name.trim(),
      source,
      sourceUrl: typeof record.sourceUrl === "string" ? record.sourceUrl : undefined,
      skillPath: typeof record.skillPath === "string" ? record.skillPath.replace(/\\/g, "/") : undefined,
      skillFolderHash: typeof record.skillFolderHash === "string" ? record.skillFolderHash : undefined,
      ref: typeof record.ref === "string" ? record.ref : undefined,
    });
  }
  return out;
}

export function githubFolderHash(tree: GithubTree, skillPath?: string): string | null {
  let folder = (skillPath ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (folder.toLowerCase().endsWith("/skill.md")) folder = folder.slice(0, -9);
  else if (folder.toLowerCase().endsWith("skill.md")) folder = folder.slice(0, -8);
  folder = folder.replace(/\/+$/g, "");
  if (!folder) return tree.sha;
  const entry = tree.tree.find((item) => item.type === "tree" && item.path === folder);
  return entry?.sha ?? null;
}

export const SKILL_STAGING_SUFFIX = ".qingzhou-new";
export const SKILL_BACKUP_SUFFIX = ".qingzhou-old";

export function isSkillSwapDir(name: string): boolean {
  return name.endsWith(SKILL_STAGING_SUFFIX) || name.endsWith(SKILL_BACKUP_SUFFIX);
}

async function hasSkillMd(dir: string): Promise<boolean> {
  try {
    await readFile(path.join(dir, "SKILL.md"));
    return true;
  } catch {
    return false;
  }
}

/** Finish or discard leftover swap folders so they are never listed as skills. */
export async function reclaimSkillSwapDirs(root: string): Promise<void> {
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return;
  }
  for (const name of names) {
    if (!isSkillSwapDir(name)) continue;
    const full = path.join(root, name);
    const dest = name.endsWith(SKILL_STAGING_SUFFIX)
      ? full.slice(0, -SKILL_STAGING_SUFFIX.length)
      : full.slice(0, -SKILL_BACKUP_SUFFIX.length);
    if (name.endsWith(SKILL_STAGING_SUFFIX) && !(await hasSkillMd(dest))) {
      try {
        await rename(full, dest);
        continue;
      } catch {
        // dest may have appeared; drop the leftover instead
      }
    }
    await rm(full, { recursive: true, force: true });
  }
}

export async function replaceSkillDir(source: string, dest: string): Promise<void> {
  const staging = `${dest}${SKILL_STAGING_SUFFIX}`;
  const backup = `${dest}${SKILL_BACKUP_SUFFIX}`;
  await rm(staging, { recursive: true, force: true });
  await rm(backup, { recursive: true, force: true });
  await cp(source, staging, { recursive: true });
  try {
    await rename(dest, backup);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await rename(staging, dest);
      return;
    }
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  try {
    await rename(staging, dest);
  } catch (error) {
    await rename(backup, dest).catch(() => undefined);
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  await rm(backup, { recursive: true, force: true });
}

function skillDir(skillMdPath: string): string {
  return path.dirname(path.resolve(skillMdPath));
}

export async function findGitRoot(startDir: string, stopDir: string): Promise<string | null> {
  let current = path.resolve(startDir);
  const stop = path.resolve(stopDir);
  for (let i = 0; i < 8; i += 1) {
    try {
      await readFile(path.join(current, ".git", "HEAD"), "utf8");
      return current;
    } catch {
      try {
        const gitfile = await readFile(path.join(current, ".git"), "utf8");
        if (gitfile.startsWith("gitdir:")) return current;
      } catch {
        // keep walking
      }
    }
    if (current === stop || !isInsideRoot(current, stop)) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

async function defaultGitHead(gitRoot: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", gitRemoteCommand(["rev-parse", "HEAD"]), {
      cwd: gitRoot,
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
      env: gitPromptlessEnv(),
    });
    const sha = stdout.trim();
    return /^[0-9a-f]{7,40}$/i.test(sha) ? sha.toLowerCase() : null;
  } catch {
    return null;
  }
}

async function defaultGitLsRemote(gitRoot: string): Promise<string | null> {
  const { stdout } = await execFileAsync("git", gitRemoteCommand(["ls-remote", "origin", "HEAD"]), {
    cwd: gitRoot,
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true,
    env: gitPromptlessEnv(),
  });
  const sha = stdout.trim().split(/\s+/)[0] ?? "";
  return /^[0-9a-f]{7,40}$/i.test(sha) ? sha.toLowerCase() : null;
}

async function defaultGitPull(gitRoot: string): Promise<void> {
  await execFileAsync("git", gitRemoteCommand(["pull", "--ff-only"]), {
    cwd: gitRoot,
    timeout: 120_000,
    windowsHide: true,
    env: gitPromptlessEnv(),
  });
}

async function defaultFetchGithubTree(input: GithubRepoRef, token?: string): Promise<GithubTree | null> {
  const refs = input.ref ? [input.ref] : ["HEAD", "main", "master"];
  for (const ref of refs) {
    const url = `https://api.github.com/repos/${input.owner}/${input.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "qingzhou-skill-update",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await githubFetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (response.status === 404) continue;
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(humanizeGithubHttpStatus(response.status, body));
    }
    const raw = (await response.json()) as { sha?: unknown; tree?: unknown };
    if (typeof raw.sha !== "string" || !Array.isArray(raw.tree)) return null;
    return {
      sha: raw.sha,
      tree: raw.tree
        .filter((item): item is { path: string; type: string; sha: string } => {
          if (!item || typeof item !== "object") return false;
          const row = item as { path?: unknown; type?: unknown; sha?: unknown };
          return typeof row.path === "string" && typeof row.type === "string" && typeof row.sha === "string";
        })
        .map((item) => ({ path: item.path, type: item.type, sha: item.sha })),
    };
  }
  return null;
}

async function extractGithubSkillTarball(
  remote: GithubRepoRef,
  token?: string,
): Promise<{ tmp: string; extractedRoot: string }> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "qingzhou-skill-"));
  try {
    const archive = path.join(tmp, "skill.tgz");
    const extractDir = path.join(tmp, "extract");
    await mkdir(extractDir, { recursive: true });
    const url = `https://codeload.github.com/${remote.owner}/${remote.repo}/tar.gz/${encodeURIComponent(remote.ref || "HEAD")}`;
    const headers: Record<string, string> = { "User-Agent": "qingzhou-skill-update" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await githubFetch(url, { headers, signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!response.ok || !response.body) {
      const body = await response.text().catch(() => "");
      throw new Error(
        response.status === 401 || response.status === 403 || response.status === 429
          ? humanizeGithubHttpStatus(response.status, body)
          : `下载技能失败（HTTP ${response.status}）。`,
      );
    }
    await pipeline(response.body, createWriteStream(archive));
    await execFileAsync("tar", ["xf", archive, "-C", extractDir], { timeout: 60_000, windowsHide: true });
    const roots = await readdir(extractDir, { withFileTypes: true });
    const root = roots.find((item) => item.isDirectory());
    if (!root) throw new Error("下载的技能包是空的。");
    return { tmp, extractedRoot: path.join(extractDir, root.name) };
  } catch (error) {
    await rm(tmp, { recursive: true, force: true });
    throw error;
  }
}

function createGithubFolderHasher(token?: string): {
  hash: NonNullable<SkillUpdateHooks["githubFolderContentHash"]>;
  cleanup: () => Promise<void>;
} {
  const extracts = new Map<string, Promise<string>>();
  const tmps: string[] = [];
  return {
    hash: async (input) => {
      const key = `${input.remote.owner}/${input.remote.repo}/${input.remote.ref || "HEAD"}`;
      let pending = extracts.get(key);
      if (!pending) {
        pending = extractGithubSkillTarball(input.remote, input.token ?? token).then(({ tmp, extractedRoot }) => {
          tmps.push(tmp);
          return extractedRoot;
        });
        extracts.set(key, pending);
      }
      const extractedRoot = await pending;
      const folder = skillFolderFromExtract(extractedRoot, input.remote.skillPath);
      if (!isInsideRoot(folder, extractedRoot)) throw new Error("技能路径不合法。");
      return hashSkillFolder(folder);
    },
    cleanup: async () => {
      await Promise.all(tmps.map((dir) => rm(dir, { recursive: true, force: true })));
    },
  };
}

async function defaultApplyGithub(input: {
  dest: string;
  remote: GithubRepoRef;
  token?: string;
}): Promise<string> {
  const { tmp, extractedRoot } = await extractGithubSkillTarball(input.remote, input.token);
  try {
    const source = skillFolderFromExtract(extractedRoot, input.remote.skillPath);
    if (!isInsideRoot(source, extractedRoot)) throw new Error("技能路径不合法。");
    await replaceSkillDir(source, input.dest);
    try {
      const tree = await defaultFetchGithubTree(input.remote, input.token);
      return (tree && githubFolderHash(tree, input.remote.skillPath)) || (await hashSkillFolder(input.dest));
    } catch (error) {
      if (isGithubPermissionError(error)) return hashSkillFolder(input.dest);
      throw error;
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function readLockFile(filePath: string): Promise<{ raw: Record<string, unknown>; entries: SkillLockEntry[] }> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { raw: {}, entries: [] };
    return { raw: parsed as Record<string, unknown>, entries: parseSkillLock(parsed) };
  } catch {
    return { raw: {}, entries: [] };
  }
}

async function writeLockHash(lockPath: string, skillName: string, hash: string): Promise<void> {
  const { raw } = await readLockFile(lockPath);
  const skills =
    raw.skills && typeof raw.skills === "object" && !Array.isArray(raw.skills)
      ? { ...(raw.skills as Record<string, unknown>) }
      : {};
  const current =
    skills[skillName] && typeof skills[skillName] === "object" && !Array.isArray(skills[skillName])
      ? { ...(skills[skillName] as Record<string, unknown>) }
      : {};
  current.skillFolderHash = hash;
  current.updatedAt = new Date().toISOString();
  skills[skillName] = current;
  raw.skills = skills;
  if (typeof raw.version !== "number") raw.version = 3;
  await mkdir(path.dirname(lockPath), { recursive: true });
  await writeFile(lockPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
}

export async function resolveSkillUpdateSource(input: {
  skill: { name: string; path: string; scope: "user" | "project" };
  homeDir: string;
  cwd: string;
  locks: SkillLockEntry[];
}): Promise<{ source: SkillUpdateItem["source"]; gitRoot?: string; remote?: GithubRepoRef; lock?: SkillLockEntry }> {
  const dir = skillDir(input.skill.path);
  const lock =
    input.locks.find((item) => item.name.toLowerCase() === input.skill.name.toLowerCase()) ??
    input.locks.find((item) => {
      const folder = (item.skillPath ?? "").replace(/\/SKILL\.md$/i, "");
      return folder && dir.replace(/\\/g, "/").endsWith(folder);
    });
  if (lock) {
    const parsed = parseGithubRepo(lock.sourceUrl || lock.source);
    if (parsed) {
      return {
        source: "github",
        lock,
        remote: {
          owner: parsed.owner,
          repo: parsed.repo,
          ref: lock.ref || "HEAD",
          skillPath: lock.skillPath || "",
        },
      };
    }
  }
  const stop = input.skill.scope === "user" ? input.homeDir : input.cwd;
  const gitRoot = await findGitRoot(dir, stop);
  if (gitRoot) return { source: "git", gitRoot };
  try {
    const matter = parseSkillFrontmatter(await readFile(input.skill.path, "utf8"));
    const parsed = parseGithubRepo(matter.source || matter.repository || matter.homepage);
    if (parsed) {
      return {
        source: "github",
        remote: { owner: parsed.owner, repo: parsed.repo, ref: matter.ref || "HEAD", skillPath: matter.skillPath || "" },
      };
    }
  } catch {
    // ignore missing SKILL.md
  }
  return { source: "local" };
}

export async function checkSystemSkillUpdates(input: {
  skills: PiResources["skills"];
  homeDir: string;
  cwd: string;
  paths?: string[];
  env?: NodeJS.ProcessEnv;
  fetchRemotes?: boolean;
  hooks?: SkillUpdateHooks;
}): Promise<SkillUpdateCheckResult> {
  const env = input.env ?? process.env;
  const fetchRemotes = input.fetchRemotes ?? shouldFetchSkillRemotes(env);
  const token = githubToken(env);
  const wanted = input.paths?.length ? new Set(input.paths.map((item) => path.resolve(item))) : null;
  const systemSkills = input.skills.filter((item) => {
    if (item.scope !== "user") return false;
    if (!wanted) return true;
    return wanted.has(path.resolve(item.path));
  });
  const globalLock = path.join(input.homeDir, ".agents", ".skill-lock.json");
  const { entries } = await readLockFile(globalLock);
  const hooks = input.hooks ?? {};
  const ownedHasher = hooks.githubFolderContentHash ? null : createGithubFolderHasher(token);
  const hashRemoteGithub = hooks.githubFolderContentHash ?? ownedHasher!.hash;
  const items: SkillUpdateItem[] = [];
  try {
    for (const skill of systemSkills) {
      const resolved = await resolveSkillUpdateSource({ skill, homeDir: input.homeDir, cwd: input.cwd, locks: entries });
      if (resolved.source === "local") {
        items.push({ name: skill.name, path: skill.path, source: "local", updateAvailable: false });
        continue;
      }
      if (!fetchRemotes) {
        items.push({
          name: skill.name,
          path: skill.path,
          source: resolved.source,
          current: resolved.lock?.skillFolderHash,
          updateAvailable: false,
        });
        continue;
      }
      try {
        if (resolved.source === "git" && resolved.gitRoot) {
          const current = (await (hooks.gitHead ?? defaultGitHead)(resolved.gitRoot)) ?? undefined;
          let latest: string | undefined;
          let gitError: string | undefined;
          try {
            latest = (await (hooks.gitLsRemote ?? defaultGitLsRemote)(resolved.gitRoot)) ?? undefined;
          } catch (error) {
            gitError = isGithubPermissionError(error)
              ? humanizeGithubHttpStatus(403)
              : error instanceof Error
                ? error.message
                : "没法读取 Git 远程版本。";
          }
          items.push({
            name: skill.name,
            path: skill.path,
            source: "git",
            current,
            latest,
            updateAvailable: Boolean(current && latest && current !== latest),
            error: gitError ?? (!current || !latest ? "没法读取 Git 远程版本。" : undefined),
          });
          continue;
        }
        if (resolved.remote) {
          try {
            const tree = await (hooks.fetchGithubTree ?? defaultFetchGithubTree)(resolved.remote, token);
            const latest = tree ? githubFolderHash(tree, resolved.remote.skillPath) ?? tree.sha : undefined;
            const current = resolved.lock?.skillFolderHash;
            items.push({
              name: skill.name,
              path: skill.path,
              source: "github",
              current,
              latest: latest ?? undefined,
              updateAvailable: Boolean(current && latest && current !== latest),
              error: !current
                ? "缺少本地版本记录，无法判断是否有更新。"
                : !latest
                  ? "没法读取 GitHub 上的技能版本。"
                  : undefined,
            });
          } catch (error) {
            if (!isGithubPermissionError(error)) throw error;
            const dest = skillDir(skill.path);
            const latest = (await hashRemoteGithub({ dest, remote: resolved.remote, token })) ?? undefined;
            const current = await hashSkillFolder(dest);
            items.push({
              name: skill.name,
              path: skill.path,
              source: "github",
              current,
              latest,
              updateAvailable: Boolean(current && latest && current !== latest),
              error: latest ? undefined : humanizeGithubHttpStatus(403),
            });
          }
          continue;
        }
        items.push({ name: skill.name, path: skill.path, source: "local", updateAvailable: false });
      } catch (error) {
        items.push({
          name: skill.name,
          path: skill.path,
          source: resolved.source,
          updateAvailable: false,
          error: error instanceof Error ? error.message : "检查更新失败。",
        });
      }
    }
    return { items, checkedAt: new Date().toISOString() };
  } finally {
    await ownedHasher?.cleanup();
  }
}

export async function applySystemSkillUpdates(input: {
  skills: PiResources["skills"];
  homeDir: string;
  cwd: string;
  paths?: string[];
  env?: NodeJS.ProcessEnv;
  fetchRemotes?: boolean;
  hooks?: SkillUpdateHooks;
}): Promise<SkillUpdateApplyResult> {
  const checked = await checkSystemSkillUpdates(input);
  const targets = checked.items.filter((item) => {
    if (input.paths?.length) return input.paths.some((candidate) => path.resolve(candidate) === path.resolve(item.path));
    return item.updateAvailable;
  });
  const updated: string[] = [];
  const failed: Array<{ path: string; error: string }> = [];
  const env = input.env ?? process.env;
  const token = githubToken(env);
  const hooks = input.hooks ?? {};
  const globalLock = path.join(input.homeDir, ".agents", ".skill-lock.json");
  const { entries } = await readLockFile(globalLock);
  for (const item of targets) {
    const skill = input.skills.find((row) => path.resolve(row.path) === path.resolve(item.path));
    if (!skill) {
      failed.push({ path: item.path, error: "找不到这个技能" });
      continue;
    }
    const dest = skillDir(skill.path);
    const resolved = await resolveSkillUpdateSource({ skill, homeDir: input.homeDir, cwd: input.cwd, locks: entries });
    try {
      if (resolved.source === "git" && resolved.gitRoot) {
        await (hooks.gitPull ?? defaultGitPull)(resolved.gitRoot);
        updated.push(skill.path);
        continue;
      }
      if (resolved.source === "github" && resolved.remote) {
        const nextHash = await (hooks.applyGithub ?? defaultApplyGithub)({
          dest,
          remote: resolved.remote,
          token,
        });
        await writeLockHash(globalLock, skill.name, nextHash);
        updated.push(skill.path);
        continue;
      }
      failed.push({ path: item.path, error: "这个技能没有远程来源，不能更新。" });
    } catch (error) {
      failed.push({
        path: item.path,
        error: error instanceof Error ? error.message : "更新失败。",
      });
    }
  }
  const next = await checkSystemSkillUpdates(input);
  return { updated, failed, items: next.items };
}
