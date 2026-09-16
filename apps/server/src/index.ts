import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import staticFiles from "@fastify/static";
import websocket from "@fastify/websocket";
import { loadDotEnv } from "./env.js";
import { isAllowedHost, isAllowedOrigin, loadConfig, readPiVersion, resolvePiRuntime } from "./config.js";
import { registerHealth } from "./routes/health.js";
import { registerSetupRoutes, buildSetupStatus } from "./routes/setup.js";
import { registerExportRoutes } from "./routes/exports.js";
import { registerUploads } from "./routes/uploads.js";
import { ensureSessionCookie } from "./security/session-cookie.js";
import { SettingsStore } from "./setup/settings-store.js";
import {
  applyPiBinToEnv,
  discoverPiExecutable,
  fetchLatestPiVersion,
  InstallPiError,
  pathEnvKey,
  runOfficialPiInstall,
} from "./setup/install-pi.js";
import { applyPiAgentDir, resolvePiAgentDir } from "./setup/pi-agent-dir.js";
import { ensurePiSearchTools } from "./setup/pi-search-tools.js";
import { TaskStore } from "./tasks/task-store.js";
import { TaskService } from "./tasks/task-service.js";
import { WorkItemStore } from "./tasks/work-item-store.js";
import { registerWebsocket } from "./websocket/socket-handler.js";
import { registerUpdateRoutes } from "./routes/update.js";
import { currentQingzhouVersion } from "./setup/qingzhou-update.js";
import { applyEnvHttpProxy } from "./setup/http-proxy.js";

export {
  applyEnvHttpProxy,
  normalizeProxyEnv,
  parsePacProxyResult,
  readProxyUrl,
} from "./setup/http-proxy.js";

loadDotEnv();

export async function createApp(env: NodeJS.ProcessEnv = process.env) {
  const proxy = await applyEnvHttpProxy(env);
  if (proxy) {
    console.log(`[qingzhou] HTTP proxy: ${proxy}`);
  }
  const provisional = loadConfig(env);
  await mkdir(provisional.dataDir, { recursive: true });
  const settings = new SettingsStore(provisional.dataDir);
  await settings.load();

  let config = loadConfig(env, {
    workspaceRoot: settings.get().workspaceRoot,
    homeDir: provisional.homeDir,
    trustProject: settings.get().trustProject,
  });
  await mkdir(config.dataDir, { recursive: true });
  config = applyPiAgentDir(config, await resolvePiAgentDir(config.homeDir, config.dataDir));
  env.PI_CODING_AGENT_DIR = config.piAgentDir;
  await ensurePiSearchTools({
    agentDir: config.piAgentDir,
    env,
    homeDir: config.homeDir,
  });
  const pathKey = pathEnvKey(env);
  config = {
    ...config,
    piExtraEnv: {
      ...config.piExtraEnv,
      PI_CODING_AGENT_DIR: config.piAgentDir,
      [pathKey]: env[pathKey],
    },
  };

  const { version, error } = await readPiVersion(config);
  console.log(`[qingzhou] Pi version: ${version ?? "unavailable"}`);
  if (error) {
    console.warn(`[qingzhou] ${error}`);
  }

  const store = new TaskStore(config.dataDir);
  await store.load();
  const workItems = new WorkItemStore(config.dataDir);
  await workItems.load();
  const service = new TaskService(config, store, version, error, workItems);
  const healthInfo = {
    piVersion: version,
    piError: error,
    mutations: config.mutations,
  };

  const refreshSetupHints = async () => {
    const setup = await buildSetupStatus(config, settings, {
      version: healthInfo.piVersion,
      error: healthInfo.piError,
    });
    service.setSetupHints({
      authConfigured: setup.authConfigured,
      configuredProviders: setup.configuredProviders,
      needsSetup: setup.needsSetup,
      homeDir: setup.homeDir,
      workspaceRoot: setup.workspaceRoot,
      authEntries: setup.authEntries,
      trustProject: setup.trustProject,
    });
    return setup;
  };
  await refreshSetupHints();

  async function adoptPiBin(bin: string): Promise<void> {
    applyPiBinToEnv(bin, env);
    const runtime = resolvePiRuntime(env);
    const pathKey = pathEnvKey(env);
    config = {
      ...config,
      piBin: bin,
      piCommand: runtime.command,
      piPrefixArgs: runtime.prefixArgs,
      piExtraEnv: {
        ...runtime.extraEnv,
        PI_CODING_AGENT_DIR: config.piAgentDir,
        [pathKey]: env[pathKey],
      },
    };
    service.updateConfig(config);
  }

  async function refreshPiState(): Promise<void> {
    const next = await readPiVersion(config);
    healthInfo.piVersion = next.version;
    healthInfo.piError = next.error;
    service.setPi(next.version, next.error);
    if (next.version) {
      console.log(`[qingzhou] Pi version: ${next.version}`);
    } else if (next.error) {
      console.warn(`[qingzhou] ${next.error}`);
    }
  }

  async function installPi(): Promise<Awaited<ReturnType<typeof buildSetupStatus>> & { log: string }> {
    if (config.piBundled) {
      throw new InstallPiError("桌面版已内置 Pi。请退出后重新打开轻舟；如果还是不行，重新安装一次。", 400);
    }
    const result = await runOfficialPiInstall({ homeDir: config.homeDir, env });
    const bin = result.bin ?? (await discoverPiExecutable({ homeDir: config.homeDir, env }));
    if (bin) await adoptPiBin(bin);
    config = applyPiAgentDir(config, await resolvePiAgentDir(config.homeDir, config.dataDir));
    env.PI_CODING_AGENT_DIR = config.piAgentDir;
    await ensurePiSearchTools({
      agentDir: config.piAgentDir,
      env,
      homeDir: config.homeDir,
    });
    const pathKey = pathEnvKey(env);
    config = {
      ...config,
      piExtraEnv: {
        ...config.piExtraEnv,
        PI_CODING_AGENT_DIR: config.piAgentDir,
        [pathKey]: env[pathKey],
      },
    };
    service.updateConfig(config);
    await refreshPiState();
    if (!healthInfo.piVersion) {
      throw new InstallPiError(
        healthInfo.piError ?? "安装完成，但还是找不到 Pi 可执行文件。",
        500,
        result.log,
      );
    }
    const status = await refreshSetupHints();
    return { ...status, log: result.log };
  }

  const app = Fastify({
    logger: {
      level: "info",
      redact: ["req.headers.cookie", "req.headers.authorization", "req.body.apiKey"],
    },
  });

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  await app.register(websocket);

  app.addHook("onRequest", async (request, reply) => {
    if (!isAllowedHost(request.headers.host, config.host)) {
      return reply.code(403).send({ error: "host denied" });
    }
    const origin = request.headers.origin;
    if (origin && !isAllowedOrigin(origin, config.allowedOrigins, config.host)) {
      return reply.code(403).send({ error: "origin denied" });
    }
    ensureSessionCookie(request, reply);
  });

  registerHealth(app, healthInfo);

  registerSetupRoutes(app, {
    getConfig: () => config,
    setAllowedRoots: (roots) => {
      config = { ...config, allowedRoots: roots };
      service.updateConfig(config);
    },
    settings,
    getPi: () => ({ version: healthInfo.piVersion, error: healthInfo.piError }),
    refreshPi: refreshPiState,
    fetchLatestPi: () => fetchLatestPiVersion({ env }),
    installPi,
    loadSetup: refreshSetupHints,
    onSetupChanged: async () => {
      const nextTrust = settings.get().trustProject;
      if (config.trustProject !== nextTrust) {
        config = { ...config, trustProject: nextTrust };
        service.updateConfig(config);
      }
      await refreshSetupHints();
      void service.refreshResources();
    },
  });
  registerUpdateRoutes(app, {
    getCurrentVersion: () => currentQingzhouVersion(env),
    env,
    settings,
  });

  app.get("/api/session", async () => {
    const setup = await refreshSetupHints();
    return {
      ...service.buildSnapshot(null),
      setup,
    };
  });
  registerExportRoutes(app, () => config);
  registerUploads(app, service, config.allowedOrigins, config.host);
  registerWebsocket(app, config, service);

  if (config.nodeEnv === "production") {
    await app.register(staticFiles, {
      root: config.webDistDir,
      prefix: "/",
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.raw.method === "GET" && !request.url.startsWith("/api") && !request.url.startsWith("/ws")) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "Not found" });
    });
  }

  return { app, config, service, settings };
}

async function main(): Promise<void> {
  const { app, config, service } = await createApp();
  await app.listen({ host: config.host, port: config.port });
  console.log(`[qingzhou] listening on http://${config.host}:${config.port}`);
  console.log(`[qingzhou] open that address in your browser to finish setup if needed`);

  const shutdown = async (signal: string) => {
    console.log(`[qingzhou] ${signal}: flushing stores…`);
    try {
      await service.flushPersist();
    } catch (error) {
      console.error("[qingzhou] flush failed", error);
    }
    try {
      await app.close();
    } finally {
      process.exit(0);
    }
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
