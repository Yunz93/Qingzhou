import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const state = z.record(z.string());
const key = z.string().max(1024).regex(/^qingzhou(?:\.theme$|\.ui\.[a-zA-Z]+$|:(?:shared-draft|shared-images|objective|feedback|rules|prd-draft|workroom-[\w-]+):.+)/);
const images = "qingzhou:shared-images:";
const update = z.object({ key, value: z.string().nullable() }).refine(({ key, value }) =>
  !value || value.length <= (key.startsWith(images) ? 71_000_000 : 4_000_000));
const recovery = z.array(update);

function absent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function replace(file: string, value: unknown) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
}

export function registerDesktopUiState(app: FastifyInstance, dataDir: string) {
  const file = path.join(dataDir, "desktop-ui.json");
  const attachments = path.join(dataDir, "desktop-image-drafts");
  let writes = Promise.resolve();

  async function read() {
    const raw = await readFile(file, "utf8").catch((error: unknown) => {
      if (absent(error)) return "{}";
      throw error;
    });
    return state.parse(JSON.parse(raw));
  }

  async function readAttachments() {
    const files = await readdir(attachments).catch((error: unknown) => {
      if (absent(error)) return [];
      throw error;
    });
    const snapshots = await Promise.all(files.filter((file) => /^[a-f0-9]{64}\.json$/.test(file)).map(async (file) => {
      const raw = await readFile(path.join(attachments, file), "utf8");
      return state.parse(JSON.parse(raw));
    }));
    return Object.assign({}, ...snapshots);
  }

  app.get("/api/desktop/ui", async (_request, reply) => {
    try {
      await writes;
      return { ...await read(), ...await readAttachments() };
    } catch {
      return reply.code(500).send({ error: "桌面偏好与草稿暂时无法读取，原文件已保留。" });
    }
  });

  function saveChange({ key: name, value }: z.infer<typeof update>) {
    const save = writes.then(async () => {
      if (name.startsWith(images)) {
        const target = path.join(attachments, `${createHash("sha256").update(name).digest("hex")}.json`);
        if (value === null) await rm(target, { force: true });
        else {
          await mkdir(attachments, { recursive: true, mode: 0o700 });
          await replace(target, { [name]: value });
        }
        return;
      }
      const current = await read();
      if (value === null ? !(name in current) : current[name] === value) return;
      if (value === null) delete current[name];
      else current[name] = value;
      await replace(file, current);
    });
    writes = save.catch(() => undefined);
    return save;
  }

  app.put("/api/desktop/ui", { bodyLimit: 72_000_000 }, async (request, reply) => {
    const parsed = update.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "无法保存这项桌面状态。" });
    try {
      await saveChange(parsed.data);
      return reply.code(204).send();
    } catch {
      return reply.code(500).send({ error: "无法保存桌面草稿或偏好，请保留当前窗口并重试。" });
    }
  });

  return async (changes: unknown) => {
    for (const change of recovery.parse(changes)) await saveChange(change);
  };
}
