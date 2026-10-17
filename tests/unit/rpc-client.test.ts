import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RpcClient } from "../../apps/server/src/pi/rpc-client.ts";

const fakePi = fileURLToPath(new URL("../fixtures/fake-pi.mjs", import.meta.url));

describe("rpc client correlation", () => {
  it("resolves responses by request id", async () => {
    const client = new RpcClient({
      bin: fakePi,
      args: ["--mode", "rpc", "--no-session"],
      cwd: process.cwd(),
    });
    await client.start();
    const first = client.send({ type: "get_state", id: "one" });
    const second = client.send({ type: "get_available_models", id: "two" });
    const [a, b] = await Promise.all([first, second]);
    expect(a.id).toBe("one");
    expect(a.success).toBe(true);
    expect(b.id).toBe("two");
    expect(b.command).toBe("get_available_models");
    await client.stop();
  });

  it("runs Electron as Node and prefers the macOS Helper binary so Dock stays clean", () => {
    const src = readFileSync(path.resolve("apps/server/src/pi/rpc-client.ts"), "utf8");
    expect(src).toContain("resolveElectronNodeBin(command)");
    expect(src).toContain("envWithElectronAsNode(");
    expect(src).toContain("windowsHide: true");
  });

  it.skipIf(process.platform === "win32")("waits for forced exit when Pi ignores SIGTERM", async () => {
    let ready!: (pid: number) => void;
    const started = new Promise<number>((resolve) => { ready = resolve; });
    let exitSignal: string | null = null;
    const client = new RpcClient({
      bin: process.execPath,
      args: [fileURLToPath(new URL("../fixtures/signal-resistant-pi.mjs", import.meta.url))],
      cwd: process.cwd(),
      onEvent: (event) => { if (event.type === "ready") ready(Number(event.pid)); },
      onExit: (_code, signal) => { exitSignal = signal; },
    });
    let pid: number | undefined;
    try {
      await client.start();
      pid = await started;
      await client.stop();
      expect(exitSignal).toBe("SIGKILL");
      expect(() => process.kill(pid!, 0)).toThrow();
    } finally {
      if (pid) {
        try { process.kill(pid, "SIGKILL"); } catch { /* Already exited. */ }
      }
      await client.stop("SIGKILL");
    }
  });

  it("does not wait for the termination timeout after Pi has already exited", async () => {
    let exited!: () => void;
    const exit = new Promise<void>((resolve) => { exited = resolve; });
    const client = new RpcClient({
      bin: process.execPath,
      args: ["-e", "setTimeout(() => process.exit(0), 100)"],
      cwd: process.cwd(),
      onExit: () => exited(),
    });
    await client.start();
    await exit;
    const start = Date.now();
    await client.stop();
    expect(Date.now() - start).toBeLessThan(500);
  });
});
