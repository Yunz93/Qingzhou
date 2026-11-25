import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config.js";

export class ProfileBusyError extends Error {
  constructor() {
    super("这个轻舟资料目录已被另一个实例打开。请关闭该实例后重试。");
  }
}

export async function lockProfile(env: NodeJS.ProcessEnv, desktop = false): Promise<() => void> {
  const { dataDir } = loadConfig(env);
  await mkdir(dataDir, { recursive: true });
  const directory = await realpath(dataDir);
  const { DatabaseSync } = await import("node:sqlite");
  const lock = new DatabaseSync(path.join(directory, ".service-lock.sqlite"));
  try {
    // The OS releases SQLite's exclusive write lock even if the service crashes.
    lock.exec("BEGIN EXCLUSIVE");
    if (desktop) await checkLegacyService(directory, env.QINGZHOU_LEGACY_PORT);
    return () => lock.close();
  } catch (error) {
    lock.close();
    if ((error as { errcode?: number }).errcode === 5) throw new ProfileBusyError();
    throw error;
  }
}

async function checkLegacyService(directory: string, port: string | undefined) {
  const ports = new Set([4310, Number(port)]);
  for (const candidate of ports) {
    if (!Number.isInteger(candidate) || candidate < 1 || candidate > 65_535) continue;
    const existing = await fetch(`http://127.0.0.1:${candidate}/api/setup`, {
      redirect: "error", signal: AbortSignal.timeout(500),
    }).then(async (response) => {
      if (!response.ok) return null;
      const setup = await response.json() as { dataDir?: unknown };
      return typeof setup.dataDir === "string" ? await realpath(setup.dataDir) : null;
    }).catch(() => null);
    if (existing === directory) throw new ProfileBusyError();
  }
}
