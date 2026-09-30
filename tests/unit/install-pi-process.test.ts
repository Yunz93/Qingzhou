import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { resetInstallPiLock, runOfficialPiInstall } from "../../apps/server/src/setup/install-pi.ts";

vi.mock("node:child_process", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  spawn: vi.fn(),
}));

function child(pid: number) {
  return Object.assign(new EventEmitter(), {
    pid, stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(),
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  resetInstallPiLock();
});

it("kills the Windows installer process tree and waits for termination on timeout", async () => {
  vi.stubGlobal("process", new Proxy(process, {
    get: (target, key) => key === "platform" ? "win32" : Reflect.get(target, key),
  }));
  vi.useFakeTimers();
  const installer = child(42);
  const killer = child(43);
  vi.mocked(spawn).mockReturnValueOnce(installer as never).mockReturnValueOnce(killer as never);
  let settled = false;
  const result = runOfficialPiInstall({ homeDir: ".", platform: "win32", env: {}, timeoutMs: 10 })
    .then(() => "unexpected success", (error: Error) => error.message)
    .finally(() => { settled = true; });
  await vi.advanceTimersByTimeAsync(10);
  expect(spawn).toHaveBeenNthCalledWith(2, "taskkill", ["/PID", "42", "/T", "/F"], {
    stdio: "ignore", windowsHide: true,
  });
  installer.emit("close", 1);
  await Promise.resolve();
  expect(settled).toBe(false);
  killer.emit("close", 0);
  expect(await result).toMatch(/安装 Pi 超时/);
});

it.each(["nonzero exit", "spawn error"])("blocks retries if process-tree termination fails with %s", async (failure) => {
  vi.stubGlobal("process", new Proxy(process, {
    get: (target, key) => key === "platform" ? "win32" : Reflect.get(target, key),
  }));
  vi.useFakeTimers();
  const installer = child(42);
  const killer = child(43);
  vi.mocked(spawn).mockReturnValueOnce(installer as never).mockReturnValueOnce(killer as never);
  const run = () => runOfficialPiInstall({ homeDir: ".", platform: "win32", env: {}, timeoutMs: 10 })
    .then(() => "unexpected success", (error: Error) => error.message);
  const first = run();
  await vi.advanceTimersByTimeAsync(10);
  if (failure === "spawn error") killer.emit("error", new Error("taskkill unavailable"));
  else killer.emit("close", 1);
  expect(await first).toMatch(/无法终止安装进程 42/);
  expect(await run()).toBe(await first);
  expect(spawn).toHaveBeenCalledTimes(2);
});
