import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import { humanizeUserFacingError, isAccessDenied, piAuthFile, tryRepairAgentDir } from "./pi-agent-dir.js";

export type AuthFile = Record<string, { type?: string; key?: string } | undefined>;

export async function readPiAuthFile(file: string): Promise<AuthFile> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  try {
    const value: unknown = JSON.parse(raw.replace(/^\uFEFF/, ""));
    if (value && typeof value === "object" && !Array.isArray(value)) return value as AuthFile;
  } catch {
    // Never expose parser excerpts. They may contain another provider's key.
  }
  throw new Error("Pi 的登录文件格式无效。请修复 auth.json 后重试，原文件已保留。");
}

export async function updatePiAuthFile(agentDir: string, edit: (auth: AuthFile) => void | Promise<void>): Promise<void> {
  const persist = async () => {
    await mkdir(agentDir, { recursive: true, mode: 0o700 });
    const configured = piAuthFile(agentDir);
    const file = await realpath(configured).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      if ((await lstat(configured).catch(() => null))?.isSymbolicLink()) {
        throw new Error("Pi 登录文件的链接目标不存在，请修复后重试。");
      }
      return path.join(await realpath(agentDir), path.basename(configured));
    });
    // Pi locks the resolved auth.json with proper-lockfile when refreshing OAuth tokens.
    const release = await lockfile.lock(file, { realpath: false, stale: 30_000, retries: {
      retries: 12, minTimeout: 20, maxTimeout: 250, factor: 1.5, randomize: true,
    } });
    try {
      const auth = await readPiAuthFile(file);
      await edit(auth);
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(auth, null, 2)}\n`, { flag: "wx", mode: 0o600 });
        await rename(temporary, file);
      } finally {
        await rm(temporary, { force: true });
      }
    } finally {
      await release();
    }
  };

  try {
    await persist();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOCKED") {
      throw new Error("Pi 正在更新登录信息，请稍后重试。");
    }
    if (!isAccessDenied(error)) throw error;
    if (await tryRepairAgentDir(agentDir)) {
      await persist().catch((retry: unknown) => { throw new Error(humanizeUserFacingError(retry)); });
    } else {
      throw new Error(humanizeUserFacingError(error));
    }
  }
}
