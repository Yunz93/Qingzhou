import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { expandHome } from "../config.js";
import { assertAllowedCwd } from "../security/path-policy.js";
import {
  BEGINNER_PROVIDERS,
  hasAnyAuth,
  inspectModelsFile,
  piModelsPath,
  listAuthEntries,
  OAUTH_PROVIDERS,
  removeAuth,
  saveApiKey,
  tryPiLogin,
  type BeginnerProviderId,
} from "../setup/auth-status.js";
import type { AuthEntry } from "@qingzhou/protocol";
import { listFolders } from "../setup/folder-browser.js";
import {
  fetchLatestPiVersion,
  InstallPiError,
  isPiUpdateAvailable,
} from "../setup/install-pi.js";
import { isDevSelfWorkspace } from "../setup/dev-self-workspace.js";
import type { SettingsStore } from "../setup/settings-store.js";

const apiKeyBodySchema = z.object({
  provider: z.enum(["anthropic", "openai", "google", "openrouter", "deepseek"]),
  apiKey: z.string().min(8).max(512),
});

const workspaceBodySchema = z.object({
  path: z.string().min(1),
});

export type SetupStatus = {
  ready: boolean;
  piAvailable: boolean;
  piVersion: string | null;
  piError: string | null;
  authConfigured: boolean;
  configuredProviders: string[];
  providers: Array<{ id: string; label: string; hint: string }>;
  oauthProviders: Array<{ id: string; label: string }>;
  workspaceRoot: string | null;
  setupCompleted: boolean;
  allowedRoots: string[];
  homeDir: string;
  dataDir: string;
  needsSetup: boolean;
  piBundled: boolean;
  authEntries: AuthEntry[];
  hasModelsFile: boolean;
  modelsFilePath: string;
  modelCount: number;
  trustProject: boolean;
  canInstallPi: boolean;
  /** True when workspace is this repo under `pnpm dev` watch — edits restart the server. */
  devSelfWorkspace: boolean;
};

export async function buildSetupStatus(
  config: AppConfig,
  settings: SettingsStore,
  pi: { version: string | null; error: string | null },
): Promise<SetupStatus> {
  const userSettings = settings.get();
  const agentDir = config.piAgentDir;
  const authEntries = await listAuthEntries(config.homeDir, agentDir, {
    pi: { command: config.piCommand, prefixArgs: config.piPrefixArgs },
  });
  const configuredProviders = authEntries.map((entry) => entry.id);
  const authConfigured = configuredProviders.length > 0 || (await hasAnyAuth(config.homeDir, agentDir));
  const models = await inspectModelsFile(config.homeDir, agentDir);
  const piAvailable = Boolean(pi.version) && !pi.error;
  const e2e =
    process.env.QINGZHOU_E2E === "1" ||
    process.env.MOWEN_E2E === "1" ||
    process.env.OHMYPI_E2E === "1" ||
    process.env.QINGZHOU_SKIP_SETUP === "1" ||
    process.env.MOWEN_SKIP_SETUP === "1" ||
    process.env.OHMYPI_SKIP_SETUP === "1";
  const setupCompleted = e2e || Boolean(userSettings.setupCompletedAt);
  const effectiveAuth = e2e || authConfigured;
  const needsSetup = !e2e && (!piAvailable || !effectiveAuth || !setupCompleted);

  return {
    ready: piAvailable && effectiveAuth && setupCompleted,
    piAvailable,
    piVersion: pi.version,
    piError: pi.error,
    authConfigured: effectiveAuth,
    configuredProviders,
    providers: BEGINNER_PROVIDERS.map(({ id, label, hint }) => ({ id, label, hint })),
    oauthProviders: OAUTH_PROVIDERS.map(({ id, label }) => ({ id, label })),
    workspaceRoot: userSettings.workspaceRoot,
    setupCompleted,
    allowedRoots: config.allowedRoots,
    homeDir: config.homeDir,
    dataDir: config.dataDir,
    needsSetup,
    piBundled: config.piBundled,
    authEntries,
    hasModelsFile: models.present,
    modelsFilePath: piModelsPath(config.homeDir, agentDir),
    modelCount: models.count,
    trustProject: userSettings.trustProject,
    canInstallPi: !config.piBundled,
    devSelfWorkspace: isDevSelfWorkspace(userSettings.workspaceRoot),
  };
}

export function registerSetupRoutes(
  app: FastifyInstance,
  options: {
    getConfig: () => AppConfig;
    setAllowedRoots: (roots: string[]) => void;
    settings: SettingsStore;
    getPi: () => { version: string | null; error: string | null };
    refreshPi?: () => Promise<void>;
    fetchLatestPi?: () => Promise<{ version: string | null; error: string | null }>;
    onSetupChanged?: () => void | Promise<unknown>;
    loadSetup?: () => Promise<SetupStatus>;
    installPi?: () => Promise<SetupStatus & { log: string }>;
  },
): void {
  app.get("/api/setup", async () => {
    if (options.loadSetup) return options.loadSetup();
    await options.onSetupChanged?.();
    return buildSetupStatus(options.getConfig(), options.settings, options.getPi());
  });

  app.post("/api/setup/api-key", async (request, reply) => {
    const parsed = apiKeyBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "请选择服务商并粘贴有效的 API Key。" });
    }
    try {
      const config = options.getConfig();
      await saveApiKey(
        parsed.data.provider as BeginnerProviderId,
        parsed.data.apiKey,
        config.homeDir,
        config.piAgentDir,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(400).send({ error: message });
    }
    await options.onSetupChanged?.();
    return buildSetupStatus(options.getConfig(), options.settings, options.getPi());
  });

  app.post("/api/setup/logout", async (request, reply) => {
    const parsed = z.object({ provider: z.string().min(1) }).safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "请选择要退出的登录。" });
    }
    try {
      const config = options.getConfig();
      await removeAuth(parsed.data.provider, config.homeDir, config.piAgentDir);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(400).send({ error: message });
    }
    await options.onSetupChanged?.();
    return buildSetupStatus(options.getConfig(), options.settings, options.getPi());
  });

  app.post("/api/setup/login", async (request, reply) => {
    const parsed = z.object({ provider: z.string().min(1) }).safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "请选择要登录的服务商。" });
    }
    const config = options.getConfig();
    const known: string[] = [...OAUTH_PROVIDERS.map((item) => item.id), ...BEGINNER_PROVIDERS.map((item) => item.id)];
    if (!known.includes(parsed.data.provider) && !/^[a-z0-9_-]+$/i.test(parsed.data.provider)) {
      return reply.code(400).send({ error: "不支持这个服务商。" });
    }
    const result = await tryPiLogin({
      piCommand: config.piCommand,
      prefixArgs: config.piPrefixArgs,
      extraEnv: config.piExtraEnv,
      provider: parsed.data.provider,
      homeDir: config.homeDir,
      agentDir: config.piAgentDir,
    });
    await options.onSetupChanged?.();
    const setup = await buildSetupStatus(config, options.settings, options.getPi());
    return {
      ...setup,
      loginStarted: result.started,
      loginCompleted: result.completed,
      openedUrl: result.openedUrl,
      hint: result.hint,
    };
  });

  app.post("/api/setup/workspace", async (request, reply) => {
    const parsed = workspaceBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "请选择一个工作文件夹。" });
    }
    const config = options.getConfig();
    const workspace = expandHome(parsed.data.path, config.homeDir);
    try {
      // During first-run, allow picking any folder under home even if not yet in allowedRoots.
      await assertAllowedCwd(workspace, [config.homeDir, ...config.allowedRoots]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(400).send({ error: message });
    }
    await options.settings.save({
      workspaceRoot: workspace,
      setupCompletedAt: new Date().toISOString(),
    });
    const nextRoots = [workspace, ...config.allowedRoots.filter((root) => root !== workspace)];
    options.setAllowedRoots(nextRoots);
    await options.onSetupChanged?.();
    return buildSetupStatus(options.getConfig(), options.settings, options.getPi());
  });

  app.post("/api/setup/trust", async (request, reply) => {
    const parsed = z.object({ trust: z.boolean() }).safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "请选择是否信任这个项目。" });
    }
    await options.settings.save({ trustProject: parsed.data.trust });
    await options.onSetupChanged?.();
    return buildSetupStatus(options.getConfig(), options.settings, options.getPi());
  });

  app.get("/api/setup/pi-latest", async () => {
    if (options.refreshPi) await options.refreshPi();
    const config = options.getConfig();
    const current = options.getPi();
    const latest = options.fetchLatestPi
      ? await options.fetchLatestPi()
      : await fetchLatestPiVersion();
    const updateAvailable = isPiUpdateAvailable(latest.version, current.version);
    return {
      current: current.version,
      latest: latest.version,
      updateAvailable,
      canUpdate: !config.piBundled,
      piBundled: config.piBundled,
      error: latest.error,
    };
  });

  app.post("/api/setup/install-pi", async (request, reply) => {
    if (!options.installPi) {
      return reply.code(501).send({ error: "这台轻舟不支持在界面里安装 Pi。" });
    }
    const force =
      z.object({ force: z.boolean().optional() }).safeParse(request.body ?? {}).data?.force === true;
    const current = options.getPi();
    if (!force && current.version && !current.error) {
      return { ...(await buildSetupStatus(options.getConfig(), options.settings, current)), log: "" };
    }
    try {
      return await options.installPi();
    } catch (error) {
      if (error instanceof InstallPiError) {
        return reply.code(error.statusCode).send({ error: error.message, log: error.log });
      }
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(500).send({ error: message });
    }
  });

  app.post("/api/setup/complete", async () => {
    const current = options.settings.get();
    await options.settings.save({
      workspaceRoot: current.workspaceRoot ?? options.getConfig().allowedRoots[0] ?? null,
      setupCompletedAt: new Date().toISOString(),
    });
    await options.onSetupChanged?.();
    return buildSetupStatus(options.getConfig(), options.settings, options.getPi());
  });

  app.get("/api/folders", async (request, reply) => {
    const query = request.query as { path?: string };
    const config = options.getConfig();
    const browseRoots = [...new Set([config.homeDir, ...config.allowedRoots])];
    try {
      return await listFolders(query.path, browseRoots);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(400).send({ error: message });
    }
  });
}
