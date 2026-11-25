import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IPty } from "node-pty";

export const TERM_TIMEOUT_MS = 120_000;
export const TERM_MAX_OUTPUT = 200_000;

type RunInput = {
  cwd: string;
  command: string;
  onChunk: (text: string) => void;
  onExit: (code: number | null, signal: string | null) => void;
  timeoutMs?: number;
};

export type TerminalInput = {
  cwd: string;
  cols?: number;
  rows?: number;
  onChunk: (text: string) => void;
  onExit: (code: number | null, signal: string | null) => void;
};

export class TaskShells {
  private readonly children = new Map<string, ChildProcess>();
  private readonly terminals = new Map<string, IPty>();

  running(taskId: string): boolean {
    return this.children.has(taskId) || this.terminals.has(taskId);
  }

  terminal(taskId: string): IPty | undefined {
    return this.terminals.get(taskId);
  }

  startTerminal(taskId: string, input: TerminalInput): { shell: string; pid: number } {
    if (this.terminals.has(taskId)) {
      const current = this.terminals.get(taskId)!;
      return { shell: current.process, pid: current.pid };
    }
    if (this.children.has(taskId)) throw new Error("上一条命令还在跑，先停再执行。");
    ensurePtyHelperExecutable();
    const shell = resolveInteractiveShell();
    const terminal = nodePty.spawn(shell, interactiveShellArgs(shell), {
      name: "xterm-256color",
      cols: clampDimension(input.cols ?? 100),
      rows: clampDimension(input.rows ?? 30),
      cwd: input.cwd,
      env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", TERM_PROGRAM: "Qingzhou" },
    });
    this.terminals.set(taskId, terminal);
    terminal.onData(input.onChunk);
    terminal.onExit(({ exitCode, signal }) => {
      this.terminals.delete(taskId);
      input.onExit(exitCode ?? null, signal ? String(signal) : null);
    });
    return { shell, pid: terminal.pid };
  }

  writeTerminal(taskId: string, data: string): boolean {
    const terminal = this.terminals.get(taskId);
    if (!terminal) return false;
    terminal.write(data);
    return true;
  }

  resizeTerminal(taskId: string, cols: number, rows: number): boolean {
    const terminal = this.terminals.get(taskId);
    if (!terminal) return false;
    terminal.resize(clampDimension(cols), clampDimension(rows));
    return true;
  }

  run(taskId: string, input: RunInput): void {
    if (this.children.has(taskId) || this.terminals.has(taskId)) {
      throw new Error("上一条命令还在跑，先停再执行。");
    }
    const command = input.command.trim();
    if (!command) {
      throw new Error("请输入命令");
    }

    const child = spawn(command, {
      cwd: input.cwd,
      shell: true,
      env: { ...process.env, TERM: "dumb", NO_COLOR: "1" },
    });
    this.children.set(taskId, child);

    let size = 0;
    const write = (buf: Buffer): void => {
      let text = buf.toString("utf8");
      if (size >= TERM_MAX_OUTPUT) return;
      if (size + text.length > TERM_MAX_OUTPUT) {
        text = `${text.slice(0, TERM_MAX_OUTPUT - size)}\n…输出过长，已截断。\n`;
        this.stop(taskId, "SIGTERM");
      }
      size += text.length;
      input.onChunk(text);
    };

    child.stdout?.on("data", write);
    child.stderr?.on("data", write);
    child.on("error", (error) => {
      input.onChunk(`${error.message}\n`);
    });

    const timeoutMs = input.timeoutMs ?? TERM_TIMEOUT_MS;
    const timer = setTimeout(() => this.stop(taskId, "SIGTERM"), timeoutMs);

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      this.children.delete(taskId);
      input.onExit(code, signal ?? null);
    });
  }

  interrupt(taskId: string): boolean {
    const terminal = this.terminals.get(taskId);
    if (terminal) {
      terminal.write("\u0003");
      return true;
    }
    return this.stop(taskId, process.platform === "win32" ? undefined : "SIGINT");
  }

  dispose(taskId: string): void {
    this.stop(taskId, "SIGTERM");
  }

  disposeAll(): void {
    for (const taskId of new Set([...this.children.keys(), ...this.terminals.keys()])) this.dispose(taskId);
  }

  private stop(taskId: string, signal?: NodeJS.Signals): boolean {
    const terminal = this.terminals.get(taskId);
    if (terminal) {
      terminal.kill(signal);
      this.terminals.delete(taskId);
      return true;
    }
    const child = this.children.get(taskId);
    if (!child) return false;
    child.kill(signal);
    return true;
  }
}

const require = createRequire(import.meta.url);
const nodePty = loadNodePty();
let ptyHelperChecked = false;

function loadNodePty(): typeof import("node-pty") {
  try {
    return require("node-pty") as typeof import("node-pty");
  } catch {
    const localEntry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "pty-runtime", "lib", "index.js");
    return require(localEntry) as typeof import("node-pty");
  }
}

function ensurePtyHelperExecutable(): void {
  if (ptyHelperChecked || process.platform === "win32") return;
  ptyHelperChecked = true;
  try {
    const entry = (() => {
      try {
        return require.resolve("node-pty");
      } catch {
        return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "pty-runtime", "lib", "index.js");
      }
    })();
    const packageDir = path.resolve(path.dirname(entry), "..");
    const helper = path.join(packageDir, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper");
    chmodSync(helper, 0o755);
  } catch {
    // node-pty reports a useful error if the helper is unavailable.
  }
}

function clampDimension(value: number): number {
  return Math.max(20, Math.min(500, Math.round(Number.isFinite(value) ? value : 80)));
}

function resolveInteractiveShell(): string {
  if (process.platform === "win32") return process.env.ComSpec || "powershell.exe";
  const candidates = ["/bin/zsh", "/usr/bin/zsh", process.env.SHELL].filter(
    (value): value is string => Boolean(value && existsSync(value)),
  );
  return candidates[0] ?? "/bin/sh";
}

function interactiveShellArgs(shell: string): string[] {
  if (process.platform === "win32") return [];
  return shell.endsWith("/zsh") ? ["-l"] : ["-i"];
}
