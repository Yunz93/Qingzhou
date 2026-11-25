import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { SettingsStore } from "../setup/settings-store.js";
import {
  canUpdateOnPlatform,
  inspectQingzhouUpdate,
  installQingzhouUpdate,
  isQingzhouDesktop,
  isQingzhouUpdateAvailable,
  type UpdateDownloadEvent,
} from "../setup/qingzhou-update.js";

const installSchema = z.object({ version: z.string().min(1).max(32) });
const preferencesSchema = z.object({
  autoCheckForUpdates: z.boolean().optional(),
  skippedUpdateVersion: z.string().max(32).optional(),
});

function updatePreferences(settings?: SettingsStore) {
  const current = settings?.get();
  return {
    autoCheckForUpdates: current?.autoCheckForUpdates !== false,
    skippedUpdateVersion: current?.skippedUpdateVersion ?? "",
    lastUpdateCheckAt: current?.lastUpdateCheckAt ?? null,
  };
}

export function registerUpdateRoutes(
  app: FastifyInstance,
  options: { getCurrentVersion: () => string | null; env?: NodeJS.ProcessEnv; settings?: SettingsStore },
): void {
  app.get("/api/update/preferences", async () => ({
    current: options.getCurrentVersion(),
    ...updatePreferences(options.settings),
  }));

  app.post("/api/update/preferences", async (request, reply) => {
    const parsed = preferencesSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "更新偏好无效。" });
    if (!options.settings) return { current: options.getCurrentVersion(), ...updatePreferences() };
    const next = await options.settings.save(parsed.data);
    return {
      current: options.getCurrentVersion(),
      autoCheckForUpdates: next.autoCheckForUpdates,
      skippedUpdateVersion: next.skippedUpdateVersion,
      lastUpdateCheckAt: next.lastUpdateCheckAt,
    };
  });

  app.get("/api/update/latest", async () => {
    const current = options.getCurrentVersion();
    const result = await inspectQingzhouUpdate({ env: options.env });
    const updateAvailable = isQingzhouUpdateAvailable(result.release?.version, current);
    const desktop = isQingzhouDesktop(options.env);
    const platformOk = canUpdateOnPlatform();
    if (options.settings) {
      await options.settings.save({ lastUpdateCheckAt: new Date().toISOString() });
    }
    return {
      current,
      latest: result.release?.version ?? null,
      tagName: result.release?.tagName ?? null,
      name: result.release?.name ?? null,
      url: result.release?.url ?? null,
      body: result.release?.body ?? "",
      publishedAt: result.release?.publishedAt ?? null,
      assets: result.release?.assets ?? [],
      updateAvailable,
      canUpdate: desktop && platformOk && updateAvailable && Boolean(result.asset) && !result.error,
      error: result.error,
      ...updatePreferences(options.settings),
    };
  });

  app.post("/api/update/install", async (request, reply) => {
    if (options.env?.QINGZHOU_TAURI === "1") {
      return reply.code(400).send({ error: "请从轻舟设置中安装已签名的更新。" });
    }
    if (!isQingzhouDesktop(options.env)) {
      return reply.code(400).send({ error: "开发模式不支持替换当前源码，请使用桌面版更新。" });
    }
    const parsed = installSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "请选择有效的轻舟版本。" });

    const accept = String(request.headers.accept ?? "");
    const wantsStream = accept.includes("text/event-stream");
    if (!wantsStream) {
      try {
        return await installQingzhouUpdate({ version: parsed.data.version, env: options.env });
      } catch (error) {
        const message = error instanceof Error ? error.message : "启动更新失败。";
        return reply.code(400).send({ error: message });
      }
    }

    reply.hijack();
    request.raw.socket.setNoDelay?.(true);
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    const send = (event: UpdateDownloadEvent | { event: "Done" | "Error"; data: Record<string, unknown> }) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    try {
      const result = await installQingzhouUpdate({
        version: parsed.data.version,
        env: options.env,
        onEvent: (event) => send(event),
      });
      send({ event: "Done", data: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "启动更新失败。";
      send({ event: "Error", data: { error: message } });
    } finally {
      reply.raw.end();
    }
  });
}
