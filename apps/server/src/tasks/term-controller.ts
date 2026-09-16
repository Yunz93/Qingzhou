import { openNativeTerminal } from "./open-native-terminal.js";
import type { TaskRecord } from "@qingzhou/protocol";
import type { TaskShells } from "./task-shell.js";

export type TermControllerHost = {
  shells: TaskShells;
  requireTask: (taskId: string) => TaskRecord;
  emit: (taskId: string, type: string, payload: unknown) => void;
};

export class TermController {
  constructor(private readonly host: TermControllerHost) {}

  runTerm(taskId: string, command: string): { ok: true } {
    const task = this.host.requireTask(taskId);
    this.host.shells.run(taskId, {
      cwd: task.cwd,
      command,
      onChunk: (text) => this.host.emit(taskId, "term.chunk", { text }),
      onExit: (code, signal) => this.host.emit(taskId, "term.exit", { code, signal }),
    });
    return { ok: true };
  }

  startTerm(taskId: string, payload?: { cols?: number; rows?: number }): { ok: true; shell: string; pid: number } {
    const task = this.host.requireTask(taskId);
    const result = this.host.shells.startTerminal(taskId, {
      cwd: task.cwd,
      cols: payload?.cols,
      rows: payload?.rows,
      onChunk: (text) => this.host.emit(taskId, "term.chunk", { text }),
      onExit: (code, signal) => this.host.emit(taskId, "term.exit", { code, signal }),
    });
    this.host.emit(taskId, "term.ready", { shell: result.shell, cwd: task.cwd, pid: result.pid });
    return { ok: true, ...result };
  }

  inputTerm(taskId: string, data: string): { ok: true } {
    this.host.requireTask(taskId);
    if (!this.host.shells.writeTerminal(taskId, data)) {
      throw new Error("终端还没有启动。");
    }
    return { ok: true };
  }

  resizeTerm(taskId: string, cols: number, rows: number): { ok: true } {
    this.host.requireTask(taskId);
    if (!this.host.shells.resizeTerminal(taskId, cols, rows)) {
      throw new Error("终端还没有启动。");
    }
    return { ok: true };
  }

  closeTerm(taskId: string): { ok: true } {
    this.host.requireTask(taskId);
    this.host.shells.dispose(taskId);
    return { ok: true };
  }

  interruptTerm(taskId: string): { ok: true } {
    this.host.requireTask(taskId);
    this.host.shells.interrupt(taskId);
    return { ok: true };
  }

  async openNativeTerm(taskId: string): Promise<{ ok: true }> {
    const task = this.host.requireTask(taskId);
    await openNativeTerminal(task.cwd);
    return { ok: true };
  }
}
