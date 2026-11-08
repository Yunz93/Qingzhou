import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { redactWorkflowLog } from "./workflow-git.js";

export type WorkflowCommandResult = { exitCode: number | null; output: string; truncated: boolean };

/** Process lifetime and output only; verification facts belong to WorkflowService. */
export class WorkflowCommandRunner {
  private readonly children = new Set<ChildProcess>();
  private disposed = false;
  constructor(private readonly dataDir: string) {}

  run(command: string, cwd: string, timeoutMs: number, verificationId: string): Promise<WorkflowCommandResult> {
    if (this.disposed) return Promise.resolve({ exitCode: null, output: "应用退出，验证中断。", truncated: false });
    return new Promise((resolve) => {
      const temp = path.join(this.dataDir, "check-env", verificationId);
      const child = spawn(command, [], { cwd, shell: true, detached: process.platform !== "win32", windowsHide: true,
        env: { ...process.env, QINGZHOU_VERIFICATION_ID: verificationId, QINGZHOU_WORKSPACE: cwd, TMPDIR: temp, TMP: temp, TEMP: temp } });
      this.children.add(child);
      let output = "";
      let truncated = false;
      let timedOut = false;
      const append = (value: Buffer | string) => {
        const text = String(value);
        const remaining = 256_000 - output.length;
        if (text.length > remaining) truncated = true;
        if (remaining > 0) output += text.slice(0, remaining);
      };
      child.stdout?.on("data", append);
      child.stderr?.on("data", append);
      child.once("error", error => append(error.message));
      const timer = setTimeout(() => { timedOut = true; this.kill(child); }, timeoutMs);
      child.once("close", code => {
        clearTimeout(timer);
        this.children.delete(child);
        resolve({ exitCode: timedOut ? null : code, output: redactWorkflowLog(output + (timedOut ? "\n检查超时，进程已停止。" : "")), truncated });
      });
    });
  }

  dispose(): void {
    this.disposed = true;
    for (const child of this.children) this.kill(child);
  }

  private kill(child: ChildProcess): void {
    try {
      if (process.platform === "win32") {
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
        killer.on("error", () => child.kill());
      } else if (child.pid) process.kill(-child.pid, "SIGKILL");
    } catch { child.kill("SIGKILL"); }
  }
}
