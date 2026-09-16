import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import { TASK_SCHEMA_VERSION, taskRecordSchema, type TaskRecord, type TaskStatus } from "@qingzhou/protocol";
import { CoalescedJsonFile } from "./coalesced-json-file.js";

export type PersistedState = {
  schemaVersion: number;
  tasks: TaskRecord[];
};

/**
 * v2: the tasks array order is user-visible ordering (newest created first,
 * manual drag-reorder persisted as-is). v1 files are migrated once by
 * sorting on createdAt desc.
 */
export const PERSISTED_STATE_VERSION = 2;

/** Shown when a busy run is demoted after the server process restarts. */
export const SERVER_RESTART_INTERRUPT_MESSAGE = "服务已重启，上次运行被中断。请重新发送。";

const emptyState = (): PersistedState => ({
  schemaVersion: PERSISTED_STATE_VERSION,
  tasks: [],
});

function wasInterruptedByRestart(status: TaskStatus): boolean {
  return (
    status === "booting" ||
    status === "queued" ||
    status === "running" ||
    status === "waiting_approval" ||
    status === "aborting"
  );
}

export class TaskStore {
  private state: PersistedState = emptyState();
  private readonly filePath: string;
  private readonly file: CoalescedJsonFile<PersistedState>;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "state.json");
    this.file = new CoalescedJsonFile(this.filePath, () => this.state, { debounceMs: 50, fsync: false });
  }

  /** Force a durable write (used on shutdown). */
  async flushSync(): Promise<void> {
    await this.file.flushNow({ fsync: true });
  }

  getSnapshot(): TaskRecord[] {
    return this.state.tasks.map((task) => ({ ...task }));
  }

  get(id: string): TaskRecord | undefined {
    const task = this.state.tasks.find((item) => item.id === id);
    return task ? { ...task } : undefined;
  }

  listVisible(): TaskRecord[] {
    return this.state.tasks.filter((task) => !task.archivedAt).map((task) => ({ ...task }));
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as PersistedState;
      const legacy = parsed.schemaVersion !== PERSISTED_STATE_VERSION;
      if (legacy) {
        await copyFile(this.filePath, `${this.filePath}.bak`);
      }
      const tasks = Array.isArray(parsed.tasks)
        ? parsed.tasks.map((task) => {
            const restored = taskRecordSchema.parse({ ...task, schemaVersion: TASK_SCHEMA_VERSION });
            // Pi processes do not survive a server restart. Persisted runtime
            // states must therefore return to a startable state — but busy runs
            // must keep a visible error so the UI is not silently "stopped".
            if (restored.status === "error") return restored;
            if (wasInterruptedByRestart(restored.status)) {
              return {
                ...restored,
                status: "stopped" as const,
                errorMessage: restored.errorMessage?.trim() || SERVER_RESTART_INTERRUPT_MESSAGE,
              };
            }
            return { ...restored, status: "stopped" as const };
          })
        : [];
      if (legacy) {
        // v1 files never carried ordering semantics; the UI used to sort by
        // recency on every read. Normalize once so array order becomes the
        // persisted user order (newest created first) from here on.
        tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      }
      this.state = { schemaVersion: PERSISTED_STATE_VERSION, tasks };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.state = emptyState();
        return;
      }
      throw error;
    }
  }

  async upsert(task: TaskRecord): Promise<TaskRecord> {
    const next = taskRecordSchema.parse(task);
    const index = this.state.tasks.findIndex((item) => item.id === next.id);
    if (index >= 0) {
      this.state.tasks[index] = next;
    } else {
      // New tasks appear at the top; array order is the persisted UI order.
      this.state.tasks.unshift(next);
    }
    await this.flush();
    return { ...next };
  }

  /**
   * Reorders all visible tasks of one cwd group to `orderedIds` while
   * keeping their array slots (other groups stay in place relative to them).
   */
  reorder(cwd: string, orderedIds: string[]): void {
    const members = this.state.tasks.filter((task) => task.cwd === cwd && !task.archivedAt);
    const wanted = new Set(orderedIds);
    if (members.length !== wanted.size || members.some((task) => !wanted.has(task.id))) {
      throw new Error("会话列表已变化，请刷新后重试。");
    }
    const byId = new Map(members.map((task) => [task.id, task]));
    const ordered = orderedIds.map((id) => byId.get(id) as TaskRecord);
    let cursor = 0;
    this.state.tasks = this.state.tasks.map((task) =>
      task.cwd === cwd && !task.archivedAt ? ordered[cursor++]! : task,
    );
  }

  async persistReorder(cwd: string, orderedIds: string[]): Promise<void> {
    this.reorder(cwd, orderedIds);
    await this.flush();
  }

  async remove(id: string): Promise<void> {
    this.state.tasks = this.state.tasks.filter((task) => task.id !== id);
    await this.flush();
  }

  private async flush(): Promise<void> {
    await this.file.flush();
  }
}
