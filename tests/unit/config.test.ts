import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  asNodeEnv,
  defaultAllowedRoots,
  defaultDataDir,
  envWithElectronAsNode,
  expandHome,
  isAllowedHost,
  isAllowedOrigin,
  isMacosElectronHelperPath,
  loadConfig,
  parseAllowedRoots,
  readPiVersion,
  resolveElectronNodeBin,
  resolvePiRuntime,
} from "../../apps/server/src/config.ts";
import { loadDotEnv } from "../../apps/server/src/env.ts";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";

describe("portable config", () => {
  it("defaults data dir and roots to the home directory", () => {
    const home = path.resolve(os.tmpdir(), "qingzhou-home-test");
    expect(defaultDataDir(home)).toBe(path.join(home, ".qingzhou"));
    expect(defaultAllowedRoots(home)).toEqual([home]);
    const config = loadConfig({}, { homeDir: home });
    expect(config.dataDir).toBe(path.join(home, ".qingzhou"));
    expect(config.allowedRoots).toEqual([home]);
  });

  it("keeps home allowed after a workspace is chosen", () => {
    const home = path.resolve(os.tmpdir(), "qingzhou-home-with-workspace");
    const workspace = path.join(home, "Projects", "app");
    const config = loadConfig({}, { homeDir: home, workspaceRoot: workspace });
    expect(config.allowedRoots).toEqual([workspace, home]);
  });

  it("does not add home when ALLOWED_ROOTS is set", () => {
    const home = path.resolve(os.tmpdir(), "qingzhou-home-jail");
    const config = loadConfig({ QINGZHOU_ALLOWED_ROOTS: "/only-this" }, { homeDir: home, workspaceRoot: "/work" });
    expect(config.allowedRoots).toEqual([path.resolve("/only-this")]);
  });

  it("keeps using a legacy ~/.mowen data dir when it already exists", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "qingzhou-mowen-"));
    const legacy = path.join(home, ".mowen");
    await mkdir(legacy);
    expect(defaultDataDir(home)).toBe(legacy);
    const config = loadConfig({}, { homeDir: home });
    expect(config.dataDir).toBe(legacy);
    await rm(home, { recursive: true, force: true });
  });

  it("keeps using a legacy ~/.ohmypi data dir when it already exists", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "qingzhou-ohmypi-"));
    const legacy = path.join(home, ".ohmypi");
    await mkdir(legacy);
    expect(defaultDataDir(home)).toBe(legacy);
    const config = loadConfig({}, { homeDir: home });
    expect(config.dataDir).toBe(legacy);
    await rm(home, { recursive: true, force: true });
  });

  it("keeps using a legacy ~/.mypi-web data dir when it already exists", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "qingzhou-legacy-"));
    const legacy = path.join(home, ".mypi-web");
    await mkdir(legacy);
    expect(defaultDataDir(home)).toBe(legacy);
    const config = loadConfig({}, { homeDir: home });
    expect(config.dataDir).toBe(legacy);
    await rm(home, { recursive: true, force: true });
  });

  it("expands ~ in paths", () => {
    const home = os.homedir();
    expect(expandHome("~", home)).toBe(home);
    expect(expandHome("~/Projects", home)).toBe(path.join(home, "Projects"));
  });

  it("uses explicit roots when provided", () => {
    expect(parseAllowedRoots("/a,/b")).toEqual(["/a", "/b"]);
  });

  it("loads .env without overriding existing env", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "qingzhou-env-"));
    const file = path.join(dir, ".env");
    await writeFile(file, "QINGZHOU_TEST_UNIQUE=from-file\nHOST=should-not-win\n");
    process.env.HOST = "already-set";
    delete process.env.QINGZHOU_TEST_UNIQUE;
    loadDotEnv(file);
    expect(process.env.QINGZHOU_TEST_UNIQUE).toBe("from-file");
    expect(process.env.HOST).toBe("already-set");
    delete process.env.QINGZHOU_TEST_UNIQUE;
    await rm(dir, { recursive: true, force: true });
  });

  it("still reads MOWEN_* environment variables", () => {
    const home = path.resolve(os.tmpdir(), "qingzhou-mowen-env-home");
    const config = loadConfig(
      {
        MOWEN_DATA_DIR: path.join(home, "old-mowen-data"),
        MOWEN_ALLOWED_ROOTS: "/old-mowen-root",
        MOWEN_MAX_PROCESSES: "5",
      },
      { homeDir: home },
    );
    expect(config.dataDir).toBe(path.join(home, "old-mowen-data"));
    expect(config.allowedRoots).toEqual([path.resolve("/old-mowen-root")]);
    expect(config.maxProcesses).toBe(5);
  });

  it("still reads OHMYPI_* environment variables", () => {
    const home = path.resolve(os.tmpdir(), "qingzhou-legacy-env-home");
    const config = loadConfig(
      {
        OHMYPI_DATA_DIR: path.join(home, "old-data"),
        OHMYPI_ALLOWED_ROOTS: "/old-root",
        OHMYPI_MAX_PROCESSES: "7",
      },
      { homeDir: home },
    );
    expect(config.dataDir).toBe(path.join(home, "old-data"));
    expect(config.allowedRoots).toEqual([path.resolve("/old-root")]);
    expect(config.maxProcesses).toBe(7);
  });

  it("resolves a relative QINGZHOU_HOME_DIR against the process cwd", () => {
    const config = loadConfig({ QINGZHOU_HOME_DIR: "./.relative-qingzhou-home" });
    expect(config.homeDir).toBe(path.resolve("./.relative-qingzhou-home"));
  });

  it("launches bundled Pi via node entry", () => {
    const entry = path.resolve(os.tmpdir(), "pi-cli.js");
    const runtime = resolvePiRuntime({
      QINGZHOU_PI_ENTRY: entry,
      QINGZHOU_NODE_BIN: process.execPath,
    });
    expect(runtime.command).toBe(process.execPath);
    expect(runtime.prefixArgs[0]).toBe(entry);
    expect(runtime.extraEnv.ELECTRON_RUN_AS_NODE).toBe("1");
  });

  it("launches a JavaScript PI_BIN via the current node executable", () => {
    const script = path.resolve(os.tmpdir(), "fake-pi.mjs");
    const runtime = resolvePiRuntime({ PI_BIN: script });
    expect(runtime.command).toBe(process.execPath);
    expect(runtime.prefixArgs).toEqual([script]);
    expect(runtime.extraEnv.ELECTRON_RUN_AS_NODE).toBe("1");
  });

  it("launches the CLI behind an npm Pi shim without spawning a batch file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qingzhou-npm-shim-"));
    try {
      const shim = path.join(root, "pi.cmd");
      const entry = path.join(root, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
      await mkdir(path.dirname(entry), { recursive: true });
      await writeFile(entry, "console.log('0.0.0-test');");
      await writeFile(shim, "@echo off\r\n");
      const runtime = resolvePiRuntime({ PI_BIN: shim });
      expect(runtime.command).toBe(resolveElectronNodeBin(process.execPath));
      expect(runtime.prefixArgs).toEqual([entry]);
      const custom = path.join(root, "custom-agent.cmd");
      await writeFile(custom, "@echo off\r\n");
      expect(resolvePiRuntime({ PI_BIN: custom })).toEqual({ command: custom, prefixArgs: [], extraEnv: {} });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("marks the current executable as a Node interpreter", () => {
    expect(asNodeEnv(process.execPath).ELECTRON_RUN_AS_NODE).toBe("1");
    expect(asNodeEnv("/usr/bin/pi").ELECTRON_RUN_AS_NODE).toBeUndefined();
  });

  it("keeps ELECTRON_RUN_AS_NODE on even if an env layer clears it", () => {
    expect(
      envWithElectronAsNode(process.execPath, { ELECTRON_RUN_AS_NODE: "", PATH: "/bin" }).ELECTRON_RUN_AS_NODE,
    ).toBe("1");
  });

  it("spawns the macOS Electron Helper so Pi does not take a Dock slot", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qingzhou-helper-"));
    const macos = path.join(root, "Qingzhou.app", "Contents", "MacOS");
    const helperDir = path.join(
      root,
      "Qingzhou.app",
      "Contents",
      "Frameworks",
      "Qingzhou Helper.app",
      "Contents",
      "MacOS",
    );
    await mkdir(macos, { recursive: true });
    await mkdir(helperDir, { recursive: true });
    const execPath = path.join(macos, "Qingzhou");
    const helper = path.join(helperDir, "Qingzhou Helper");
    await writeFile(execPath, "");
    await writeFile(helper, "");
    expect(resolveElectronNodeBin(execPath, "linux")).toBe(execPath);
    expect(resolveElectronNodeBin(execPath, "darwin")).toBe(helper);
    expect(isMacosElectronHelperPath(helper)).toBe(true);
    expect(asNodeEnv(helper).ELECTRON_RUN_AS_NODE).toBe("1");
    expect(resolveElectronNodeBin("/usr/bin/pi", "darwin")).toBe("/usr/bin/pi");
  });

  it("reads bundled Pi version from package.json without spawning", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qingzhou-pi-pkg-"));
    const dist = path.join(root, "dist");
    await mkdir(dist);
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "9.9.9" }));
    const cli = path.join(dist, "cli.js");
    await writeFile(cli, "throw new Error('should not spawn');\n");
    const result = await readPiVersion({
      piCommand: path.join(root, "missing-electron"),
      piPrefixArgs: [cli],
      piExtraEnv: {},
    });
    expect(result).toEqual({ version: "9.9.9", error: null });
    await rm(root, { recursive: true, force: true });
  });

  it("accepts loopback Host headers and rejects DNS-rebinding hosts", () => {
    expect(isAllowedHost("127.0.0.1:4310")).toBe(true);
    expect(isAllowedHost("localhost:5173")).toBe(true);
    expect(isAllowedHost("[::1]:4310")).toBe(true);
    expect(isAllowedHost("evil.example:4310")).toBe(false);
    expect(isAllowedHost("evil.example:4310", "0.0.0.0")).toBe(false);
    expect(isAllowedHost("10.0.0.8:4310", "10.0.0.8")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:5173", [], "127.0.0.1")).toBe(true);
    expect(isAllowedOrigin("https://evil.example", ["http://127.0.0.1:4310"], "127.0.0.1")).toBe(false);
  });
});
