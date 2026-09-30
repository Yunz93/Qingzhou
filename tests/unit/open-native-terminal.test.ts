import path from "node:path";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  loginZsh,
  nativeTerminalSpec,
  openNativeTerminal,
} from "../../apps/server/src/tasks/open-native-terminal.ts";

describe("native terminal launch", () => {
  it("opens Terminal.app at the folder on macOS", () => {
    expect(nativeTerminalSpec("/tmp/proj", { platform: "darwin" })).toEqual({
      cmd: "open",
      args: ["-a", "Terminal", path.resolve("/tmp/proj")],
    });
  });

  it("runs zsh -l in a terminal emulator on Linux", () => {
    expect(
      nativeTerminalSpec("/tmp/proj", {
        platform: "linux",
        env: { SHELL: "/bin/zsh", TERMINAL: "kitty" },
      }),
    ).toEqual({
      cmd: "kitty",
      args: ["-e", "/bin/zsh", "-l"],
      cwd: path.resolve("/tmp/proj"),
    });
  });

  it("falls back to x-terminal-emulator and zsh", () => {
    expect(loginZsh({ SHELL: "/bin/bash" })).toBe("zsh");
    expect(nativeTerminalSpec("/tmp/proj", { platform: "linux", env: {} })).toEqual({
      cmd: "x-terminal-emulator",
      args: ["-e", "zsh", "-l"],
      cwd: path.resolve("/tmp/proj"),
    });
  });

  it("opens Windows Terminal at the folder", () => {
    expect(nativeTerminalSpec("/tmp/proj", { platform: "win32" })).toEqual({
      cmd: "cmd.exe",
      args: ["/c", "start", "wt.exe", "-d", path.resolve("/tmp/proj")],
    });
  });

  it("rejects an empty cwd", () => {
    expect(() => nativeTerminalSpec("  ")).toThrow(/工作文件夹无效/);
  });

  it("resolves after the process spawns", async () => {
    const child = new EventEmitter() as EventEmitter & { unref: () => void };
    child.unref = vi.fn();
    const spawn = vi.fn(() => child);
    const pending = openNativeTerminal("/tmp/proj", {
      platform: "darwin",
      spawn: spawn as never,
    });
    child.emit("spawn");
    await pending;
    expect(spawn).toHaveBeenCalledWith("open", ["-a", "Terminal", path.resolve("/tmp/proj")], {
      cwd: undefined,
      stdio: "ignore",
      detached: true,
    });
    expect(child.unref).toHaveBeenCalled();
  });
});
