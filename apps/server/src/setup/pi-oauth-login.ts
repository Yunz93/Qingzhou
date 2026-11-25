import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { openBrowser } from "./open-browser.js";
import { humanizeUserFacingError, piAuthFile, defaultPiAgentDir } from "./pi-agent-dir.js";
import { piAiModuleUrl, resolvePiAiImportRoots, resolvePiCodingAgentRoot } from "./pi-package.js";

/** UI / setup ids → Pi OAuth provider ids stored in auth.json. */
export const OAUTH_LOGIN_IDS: Record<string, string> = {
  github: "github-copilot",
  "github-copilot": "github-copilot",
  openai: "openai-codex",
  "openai-codex": "openai-codex",
};

/** Auth.json keys that mean "logged in" for a UI oauth provider id. */
export function oauthAuthIds(providerId: string): string[] {
  const loginId = OAUTH_LOGIN_IDS[providerId] ?? providerId;
  if (loginId === "github-copilot") return ["github-copilot", "github"];
  if (loginId === "openai-codex") return ["openai-codex"];
  return [loginId];
}

export function resolveOAuthLoginId(providerId: string): string | null {
  return OAUTH_LOGIN_IDS[providerId] ?? null;
}

type Credential = { type: string; [key: string]: unknown };
type CredentialStore = {
  read(providerId: string, options?: { signal?: AbortSignal }): Promise<Credential | undefined>;
  list(options?: { signal?: AbortSignal }): Promise<ReadonlyArray<{ providerId: string; type: string }>>;
  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: { signal?: AbortSignal },
  ): Promise<Credential | undefined>;
  delete(providerId: string, options?: { signal?: AbortSignal }): Promise<void>;
};

type AuthPrompt =
  | { type: "select"; message: string; options: Array<{ id: string; label: string }>; signal?: AbortSignal }
  | { type: "text" | "secret" | "manual_code"; message: string; placeholder?: string; signal?: AbortSignal };

type AuthEvent =
  | { type: "info"; message: string; links?: ReadonlyArray<{ url: string; label?: string }> }
  | { type: "auth_url"; url: string; instructions?: string }
  | {
      type: "device_code";
      userCode: string;
      verificationUri: string;
      intervalSeconds?: number;
      expiresInSeconds?: number;
    }
  | { type: "progress"; message: string };

function createAuthJsonStore(authPath: string): CredentialStore {
  const chains = new Map<string, Promise<unknown>>();

  const enqueue = async <T>(providerId: string, task: () => Promise<T>): Promise<T> => {
    const previous = chains.get(providerId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    chains.set(
      providerId,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  };

  const readAll = async (): Promise<Record<string, Credential | undefined>> => {
    try {
      const raw = await readFile(authPath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, Credential | undefined>;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  };

  const writeAll = async (data: Record<string, Credential | undefined>) => {
    await mkdir(path.dirname(authPath), { recursive: true, mode: 0o700 });
    await writeFile(authPath, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  };

  return {
    async read(providerId, options) {
      options?.signal?.throwIfAborted();
      const data = await readAll();
      return data[providerId];
    },
    async list(options) {
      options?.signal?.throwIfAborted();
      const data = await readAll();
      return Object.entries(data)
        .filter(([, value]) => value && typeof value === "object" && typeof value.type === "string")
        .map(([providerId, value]) => ({ providerId, type: value!.type }));
    },
    async modify(providerId, fn, options) {
      return enqueue(providerId, async () => {
        options?.signal?.throwIfAborted();
        const data = await readAll();
        const next = await fn(data[providerId]);
        if (next === undefined) return data[providerId];
        data[providerId] = next;
        await writeAll(data);
        return next;
      });
    },
    async delete(providerId, options) {
      await enqueue(providerId, async () => {
        options?.signal?.throwIfAborted();
        const data = await readAll();
        if (!(providerId in data)) return;
        delete data[providerId];
        await writeAll(data);
      });
    },
  };
}

async function loadOAuthModels(piRoot: string, store: CredentialStore) {
  const aiRoots = resolvePiAiImportRoots(piRoot);
  if (aiRoots.length === 0) {
    throw new Error("找不到 Pi 的 OAuth 组件（pi-ai）。");
  }
  const aiRoot = aiRoots[0]!;
  const { createModels } = (await import(piAiModuleUrl(aiRoot))) as {
    createModels: (options?: { credentials?: CredentialStore }) => {
      setProvider: (provider: unknown) => void;
      login: (
        providerId: string,
        type: "oauth" | "api_key",
        interaction: {
          signal?: AbortSignal;
          prompt: (prompt: AuthPrompt) => Promise<string>;
          notify: (event: AuthEvent) => void;
        },
      ) => Promise<Credential>;
    };
  };
  const { openaiCodexProvider } = (await import(
    piAiModuleUrl(aiRoot, "dist/providers/openai-codex.js")
  )) as { openaiCodexProvider: () => unknown };
  const { githubCopilotProvider } = (await import(
    piAiModuleUrl(aiRoot, "dist/providers/github-copilot.js")
  )) as { githubCopilotProvider: () => unknown };

  const models = createModels({ credentials: store });
  models.setProvider(openaiCodexProvider());
  models.setProvider(githubCopilotProvider());
  return { models, aiRoot };
}

/**
 * Pi OAuth modules assign `node:crypto` / `node:http` via fire-and-forget
 * dynamic imports. Wait until those settle before calling login, otherwise
 * browser OAuth throws "only available in Node.js environments".
 */
async function warmPiOAuthRuntime(aiRoot: string, loginId: string): Promise<void> {
  const oauthFile =
    loginId === "openai-codex"
      ? "dist/auth/oauth/openai-codex.js"
      : loginId === "github-copilot"
        ? "dist/auth/oauth/github-copilot.js"
        : null;
  if (oauthFile) {
    await import(piAiModuleUrl(aiRoot, oauthFile));
  }
  await Promise.all([import("node:crypto"), import("node:http")]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function authEventUrl(event: AuthEvent): string | null {
  if (event.type === "auth_url") return event.url;
  if (event.type === "device_code") {
    if (/[?&]user_code=/i.test(event.verificationUri)) return event.verificationUri;
    const join = event.verificationUri.includes("?") ? "&" : "?";
    return `${event.verificationUri}${join}user_code=${encodeURIComponent(event.userCode)}`;
  }
  if (event.type === "info") {
    return event.links?.find((link) => link.url)?.url ?? null;
  }
  return null;
}

async function answerPrompt(prompt: AuthPrompt, signal: AbortSignal): Promise<string> {
  if (prompt.type === "select") {
    const browser = prompt.options.find((option) => /browser|默认|default/i.test(option.label));
    return browser?.id ?? prompt.options[0]?.id ?? "";
  }
  if (prompt.type === "text") {
    // GitHub Copilot: blank = github.com
    return "";
  }
  if (prompt.type === "secret") {
    throw new Error("这个登录需要在终端输入密钥。");
  }
  // manual_code: leave unresolved so the local callback server can win.
  return await new Promise<string>((_resolve, reject) => {
    const onAbort = () => reject(new Error("登录已取消。"));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    prompt.signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export type PiOAuthLoginResult = {
  started: boolean;
  completed: boolean;
  loginId: string | null;
  openedUrl: string | null;
  hint: string;
};

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Drive Pi's programmatic OAuth login (browser / device code) and persist into
 * the same auth.json Pi reads. Falls back with started:false when pi-ai cannot
 * be loaded from the installed Pi package.
 */
export async function runPiOAuthLogin(options: {
  provider: string;
  piCommand: string;
  prefixArgs: string[];
  homeDir: string;
  agentDir?: string;
  openUrl?: (url: string) => void;
  timeoutMs?: number;
}): Promise<PiOAuthLoginResult> {
  const labelFallback = options.provider;
  const loginId = resolveOAuthLoginId(options.provider);
  if (!loginId) {
    return {
      started: false,
      completed: false,
      loginId: null,
      openedUrl: null,
      hint: `不支持订阅登录「${labelFallback}」。请改用 API Key，或在终端运行 pi 后输入 /login。`,
    };
  }

  const piRoot = resolvePiCodingAgentRoot({
    piCommand: options.piCommand,
    prefixArgs: options.prefixArgs,
  });
  if (!piRoot) {
    return {
      started: false,
      completed: false,
      loginId,
      openedUrl: null,
      hint: `在终端运行 pi，然后输入 /login 登录。完成后点「刷新状态」。墨问找不到本机 Pi 安装，无法代开浏览器登录。`,
    };
  }

  const agentDir = options.agentDir ?? defaultPiAgentDir(options.homeDir);
  const authPath = piAuthFile(agentDir);
  const store = createAuthJsonStore(authPath);
  const abort = new AbortController();
  const timeoutMs = options.timeoutMs ?? LOGIN_TIMEOUT_MS;
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  let openedUrl: string | null = null;
  let deviceCode: string | null = null;
  const open = options.openUrl ?? openBrowser;

  try {
    const { models, aiRoot } = await loadOAuthModels(piRoot, store);
    await warmPiOAuthRuntime(aiRoot, loginId);
    await models.login(loginId, "oauth", {
      signal: abort.signal,
      prompt: (prompt) => answerPrompt(prompt, abort.signal),
      notify: (event) => {
        if (event.type === "device_code") deviceCode = event.userCode;
        const url = authEventUrl(event);
        if (url) {
          openedUrl = url;
          open(url);
        }
      },
    });
    return {
      started: true,
      completed: true,
      loginId,
      openedUrl,
      hint: "订阅登录已完成。",
    };
  } catch (error) {
    const message = humanizeUserFacingError(error);
    const deviceHint = deviceCode ? `浏览器中的设备码是 ${deviceCode}。` : "";
    if (abort.signal.aborted) {
      return {
        started: Boolean(openedUrl),
        completed: false,
        loginId,
        openedUrl,
        hint: openedUrl
          ? `登录超时。${deviceHint}若已在浏览器完成授权，点「刷新状态」同步；或在终端运行 pi 后输入 /login。`
          : `登录超时。请在终端运行 pi，然后输入 /login。完成后点「刷新状态」。`,
      };
    }
    if (/找不到 Pi 的 OAuth|Cannot find|ERR_MODULE/i.test(message)) {
      return {
        started: false,
        completed: false,
        loginId,
        openedUrl,
        hint: `在终端运行 pi，然后输入 /login。完成后点「刷新状态」。墨问无法加载 Pi 的登录组件。`,
      };
    }
    return {
      started: Boolean(openedUrl),
      completed: false,
      loginId,
      openedUrl,
      hint: openedUrl
        ? `浏览器应已打开。${deviceHint}完成授权后点「刷新状态」。若失败：${message}`
        : `无法自动打开登录（${message}）。请在终端运行 pi，然后输入 /login，完成后点「刷新状态」。`,
    };
  } finally {
    clearTimeout(timer);
    if (!abort.signal.aborted) abort.abort();
  }
}
