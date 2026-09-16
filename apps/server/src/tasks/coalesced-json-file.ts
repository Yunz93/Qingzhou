import { mkdir, open, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export type CoalescedJsonFileOptions = {
  /** Debounce window before a dirty write hits disk. Default 50ms. */
  debounceMs?: number;
  /** When false, skip fsync on routine flushes (still atomic rename). Default false. */
  fsync?: boolean;
};

type Waiter = {
  generation: number;
  resolve: () => void;
  reject: (error: unknown) => void;
};

/**
 * Atomic JSON file writer with write coalescing.
 * Many in-memory mutations share one tmp+rename; awaiters resolve after their
 * mutation generation has been written.
 */
export class CoalescedJsonFile<T> {
  private writeChain: Promise<void> = Promise.resolve();
  private dirtyGeneration = 0;
  private writtenGeneration = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private waiters: Waiter[] = [];
  private readonly debounceMs: number;
  private fsync: boolean;

  constructor(
    private readonly filePath: string,
    private readonly serialize: () => T,
    options: CoalescedJsonFileOptions = {},
  ) {
    this.debounceMs = options.debounceMs ?? 50;
    this.fsync = options.fsync ?? false;
  }

  setFsync(enabled: boolean): void {
    this.fsync = enabled;
  }

  /** Mark dirty and coalesce; resolves when this mutation is durable. */
  flush(): Promise<void> {
    const generation = ++this.dirtyGeneration;
    return new Promise<void>((resolve, reject) => {
      this.waiters.push({ generation, resolve, reject });
      this.schedule();
    });
  }

  /** Cancel debounce and write immediately (shutdown / critical paths). */
  flushNow(options?: { fsync?: boolean }): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.dirtyGeneration === this.writtenGeneration && this.waiters.length === 0) {
      return this.writeChain;
    }
    if (this.dirtyGeneration === this.writtenGeneration) {
      // No dirty bytes, but waiters may exist from a completed race — resolve them.
      this.resolveWaiters();
      return this.writeChain;
    }
    return new Promise<void>((resolve, reject) => {
      this.waiters.push({ generation: this.dirtyGeneration, resolve, reject });
      this.kick(options?.fsync ?? this.fsync);
    });
  }

  private schedule(): void {
    if (this.timer !== null) return;
    if (this.debounceMs <= 0) {
      this.kick(this.fsync);
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.kick(this.fsync);
    }, this.debounceMs);
    this.timer.unref?.();
  }

  private kick(fsync: boolean): void {
    this.writeChain = this.writeChain.then(
      () => this.writeOnce(fsync),
      () => this.writeOnce(fsync),
    );
  }

  private async writeOnce(fsync: boolean): Promise<void> {
    if (this.dirtyGeneration === this.writtenGeneration) {
      this.resolveWaiters();
      return;
    }
    const generation = this.dirtyGeneration;
    try {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp-${process.pid}-${randomUUID()}`;
      const payload = `${JSON.stringify(this.serialize(), null, 2)}\n`;
      const handle = await open(tmp, "w");
      try {
        await handle.writeFile(payload, "utf8");
        if (fsync) await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(tmp, this.filePath);
      this.writtenGeneration = generation;
      this.resolveWaiters();
      if (this.dirtyGeneration !== this.writtenGeneration) {
        this.schedule();
      }
    } catch (error) {
      const waiters = this.waiters.splice(0);
      for (const waiter of waiters) waiter.reject(error);
      throw error;
    }
  }

  private resolveWaiters(): void {
    const remaining: Waiter[] = [];
    for (const waiter of this.waiters) {
      if (waiter.generation <= this.writtenGeneration) waiter.resolve();
      else remaining.push(waiter);
    }
    this.waiters = remaining;
  }
}
