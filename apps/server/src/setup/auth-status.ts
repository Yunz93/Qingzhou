import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AuthEntry } from "@qingzhou/protocol";
import {
  defaultPiAgentDir,
  piAuthFile,
} from "./pi-agent-dir.js";
import { verifyGeminiSaveTarget } from "./gemini-target.js";
import { readPiAuthFile, updatePiAuthFile, type AuthFile } from "./pi-auth-file.js";
import { oauthAuthIds, runPiOAuthLogin, type PiOAuthLoginResult } from "./pi-oauth-login.js";
import { listPiAuthEntries, mergeAuthEntries } from "./pi-auth-entries.js";

export const OAUTH_PROVIDERS = [
  { id: "github", label: "GitHub Copilot" },
  { id: "openai", label: "OpenAI (ChatGPT)" },
] as const;

/** Providers we expose in the beginner setup wizard. */
export const BEGINNER_PROVIDERS = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    envVar: "ANTHROPIC_API_KEY",
    hint: "以 sk-ant- 开头",
  },
  {
    id: "openai",
    label: "OpenAI",
    envVar: "OPENAI_API_KEY",
    hint: "以 sk- 开头",
  },
  {
    id: "google",
    label: "Google Gemini",
    envVar: "GEMINI_API_KEY",
    hint: "Gemini API Key",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    envVar: "OPENROUTER_API_KEY",
    hint: "以 sk-or- 开头",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    envVar: "DEEPSEEK_API_KEY",
    hint: "DeepSeek API Key",
  },
] as const;

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI",
  "openai-codex": "OpenAI (ChatGPT)",
  google: "Google Gemini",
  openrouter: "OpenRouter",
  deepseek: "DeepSeek",
  github: "GitHub Copilot",
  "github-copilot": "GitHub Copilot",
  copilot: "GitHub Copilot",
  groq: "Groq",
  xai: "xAI",
  mistral: "Mistral",
  grok: "xAI",
  kimi: "Kimi",
  minimax: "MiniMax",
};

export type BeginnerProviderId = (typeof BEGINNER_PROVIDERS)[number]["id"];

export function piAuthPath(homeDir = os.homedir(), agentDir = defaultPiAgentDir(homeDir)): string {
  return piAuthFile(agentDir);
}

export function piModelsPath(homeDir = os.homedir(), agentDir = defaultPiAgentDir(homeDir)): string {
  return path.join(agentDir, "models.json");
}

export function authKind(type: string | undefined): AuthEntry["kind"] {
  if (type === "api_key") return "api_key";
  if (type && /oauth|subscription|login|token/i.test(type)) return "oauth";
  return type ? "other" : "other";
}

export async function listAuthEntries(
  homeDir = os.homedir(),
  agentDir = defaultPiAgentDir(homeDir),
  options: { pi?: { command: string; prefixArgs: string[] } } = {},
): Promise<AuthEntry[]> {
  const auth: AuthFile = await readPiAuthFile(piAuthFile(agentDir)).catch(() => ({}));
  const fromFile: AuthEntry[] = Object.entries(auth)
    .filter(([, value]) => {
      if (!value || typeof value !== "object") return false;
      if (value.type === "api_key") return typeof value.key === "string" && value.key.trim().length > 0;
      return Boolean(value.type);
    })
    .map(([id, value]) => ({
      id,
      label: PROVIDER_LABELS[id] ?? id,
      kind: authKind(value?.type),
      source: "auth_file" as const,
    }));

  const fromEnv: AuthEntry[] = BEGINNER_PROVIDERS.filter((provider) => {
    const value = process.env[provider.envVar];
    return Boolean(value && value.trim()) && !fromFile.some((entry) => entry.id === provider.id);
  }).map((provider) => ({
    id: provider.id,
    label: provider.label,
    kind: "api_key" as const,
    source: "env" as const,
    envVar: provider.envVar,
  }));

  const entries = [...fromFile, ...fromEnv];
  if (options.pi) {
    mergeAuthEntries(
      entries,
      await listPiAuthEntries({
        agentDir,
        piCommand: options.pi.command,
        piPrefixArgs: options.pi.prefixArgs,
      }),
    );
  }

  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

export async function listConfiguredProviders(
  homeDir = os.homedir(),
  agentDir = defaultPiAgentDir(homeDir),
): Promise<string[]> {
  const entries = await listAuthEntries(homeDir, agentDir);
  return entries.map((entry) => entry.id);
}

export async function inspectModelsFile(
  homeDir = os.homedir(),
  agentDir = defaultPiAgentDir(homeDir),
): Promise<{ present: boolean; count: number }> {
  try {
    const raw = await readFile(piModelsPath(homeDir, agentDir), "utf8");
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, "")) as {
      models?: unknown[];
      providers?: Record<string, { models?: unknown[] } | null>;
    } | unknown[] | null;
    if (Array.isArray(parsed)) return { present: true, count: parsed.length };
    let count = Array.isArray(parsed?.models) ? parsed.models.length : 0;
    for (const provider of Object.values(parsed?.providers ?? {})) {
      if (Array.isArray(provider?.models)) count += provider.models.length;
    }
    return { present: true, count };
  } catch {
    return { present: false, count: 0 };
  }
}

export async function hasAnyAuth(
  homeDir = os.homedir(),
  agentDir = defaultPiAgentDir(homeDir),
): Promise<boolean> {
  const configured = await listConfiguredProviders(homeDir, agentDir);
  return configured.length > 0;
}

export async function saveApiKey(
  providerId: BeginnerProviderId,
  apiKey: string,
  homeDir = os.homedir(),
  agentDir = defaultPiAgentDir(homeDir),
  confirmedGeminiTarget?: string,
): Promise<void> {
  const key = apiKey.trim();
  if (!isLiteralApiKey(key)) {
    throw new Error("请粘贴完整的 API Key。");
  }
  if (!BEGINNER_PROVIDERS.some((provider) => provider.id === providerId)) {
    throw new Error("不支持这个服务商");
  }
  await updatePiAuthFile(agentDir, async (auth) => {
    if (providerId === "google") await verifyGeminiSaveTarget(agentDir, confirmedGeminiTarget);
    auth[providerId] = { type: "api_key", key };
  });
}

export function isLiteralApiKey(value: string): boolean {
  return value.length >= 8 && value.length <= 512 && !value.startsWith("!") && /^[\x21-\x7e]+$/.test(value) && !value.includes("$");
}

export async function removeAuth(
  providerId: string,
  homeDir = os.homedir(),
  agentDir = defaultPiAgentDir(homeDir),
): Promise<void> {
  const id = providerId.trim();
  if (!id) throw new Error("请选择要退出的登录");
  const candidates = [...new Set([id, ...oauthAuthIds(id)])];
  await updatePiAuthFile(agentDir, (auth) => {
    const key = candidates.find((candidate) => Object.hasOwn(auth, candidate));
    if (!key) throw new Error("没有这条登录");
    delete auth[key];
  });
}

export async function tryPiLogin(options: {
  piCommand: string;
  prefixArgs: string[];
  extraEnv?: NodeJS.ProcessEnv;
  provider: string;
  homeDir: string;
  agentDir?: string;
}): Promise<PiOAuthLoginResult> {
  return runPiOAuthLogin({
    provider: options.provider,
    piCommand: options.piCommand,
    prefixArgs: options.prefixArgs,
    homeDir: options.homeDir,
    agentDir: options.agentDir,
  });
}

/** Find a saved auth entry that matches a UI provider id (incl. oauth aliases). */
export function matchAuthEntry(
  entries: AuthEntry[],
  providerId: string,
  mode: "oauth" | "api_key" | "any" = "any",
): AuthEntry | undefined {
  if (mode === "oauth") {
    const ids = new Set(oauthAuthIds(providerId));
    return entries.find((entry) => ids.has(entry.id) && entry.kind === "oauth");
  }
  if (mode === "api_key") {
    return entries.find((entry) => entry.id === providerId && entry.kind === "api_key");
  }
  const oauth = matchAuthEntry(entries, providerId, "oauth");
  if (oauth) return oauth;
  return entries.find((entry) => entry.id === providerId);
}
