import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { envWithElectronAsNode, isJavaScriptFile, resolveElectronNodeBin } from "../config.js";
import { attachJsonlLineReader, serializeJsonLine } from "./rpc-framer.js";
import { redactSecrets } from "../security/redact.js";

export type RpcCommand = Record<string, unknown> & { type: string; id?: string };

export type RpcResponse = {
  id?: string;
  type: "response";
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
};

export type RpcEvent = Record<string, unknown> & { type: string };

type Pending = {
  resolve: (value: RpcResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const STDERR_MAX = 200_000;

export type RpcClientOptions = {
  bin: string;
  args: string[];
  prefixArgs?: string[];
  extraEnv?: NodeJS.ProcessEnv;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  responseTimeoutMs?: number;
  onEvent?: (event: RpcEvent) => void;
  onStderr?: (chunk: string) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
};

export class RpcClient {
  private process: ChildProcessWithoutNullStreams | null = null;
  private stopReading: (() => void) | null = null;
  private pending = new Map<string, Pending>();
  private requestId = 0;
  private stderr = "";
  private warnedBadJson = false;
  private exitError: Error | null = null;
  private readonly options: RpcClientOptions;

  constructor(options: RpcClientOptions) {
    this.options = options;
  }

  getStderr(): string {
    return this.stderr;
  }

  async start(): Promise<void> {
    if (this.process) {
      throw new Error("RPC client already started");
    }
    let command = this.options.bin;
    let argv = [...(this.options.prefixArgs ?? []), ...this.options.args];
    if (isJavaScriptFile(command)) {
      argv = [command, ...argv];
      command = process.execPath;
    }
    command = resolveElectronNodeBin(command);
    const child = spawn(command, argv, {
      cwd: this.options.cwd,
      env: envWithElectronAsNode(command, process.env, this.options.extraEnv, this.options.env),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.process = child;

    child.stderr.on("data", (data: Buffer) => {
      const raw = data.toString("utf8");
      const redacted = redactSecrets(raw);
      this.stderr += redacted;
      if (this.stderr.length > STDERR_MAX) this.stderr = this.stderr.slice(this.stderr.length - STDERR_MAX);
      this.options.onStderr?.(redacted);
    });

    child.once("exit", (code, signal) => {
      if (this.process !== child) return;
      const error = new Error(
        `Pi process exited (code=${code} signal=${signal}). Stderr: ${this.stderr}`,
      );
      this.exitError = error;
      this.rejectPending(error);
      this.options.onExit?.(code, signal);
    });

    child.once("error", (error) => {
      if (this.process !== child) return;
      const wrapped = new Error(`Pi process error: ${error.message}. Stderr: ${this.stderr}`);
      this.exitError = wrapped;
      this.rejectPending(wrapped);
      this.options.onExit?.(null, null);
    });

    this.stopReading = attachJsonlLineReader(child.stdout, (line) => {
      this.handleLine(line);
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    if (child.exitCode !== null) {
      throw this.exitError ?? new Error(`Pi exited immediately. Stderr: ${this.stderr}`);
    }
  }

  async stop(signal: NodeJS.Signals = "SIGTERM"): Promise<void> {
    const child = this.process;
    if (!child) return;
    this.stopReading?.();
    this.stopReading = null;
    if (!child.killed) {
      child.kill(signal);
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
        resolve();
      }, 1500);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    this.process = null;
    this.pending.clear();
  }

  async send(command: RpcCommand, timeoutMs?: number): Promise<RpcResponse> {
    const child = this.process;
    const stdin = child?.stdin;
    if (!child || !stdin) {
      throw new Error("RPC client not started");
    }
    if (this.exitError) {
      throw this.exitError;
    }
    const id = command.id ?? `req_${++this.requestId}`;
    const payload = { ...command, id };
    return new Promise<RpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout waiting for ${command.type}. Stderr: ${this.stderr}`));
      }, timeoutMs ?? this.options.responseTimeoutMs ?? 30_000);
      this.pending.set(id, { resolve, reject, timer });
      void this.writeLine(stdin, serializeJsonLine(payload)).catch((error) => {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  sendUiResponse(body: Record<string, unknown>): void {
    const stdin = this.process?.stdin;
    if (!stdin) {
      throw new Error("RPC client not started");
    }
    void this.writeLine(stdin, serializeJsonLine({ type: "extension_ui_response", ...body }));
  }

  /** Respect stdin backpressure instead of unbounded buffering. */
  private writeLine(stdin: NodeJS.WritableStream, line: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        const ok = stdin.write(line, (error) => {
          if (error) reject(error);
        });
        if (ok) {
          resolve();
          return;
        }
        const onDrain = () => {
          stdin.off("error", onError);
          resolve();
        };
        const onError = (error: Error) => {
          stdin.off("drain", onDrain);
          reject(error);
        };
        stdin.once("drain", onDrain);
        stdin.once("error", onError);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    let data: RpcEvent;
    try {
      data = JSON.parse(line) as RpcEvent;
    } catch {
      if (line.trim().startsWith("{") && !this.warnedBadJson) {
        this.warnedBadJson = true;
        this.options.onEvent?.({
          type: "error",
          error: "Pi 输出了无法解析的数据，部分事件可能丢失。",
        });
      }
      console.warn("[qingzhou] dropped malformed Pi JSON line");
      return;
    }
    if (data.type === "response") {
      const response = data as RpcResponse;
      if (response.id && this.pending.has(response.id)) {
        const pending = this.pending.get(response.id);
        this.pending.delete(response.id);
        if (pending) {
          clearTimeout(pending.timer);
          pending.resolve(response);
        }
        return;
      }
    }
    this.options.onEvent?.(data);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
