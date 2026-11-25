import { access, chmod, mkdir, unlink, writeFile } from "node:fs/promises";
import { constants, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "../config.js";
import { humanizeSearchToolDownloadError } from "./pi-search-tools.js";
import { humanizeUnsupportedRegionError, isUnsupportedRegionError } from "./http-proxy.js";

export function defaultPiAgentDir(homeDir = os.homedir()): string {
  return path.join(homeDir, ".pi", "agent");
}

export function fallbackPiAgentDir(dataDir: string): string {
  return path.join(dataDir, "pi-agent");
}

export function piAuthFile(agentDir: string): string {
  return path.join(agentDir, "auth.json");
}

export function isAccessDenied(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code) : "";
  return code === "EACCES" || code === "EPERM";
}

export function humanizeAuthAccessError(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  const denied = isAccessDenied(error) || /EACCES: permission denied/i.test(message);
  if (!denied || !/auth\.json/i.test(message)) return null;
  return [
    "没法读写 Pi 的登录文件（~/.pi/agent/auth.json）。",
    "多半是这个目录属于管理员或别人（例如以前用 sudo 装过 Pi）。",
    "在终端运行：",
    '  sudo chown -R "$(whoami)" ~/.pi',
    "然后重新打开墨问。",
  ].join("\n");
}

export function npmCacheDir(agentDir: string): string {
  return path.join(agentDir, "npm-cache");
}

export function ensureNpmCacheDir(agentDir: string): string {
  const cache = npmCacheDir(agentDir);
  try {
    mkdirSync(cache, { recursive: true, mode: 0o700 });
  } catch {
    // Pi spawn still gets the path; npm will report if it cannot write.
  }
  return cache;
}

/** Point Pi/npm at a user-writable cache so a root-owned ~/.npm does not crash installs. */
export function piNpmEnv(agentDir: string): NodeJS.ProcessEnv {
  const cache = ensureNpmCacheDir(agentDir);
  return {
    npm_config_cache: cache,
    NPM_CONFIG_CACHE: cache,
    npm_config_update_notifier: "false",
    npm_config_fund: "false",
    npm_config_audit: "false",
  };
}

export function isNpmCacheAccessError(text: string): boolean {
  if (!/EACCES|EPERM|permission denied|root-owned files/i.test(text)) return false;
  return /(?:^|[\s"/])\.npm\b|_cacache|npm cache|sudo chown[\s\S]*\.npm/i.test(text);
}

export function humanizeNpmCacheAccessError(error: unknown): string | null {
  const text = extractErrorText(error) || (error instanceof Error ? error.message : String(error));
  if (!isNpmCacheAccessError(text)) return null;
  return [
    "没法写本机 npm 缓存（~/.npm）。多半以前用 sudo 装过包，缓存变成了 root 的。",
    "墨问已改用自己的缓存目录。若仍失败，在终端运行：",
    '  sudo chown -R "$(whoami)" ~/.npm',
    "然后重新打开墨问，再装一次插件。",
  ].join("\n");
}

/** Drop minified Pi/npm stack dumps so the UI does not paste a whole bundle. */
export function stripPiSourceDump(text: string): string {
  const withoutFileUrl = text.replace(/file:\/\/\S+[\s\S]*$/, "").trim();
  const withoutLogPath = withoutFileUrl.replace(/\nA complete log of this run can be found in:[\s\S]*$/i, "").trim();
  const lines = (withoutLogPath || text).split("\n").filter((line) => {
    if (line.length > 400 && /function |const |import\{|getNpmInstallRoot/.test(line)) return false;
    return true;
  });
  const kept = lines.slice(0, 16).join("\n").trim();
  if (!kept) return text.slice(0, 400);
  return kept.length > 800 ? `${kept.slice(0, 800)}…` : kept;
}

/** Pull a readable string out of SDK/Pi error objects (not `[object Object]`). */
export function extractErrorText(value: unknown, seen: Set<unknown> = new Set()): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Error) return value.message.trim() || value.name;
  if (seen.has(value)) return "";
  if (Array.isArray(value)) {
    seen.add(value);
    return value.map((item) => extractErrorText(item, seen)).filter(Boolean).join("\n");
  }
  if (typeof value === "object") {
    seen.add(value);
    const record = value as Record<string, unknown>;
    const nested = [record.error, record.message, record.errorMessage, record.msg, record.reason, record.detail, record.details]
      .map((item) => extractErrorText(item, seen))
      .find((item) => item);
    const kind =
      typeof record.type === "string"
        ? record.type
        : typeof record.code === "string"
          ? record.code
          : typeof record.status === "number"
            ? `HTTP ${record.status}`
            : "";
    if (nested) {
      if (kind && !nested.toLowerCase().includes(kind.toLowerCase())) return `${kind}: ${nested}`;
      return nested;
    }
    try {
      const json = JSON.stringify(value);
      if (json && json !== "{}" && json !== "[]") return json;
    } catch {
      // ignore circular JSON
    }
  }
  return "";
}

export function isAuthHttpError(raw: string): boolean {
  const message = raw.toLowerCase();
  if (isUnsupportedRegionError(raw)) return false;
  if (/eacces|eperm|permission denied/i.test(raw) && /auth\.json/i.test(raw)) return false;
  return (
    /\b401\b/.test(message) ||
    /\b403\b/.test(message) ||
    message.includes("authentication_error") ||
    message.includes("invalid api key") ||
    message.includes("invalid_api_key") ||
    message.includes("invalid x-api-key") ||
    /\bunauthorized\b/.test(message) ||
    message.includes("authentication failed")
  );
}

export function isProviderRequestError(raw: string): boolean {
  const message = raw.toLowerCase();
  if (/eacces|eperm|permission denied/i.test(raw) && /auth\.json/i.test(raw)) return false;
  if (isAuthHttpError(raw)) return true;
  return (
    /\b(400|404|408|409|413|422|429|500|502|503|504|529)\b/.test(message) ||
    /http\s+[45]\d\d/i.test(raw) ||
    /rate[_ ]limit|too many requests|overloaded|insufficient[_ ]quota|quota[_ ]exceeded/.test(message) ||
    /额度不足|余额不足|out of credits|credit.?balance|billing.?hard.?limit/.test(message) ||
    /context[_ ]length|model[_ ]not[_ ]found|invalid[_ ]request|billing|credit|payment[_ ]required/.test(message) ||
    /api[_ ]error|server[_ ]error|overloaded_error|rate_limit_error/.test(message)
  );
}

export function humanizeAuthHttpError(error: unknown): string | null {
  const raw = extractErrorText(error);
  if (!isAuthHttpError(raw)) return null;
  if (humanizeUnsupportedRegionError(raw)) return null;
  if (/\b403\b/.test(raw) || /forbidden/i.test(raw)) {
    return "当前密钥没有权限调用这个模型（HTTP 403）。打开设置换一个可用的 API Key，或换一个模型。";
  }
  return "登录已失效或密钥不正确（HTTP 401）。打开设置检查 API Key，或重新登录。";
}

export function isQuotaError(raw: string): boolean {
  const message = raw.toLowerCase();
  return (
    /insufficient[_ ]quota|quota[_ ]exceeded|quota.?limit/.test(message) ||
    /额度不足|余额不足|out of credits|credit.?balance|billing.?hard.?limit|payment[_ ]required/.test(message)
  );
}

export function humanizeQuotaError(error: unknown): string | null {
  const raw = extractErrorText(error);
  if (!raw || !isQuotaError(raw)) return null;
  return "额度不足，暂时无法调用模型。请检查账户余额或更换密钥。";
}

export function humanizeProviderRequestError(error: unknown): string | null {
  const raw = extractErrorText(error);
  if (!raw || !isProviderRequestError(raw)) return null;
  if (isAuthHttpError(raw)) return null;
  if (/API 请求失败/.test(raw)) return raw;
  return `API 请求失败：${raw}`;
}

export function humanizeFastModeError(error: unknown): string | null {
  const raw = extractErrorText(error) || (error instanceof Error ? error.message : String(error));
  if (/Fast mode is unavailable/i.test(raw)) return "当前模型不支持 Fast 模式。";
  return null;
}

export function humanizePathPolicyError(error: unknown): string | null {
  const raw = extractErrorText(error) || (error instanceof Error ? error.message : String(error));
  if (/Working directory is outside allowed roots/i.test(raw) || /工作文件夹不在允许的范围内/.test(raw)) {
    return "工作文件夹不在允许的范围内";
  }
  if (/Working directory does not exist:/i.test(raw)) {
    return raw.replace(/^Working directory does not exist:/i, "工作文件夹不存在：");
  }
  if (/Path is outside allowed roots:/i.test(raw)) {
    return raw.replace(/^Path is outside allowed roots:/i, "路径不在允许的范围内：");
  }
  return null;
}

export function humanizeUserFacingError(error: unknown): string {
  const text = extractErrorText(error) || (error instanceof Error ? error.message : String(error));
  return (
    humanizeFastModeError(error) ??
    humanizePathPolicyError(error) ??
    humanizeAuthAccessError(error) ??
    humanizeNpmCacheAccessError(error) ??
    humanizeSearchToolDownloadError(text) ??
    humanizeUnsupportedRegionError(error) ??
    humanizeAuthHttpError(error) ??
    humanizeQuotaError(error) ??
    humanizeProviderRequestError(error) ??
    stripPiSourceDump(text)
  );
}

/** True for missing API keys / login — not HTTP 401/403 or filesystem errors on auth.json. */
export function isMissingCredentialError(text: string): boolean {
  if (/EACCES|EPERM|permission denied/i.test(text) && /auth\.json/i.test(text)) return false;
  if (isAuthHttpError(text)) return false;
  return /api key|missing key|no credentials|please (?:log\s*in|authenticate)|not logged in/i.test(text);
}

export function shouldSurfacePiStderr(chunk: string): boolean {
  if (/auth\.json/i.test(chunk) && /EACCES|EPERM|permission denied/i.test(chunk)) return true;
  if (isNpmCacheAccessError(chunk)) return true;
  return isProviderRequestError(chunk) || isUnsupportedRegionError(chunk);
}

export async function tryRepairAgentDir(agentDir: string): Promise<boolean> {
  try {
    await chmod(agentDir, 0o700);
  } catch {
    // Directory may not exist yet, or we are not the owner.
  }
  const authPath = piAuthFile(agentDir);
  try {
    await chmod(authPath, 0o600);
  } catch {
    // File may not exist yet, or we are not the owner.
  }
  return agentDirIsUsable(agentDir, { repair: false });
}

export async function agentDirIsUsable(
  agentDir: string,
  options: { repair?: boolean } = {},
): Promise<boolean> {
  try {
    await mkdir(agentDir, { recursive: true, mode: 0o700 });
  } catch {
    return false;
  }

  const authPath = piAuthFile(agentDir);
  try {
    await access(authPath, constants.R_OK | constants.W_OK);
    return true;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") {
      return canCreateFile(agentDir);
    }
    if (options.repair !== false && isAccessDenied(error)) {
      return tryRepairAgentDir(agentDir);
    }
    return false;
  }
}

async function canCreateFile(dir: string): Promise<boolean> {
  const probe = path.join(dir, `.qingzhou-write-${process.pid}`);
  try {
    await writeFile(probe, "", { flag: "wx", mode: 0o600 });
    await unlink(probe);
    return true;
  } catch {
    try {
      await unlink(probe);
    } catch {
      // Ignore cleanup failures.
    }
    return false;
  }
}

export async function resolvePiAgentDir(homeDir: string, dataDir: string): Promise<string> {
  const standard = defaultPiAgentDir(homeDir);
  if (await agentDirIsUsable(standard)) return standard;
  const fallback = fallbackPiAgentDir(dataDir);
  await mkdir(fallback, { recursive: true, mode: 0o700 });
  return fallback;
}

export function applyPiAgentDir(config: AppConfig, piAgentDir: string): AppConfig {
  return {
    ...config,
    piAgentDir,
    piExtraEnv: {
      ...config.piExtraEnv,
      PI_CODING_AGENT_DIR: piAgentDir,
      ...piNpmEnv(piAgentDir),
    },
  };
}
