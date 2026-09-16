import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PiResources } from "@qingzhou/protocol";
import { defaultPiAgentDir } from "../setup/pi-agent-dir.js";
import { isInsideRoot } from "../security/path-policy.js";
import { isSkillSwapDir, reclaimSkillSwapDirs } from "./pi-skill-updates.js";

const INDEX_RE = /^index\.(ts|js|mts|mjs)$/i;
const EXT_FILE_RE = /\.(ts|js|mts|mjs)$/i;

const CONTEXT_NAMES = [
  { name: "AGENTS.override.md", kind: "override" as const },
  { name: "AGENTS.md", kind: "agents" as const },
  { name: "CLAUDE.md", kind: "claude" as const },
  { name: "SYSTEM.md", kind: "system" as const },
  { name: "APPEND_SYSTEM.md", kind: "append" as const },
];

export const RESOURCE_CONTENT_MAX = 200_000;

export const PROJECT_AGENTS_TEMPLATE = `# AGENTS.md

给在这个项目里工作的编程助手看的说明。

## 约定

-
`;

async function exists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}

async function walkParents(cwd: string): Promise<string[]> {
  const dirs: string[] = [];
  let current = path.resolve(cwd);
  const root = path.parse(current).root;
  while (true) {
    dirs.push(current);
    if (current === root) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return dirs;
}

async function listSkillDirs(dir: string, scope: "user" | "project"): Promise<PiResources["skills"]> {
  try {
    await reclaimSkillSwapDirs(dir);
    const names = await readdir(dir);
    const skills: PiResources["skills"] = [];
    for (const name of names) {
      if (isSkillSwapDir(name)) continue;
      const skillMd = path.join(dir, name, "SKILL.md");
      if (await exists(skillMd)) skills.push({ name, path: skillMd, scope, enabled: true });
    }
    return skills;
  } catch {
    return [];
  }
}

function extensionDisplayName(filePath: string): string {
  const base = path.basename(filePath);
  if (INDEX_RE.test(base)) return path.basename(path.dirname(filePath));
  return base.replace(EXT_FILE_RE, "");
}

async function findIndexFile(dir: string): Promise<string | null> {
  for (const index of ["index.ts", "index.js", "index.mts", "index.mjs"]) {
    const indexPath = path.join(dir, index);
    if (await exists(indexPath)) return indexPath;
  }
  return null;
}

async function listExtensions(dir: string, scope: "user" | "project"): Promise<PiResources["extensions"]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const found: PiResources["extensions"] = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isFile() && EXT_FILE_RE.test(entry.name)) {
        found.push({
          name: extensionDisplayName(full),
          path: full,
          scope,
          enabled: true,
        });
        continue;
      }
      if (!entry.isDirectory()) continue;
      const indexPath = await findIndexFile(full);
      if (indexPath) {
        found.push({ name: extensionDisplayName(indexPath), path: indexPath, scope, enabled: true });
      }
    }
    return found;
  } catch {
    return [];
  }
}

function packageSources(settings: Record<string, unknown>, scope: "user" | "project"): PiResources["packages"] {
  const packages = settings.packages;
  if (!Array.isArray(packages)) return [];
  const out: PiResources["packages"] = [];
  for (const item of packages) {
    if (typeof item === "string" && item.trim()) {
      out.push({ source: item.trim(), scope });
      continue;
    }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const source = (item as { source?: unknown }).source;
      if (typeof source === "string" && source.trim()) out.push({ source: source.trim(), scope });
    }
  }
  return out;
}

async function extraExtensionPaths(
  settings: Record<string, unknown>,
  baseDir: string,
  homeDir: string,
  scope: "user" | "project",
): Promise<PiResources["extensions"]> {
  const extensions = settings.extensions;
  if (!Array.isArray(extensions)) return [];
  const found: PiResources["extensions"] = [];
  for (const item of extensions) {
    if (typeof item !== "string" || item.startsWith("-") || item.startsWith("!")) continue;
    const rest = item.startsWith("+") ? item.slice(1).trim() : item.trim();
    if (!rest) continue;
    const resolved = path.resolve(baseDir, expandHome(rest, homeDir));
    let filePath: string | null = null;
    try {
      const info = await stat(resolved);
      if (info.isFile()) filePath = resolved;
      else if (info.isDirectory()) filePath = await findIndexFile(resolved);
    } catch {
      continue;
    }
    if (!filePath) continue;
    found.push({
      name: extensionDisplayName(filePath),
      path: filePath,
      scope,
      enabled: true,
    });
  }
  return found;
}

async function listTemplates(dir: string, scope: "user" | "project"): Promise<PiResources["templates"]> {
  try {
    const names = await readdir(dir);
    return names
      .filter((name) => name.endsWith(".md"))
      .map((name) => ({
        name: name.replace(/\.md$/i, ""),
        path: path.join(dir, name),
        scope,
        enabled: true,
      }));
  } catch {
    return [];
  }
}

export async function scanPiResources(
  cwd: string,
  homeDir: string,
  trustProject: boolean,
  agentDir = defaultPiAgentDir(homeDir),
): Promise<PiResources> {
  const agentsFiles: PiResources["agentsFiles"] = [];
  const globalDir = agentDir;
  for (const item of CONTEXT_NAMES) {
    const full = path.join(globalDir, item.name);
    if (await exists(full)) agentsFiles.push({ path: full, kind: item.kind });
  }

  const dirs = await walkParents(cwd);
  for (const dir of dirs) {
    let usedOverride = false;
    for (const item of CONTEXT_NAMES) {
      if (item.kind === "system" || item.kind === "append") continue;
      const full = path.join(dir, item.name);
      if (!(await exists(full))) continue;
      if (item.kind === "override") usedOverride = true;
      if (usedOverride && (item.kind === "agents" || item.kind === "claude")) continue;
      agentsFiles.push({ path: full, kind: item.kind });
    }
    const projectSystem = path.join(dir, ".pi", "SYSTEM.md");
    const projectAppend = path.join(dir, ".pi", "APPEND_SYSTEM.md");
    if (await exists(projectSystem)) agentsFiles.push({ path: projectSystem, kind: "system" });
    if (await exists(projectAppend)) agentsFiles.push({ path: projectAppend, kind: "append" });
  }

  const skills = [
    ...(await listSkillDirs(path.join(agentDir, "skills"), "user")),
    ...(await listSkillDirs(path.join(homeDir, ".agents", "skills"), "user")),
  ];
  const templates = await listTemplates(path.join(agentDir, "prompts"), "user");
  const userSettings = await readJsonObject(path.join(agentDir, "settings.json"));
  const projectSettings = trustProject
    ? await readJsonObject(path.join(cwd, ".pi", "settings.json"))
    : {};
  const extensions = [
    ...(await listExtensions(path.join(agentDir, "extensions"), "user")),
    ...(await extraExtensionPaths(userSettings, agentDir, homeDir, "user")),
  ];
  const packages = [...packageSources(userSettings, "user")];
  if (trustProject) {
    skills.push(
      ...(await listSkillDirs(path.join(cwd, ".pi", "skills"), "project")),
      ...(await listSkillDirs(path.join(cwd, ".agents", "skills"), "project")),
    );
    templates.push(...(await listTemplates(path.join(cwd, ".pi", "prompts"), "project")));
    extensions.push(
      ...(await listExtensions(path.join(cwd, ".pi", "extensions"), "project")),
      ...(await extraExtensionPaths(projectSettings, path.join(cwd, ".pi"), homeDir, "project")),
    );
    packages.push(...packageSources(projectSettings, "project"));
  }

  const excludedSkills = new Set([
    ...(await settingPathExclusions(path.join(agentDir, "settings.json"), agentDir, homeDir, "skills")),
    ...(await settingPathExclusions(path.join(cwd, ".pi", "settings.json"), path.join(cwd, ".pi"), homeDir, "skills")),
  ]);
  for (const skill of skills) {
    skill.enabled = !excludedSkills.has(path.resolve(path.dirname(skill.path)));
  }

  const excludedExtensions = new Set([
    ...(await settingPathExclusions(path.join(agentDir, "settings.json"), agentDir, homeDir, "extensions")),
    ...(await settingPathExclusions(path.join(cwd, ".pi", "settings.json"), path.join(cwd, ".pi"), homeDir, "extensions")),
  ]);
  const uniqueExtensions: PiResources["extensions"] = [];
  const seenExt = new Set<string>();
  for (const item of extensions) {
    const resolved = path.resolve(item.path);
    if (seenExt.has(resolved)) continue;
    seenExt.add(resolved);
    const dir = path.dirname(resolved);
    const index = /^index\.(ts|js|mts|mjs)$/i.test(path.basename(resolved));
    item.enabled = !excludedExtensions.has(resolved) && !(index && excludedExtensions.has(dir));
    uniqueExtensions.push(item);
  }

  return { agentsFiles, skills, templates, extensions: uniqueExtensions, packages, trustProject };
}

/** Create project-root AGENTS.md once; returns the relative path. */
export async function createProjectAgentsFile(cwd: string): Promise<string> {
  const relative = "AGENTS.md";
  const target = path.join(path.resolve(cwd), relative);
  try {
    await writeFile(target, PROJECT_AGENTS_TEMPLATE, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("AGENTS.md 已存在");
    }
    throw error;
  }
  return relative;
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

function expandHome(value: string, homeDir: string): string {
  if (value === "~") return homeDir;
  if (value.startsWith("~/")) return path.join(homeDir, value.slice(2));
  return value;
}

async function settingPathExclusions(
  settingsPath: string,
  baseDir: string,
  homeDir: string,
  key: "skills" | "extensions",
): Promise<string[]> {
  let settings: Record<string, unknown>;
  try {
    settings = await readJsonObject(settingsPath);
  } catch {
    return [];
  }
  const values = settings[key];
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (const item of values) {
    if (typeof item !== "string" || !item.startsWith("-")) continue;
    const rest = item.slice(1).trim();
    if (!rest) continue;
    out.push(path.resolve(baseDir, expandHome(rest, homeDir)));
  }
  return out;
}

function skillMarker(skillDir: string, baseDir: string): string {
  return pathListMarker(skillDir, baseDir);
}

function isSameSkillMarker(item: string, skillDir: string, baseDir: string, homeDir: string): boolean {
  return isSamePathListMarker(item, skillDir, baseDir, homeDir);
}

function extensionDisableTarget(filePath: string): string {
  const resolved = path.resolve(filePath);
  return INDEX_RE.test(path.basename(resolved)) ? path.dirname(resolved) : resolved;
}

function pathListMarker(target: string, baseDir: string): string {
  const relative = path.relative(baseDir, target);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return `-${relative}`;
  }
  return `-${target}`;
}

function isSamePathListMarker(item: string, target: string, baseDir: string, homeDir: string): boolean {
  if (!item.startsWith("-")) return false;
  const rest = item.slice(1).trim();
  if (!rest) return false;
  return path.resolve(baseDir, expandHome(rest, homeDir)) === path.resolve(target);
}

export async function setExtensionEnabled(input: {
  extensionPath: string;
  enabled: boolean;
  cwd: string;
  homeDir: string;
  agentDir: string;
  scope: "user" | "project";
}): Promise<void> {
  const target = extensionDisableTarget(input.extensionPath);
  const settingsPath =
    input.scope === "user"
      ? path.join(input.agentDir, "settings.json")
      : path.join(input.cwd, ".pi", "settings.json");
  const baseDir = path.dirname(settingsPath);
  const settingsRoot = input.scope === "user" ? input.homeDir : path.resolve(input.cwd);
  if (!isInsideRoot(path.resolve(settingsPath), path.resolve(settingsRoot))) {
    throw new Error("插件设置文件路径不合法");
  }
  await mkdir(baseDir, { recursive: true });
  const settings = await readJsonObject(settingsPath);
  const current = Array.isArray(settings.extensions)
    ? settings.extensions.filter((item) => typeof item === "string")
    : [];
  const next = current.filter((item) => !isSamePathListMarker(item, target, baseDir, input.homeDir));
  if (!input.enabled) next.push(pathListMarker(target, baseDir));
  settings.extensions = next;
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

export async function setSkillEnabled(input: {
  skillMdPath: string;
  enabled: boolean;
  cwd: string;
  homeDir: string;
  agentDir: string;
  scope: "user" | "project";
}): Promise<void> {
  const skillDir = path.dirname(path.resolve(input.skillMdPath));
  const settingsPath =
    input.scope === "user"
      ? path.join(input.agentDir, "settings.json")
      : path.join(input.cwd, ".pi", "settings.json");
  const baseDir = path.dirname(settingsPath);
  const settingsRoot = input.scope === "user" ? input.homeDir : path.resolve(input.cwd);
  if (!isInsideRoot(path.resolve(settingsPath), path.resolve(settingsRoot))) {
    throw new Error("技能设置文件路径不合法");
  }
  await mkdir(baseDir, { recursive: true });
  const settings = await readJsonObject(settingsPath);
  const current = Array.isArray(settings.skills) ? settings.skills.filter((item) => typeof item === "string") : [];
  const next = current.filter((item) => !isSameSkillMarker(item, skillDir, baseDir, input.homeDir));
  if (!input.enabled) next.push(skillMarker(skillDir, baseDir));
  settings.skills = next;
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

export async function readContextFile(filePath: string): Promise<{ content: string; truncated: boolean }> {
  const buffer = await readFile(filePath);
  return {
    content: buffer.subarray(0, RESOURCE_CONTENT_MAX).toString("utf8"),
    truncated: buffer.byteLength > RESOURCE_CONTENT_MAX,
  };
}

export async function writeContextFile(filePath: string, content: string): Promise<void> {
  if (content.length > RESOURCE_CONTENT_MAX) {
    throw new Error("文件太大，没法在这里保存。");
  }
  await writeFile(filePath, content, "utf8");
}
