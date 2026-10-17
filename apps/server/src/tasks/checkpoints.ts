import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type CheckpointRecord = {
  id: string;
  taskId: string;
  path: string;
  createdAt: string;
  toolName?: string;
};

const MAX_PER_TASK = 40;

export class CheckpointStore {
  constructor(private readonly dataDir: string) {}

  private indexPath(taskId: string): string {
    return path.join(this.dataDir, "checkpoints", taskId, "index.json");
  }

  private snapshotPath(taskId: string, id: string, relativePath: string): string {
    return path.join(this.dataDir, "checkpoints", taskId, id, relativePath);
  }

  async list(taskId: string): Promise<CheckpointRecord[]> {
    try {
      const raw = await readFile(this.indexPath(taskId), "utf8");
      const parsed = JSON.parse(raw) as { checkpoints?: CheckpointRecord[] };
      return Array.isArray(parsed.checkpoints) ? parsed.checkpoints : [];
    } catch {
      return [];
    }
  }

  async save(taskId: string, cwd: string, relativePath: string, toolName?: string): Promise<CheckpointRecord | null> {
    const source = path.isAbsolute(relativePath) ? relativePath : path.join(cwd, relativePath);
    let exists = true;
    try {
      await readFile(source);
    } catch {
      exists = false;
    }
    if (!exists) return null;

    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const dest = this.snapshotPath(taskId, id, relativePath);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(source, dest);
    const record: CheckpointRecord = {
      id,
      taskId,
      path: relativePath,
      createdAt: new Date().toISOString(),
      toolName,
    };
    const current = await this.list(taskId);
    const next = [record, ...current].slice(0, MAX_PER_TASK);
    await mkdir(path.dirname(this.indexPath(taskId)), { recursive: true });
    await writeFile(this.indexPath(taskId), `${JSON.stringify({ checkpoints: next }, null, 2)}\n`, "utf8");
    return record;
  }

  async restore(taskId: string, checkpointId: string, cwd: string): Promise<CheckpointRecord> {
    const current = await this.list(taskId);
    const record = current.find((item) => item.id === checkpointId);
    if (!record) throw new Error("找不到这个检查点");
    const source = this.snapshotPath(taskId, record.id, record.path);
    const dest = path.isAbsolute(record.path) ? record.path : path.join(cwd, record.path);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(source, dest);
    return record;
  }

  async restoreLatestByPath(taskId: string, filePath: string, cwd: string): Promise<CheckpointRecord> {
    const current = await this.list(taskId);
    const requested = path.resolve(cwd, filePath);
    const record = current.find((item) => {
      // Old checkpoints can store absolute paths; compare the full resolved
      // path so a newer src/note.ts never shadows a checkpoint for note.ts.
      return path.relative(path.resolve(cwd, item.path), requested) === "";
    });
    if (!record) throw new Error("找不到这个文件的检查点");
    return this.restore(taskId, record.id, cwd);
  }
}
