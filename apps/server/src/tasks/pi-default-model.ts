import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ModelRef } from "@qingzhou/protocol";
import { isInsideRoot } from "../security/path-policy.js";

export type PiDefaultModel = Pick<ModelRef, "provider" | "id">;

function settingsPath(agentDir: string): string {
  const filePath = path.join(agentDir, "settings.json");
  if (!isInsideRoot(path.resolve(filePath), path.resolve(agentDir))) {
    throw new Error("Pi 设置文件路径不合法");
  }
  return filePath;
}

function parseObject(raw: string, label: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} 不是对象`);
  }
  return parsed as Record<string, unknown>;
}

function parseDefaultModel(settings: Record<string, unknown>): PiDefaultModel | null {
  const provider = typeof settings.defaultProvider === "string" ? settings.defaultProvider.trim() : "";
  const id = typeof settings.defaultModel === "string" ? settings.defaultModel.trim() : "";
  if (provider && id) return { provider, id };
  if (!provider && id.includes("/")) {
    const slash = id.indexOf("/");
    const fromId = id.slice(0, slash).trim();
    const modelId = id.slice(slash + 1).trim();
    if (fromId && modelId) return { provider: fromId, id: modelId };
  }
  return null;
}

async function readSettings(agentDir: string): Promise<Record<string, unknown>> {
  const filePath = settingsPath(agentDir);
  try {
    return parseObject(await readFile(filePath, "utf8"), path.basename(filePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export function readPiDefaultModelSync(agentDir: string): PiDefaultModel | null {
  try {
    return parseDefaultModel(parseObject(readFileSync(settingsPath(agentDir), "utf8"), "settings.json"));
  } catch {
    return null;
  }
}

export async function readPiDefaultModel(agentDir: string): Promise<PiDefaultModel | null> {
  return parseDefaultModel(await readSettings(agentDir));
}

export async function writePiDefaultModel(agentDir: string, model: PiDefaultModel): Promise<PiDefaultModel> {
  const filePath = settingsPath(agentDir);
  const settings = await readSettings(agentDir);
  settings.defaultProvider = model.provider;
  settings.defaultModel = model.id;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return { provider: model.provider, id: model.id };
}
