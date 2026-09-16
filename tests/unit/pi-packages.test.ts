import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  addPackageSources,
  ensureMcpServer,
  formatPiInstallError,
  installPiPackages,
  piCliInstallArgs,
  runPiCliInstall,
  shouldRunPiCliInstall,
} from "../../apps/server/src/tasks/pi-packages.ts";

describe("pi package install", () => {
  it("skips the Pi CLI in tests", () => {
    expect(shouldRunPiCliInstall({ VITEST: "true" })).toBe(false);
    expect(shouldRunPiCliInstall({ QINGZHOU_E2E: "1" })).toBe(false);
    expect(shouldRunPiCliInstall({ QINGZHOU_SKIP_PI_PACKAGE_INSTALL: "1" })).toBe(false);
    expect(shouldRunPiCliInstall({})).toBe(true);
  });

  it("appends missing package sources and leaves existing ones", async () => {
    const agentDir = await mkdtemp(path.join(os.tmpdir(), "qingzhou-pkg-"));
    await mkdir(agentDir, { recursive: true });
    const first = await addPackageSources(agentDir, ["npm:pi-web-access", "pi-memory"]);
    expect(first.added).toEqual(["npm:pi-web-access", "npm:pi-memory"]);
    const second = await addPackageSources(agentDir, ["pi-web-access", "npm:pi-subagents"]);
    expect(second.added).toEqual(["npm:pi-subagents"]);
    expect(second.already).toEqual(["npm:pi-web-access"]);
    const settings = JSON.parse(await readFile(path.join(agentDir, "settings.json"), "utf8")) as {
      packages: string[];
    };
    expect(settings.packages).toEqual(["npm:pi-web-access", "npm:pi-memory", "npm:pi-subagents"]);
  });

  it("creates an MCP server entry once", async () => {
    const agentDir = await mkdtemp(path.join(os.tmpdir(), "qingzhou-mcp-"));
    const created = await ensureMcpServer(agentDir, {
      name: "context-mode",
      command: "npx",
      args: ["-y", "context-mode"],
    });
    const skipped = await ensureMcpServer(agentDir, {
      name: "context-mode",
      command: "context-mode",
    });
    expect(created).toBe(true);
    expect(skipped).toBe(false);
    const mcp = JSON.parse(await readFile(path.join(agentDir, "mcp.json"), "utf8")) as {
      mcpServers: Record<string, { command: string; args?: string[] }>;
    };
    expect(mcp.mcpServers["context-mode"]).toEqual({
      command: "npx",
      args: ["-y", "context-mode"],
    });
  });

  it("installs missing sources into settings without calling the Pi CLI", async () => {
    const agentDir = await mkdtemp(path.join(os.tmpdir(), "qingzhou-pkg-install-"));
    const result = await installPiPackages({
      agentDir,
      sources: ["pi-web-access", "npm:pi-memory"],
      packages: [],
      extensions: [],
      piCommand: "pi",
      prefixArgs: [],
      runCli: false,
    });
    expect(result.installed).toEqual(["npm:pi-web-access", "npm:pi-memory"]);
    expect(result.addedSources).toEqual(["npm:pi-web-access", "npm:pi-memory"]);
    const again = await installPiPackages({
      agentDir,
      sources: ["pi-web-access", "npm:pi-memory"],
      packages: result.addedSources.map((source) => ({ source })),
      extensions: [],
      piCommand: "pi",
      prefixArgs: [],
      runCli: false,
    });
    expect(again.installed).toEqual([]);
    expect(again.already).toEqual(["npm:pi-web-access", "npm:pi-memory"]);
    const loaded = await installPiPackages({
      agentDir,
      sources: ["pi-web-access", "npm:pi-memory"],
      packages: result.addedSources.map((source) => ({ source })),
      extensions: [{ name: "pi-web-access" }, { name: "pi-memory" }],
      piCommand: "pi",
      prefixArgs: [],
      runCli: false,
    });
    expect(loaded.installed).toEqual([]);
    expect(loaded.already).toEqual(["npm:pi-web-access", "npm:pi-memory"]);
    const settings = JSON.parse(await readFile(path.join(agentDir, "settings.json"), "utf8")) as {
      packages: string[];
    };
    expect(settings.packages).toEqual(["npm:pi-web-access", "npm:pi-memory"]);
  });

  it("turns npm EACCES plus a Pi source dump into a short Chinese error", () => {
    const error = Object.assign(
      new Error("Command failed: pi install npm:pi-web-access"),
      {
        stderr: [
          "npm error code EACCES",
          "npm error path /Users/yunz/.npm/_cacache/index-v5/ab/cd",
          "npm error Your cache folder contains root-owned files",
          'npm error   sudo chown -R 501:20 "/Users/yunz/.npm"',
          "file:///Users/yunz/.npm-global/lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/chunks/chunk.js:1",
          "getNpmInstallRoot(){" + "x".repeat(2000),
        ].join("\n"),
      },
    );
    const message = formatPiInstallError(error);
    expect(message).toMatch(/插件下载失败/);
    expect(message).not.toMatch(/已写入 Pi 设置/);
    expect(message).toMatch(/npm 缓存/);
    expect(message).not.toMatch(/getNpmInstallRoot/);
    expect(message.length).toBeLessThan(600);
  });

  it("treats settings packages as already installed and only rolls back newly added sources", async () => {
    const agentDir = await mkdtemp(path.join(os.tmpdir(), "qingzhou-pkg-fail-"));
    await addPackageSources(agentDir, ["npm:pi-web-access"]);
    const result = await installPiPackages({
      agentDir,
      sources: ["npm:pi-web-access", "npm:pi-memory"],
      packages: [{ source: "npm:pi-web-access" }],
      extensions: [],
      piCommand: process.execPath,
      prefixArgs: [
        "-e",
        "process.stderr.write('npm error code EACCES\\nnpm error path /Users/yunz/.npm/_cacache\\n'); process.exit(1);",
      ],
      runCli: true,
    });
    expect(result.already).toEqual(["npm:pi-web-access"]);
    expect(result.installed).toEqual(["npm:pi-memory"]);
    expect(result.piInstallError).toMatch(/插件下载失败/);
    expect(result.piInstallError).toMatch(/npm 缓存/);
    const settings = JSON.parse(await readFile(path.join(agentDir, "settings.json"), "utf8")) as {
      packages?: string[];
    };
    expect(settings.packages ?? []).toEqual(["npm:pi-web-access"]);
  });

  it("runs pi install once per source because the CLI only accepts one", async () => {
    expect(piCliInstallArgs(["cli.js"], "npm:pi-web-access")).toEqual(["cli.js", "install", "npm:pi-web-access"]);
    expect(piCliInstallArgs(["cli.js"], "npm:pi-memory")).toEqual(["cli.js", "install", "npm:pi-memory"]);
    const dir = await mkdtemp(path.join(os.tmpdir(), "qingzhou-pi-install-"));
    const log = path.join(dir, "calls.txt");
    const script = path.join(dir, "fake-pi-install.mjs");
    await writeFile(
      script,
      [
        "import { appendFileSync } from 'node:fs';",
        "const install = process.argv.indexOf('install');",
        "const sources = install >= 0 ? process.argv.slice(install + 1) : [];",
        "if (sources.length !== 1) {",
        "  process.stderr.write('Unexpected argument ' + (sources[1] ?? '') + '\\n');",
        "  process.stderr.write('Usage: pi install <source> [-l] [--approve|--no-approve]\\n');",
        "  process.exit(1);",
        "}",
        "appendFileSync(process.env.QINGZHOU_INSTALL_LOG, sources[0] + '\\n');",
      ].join("\n"),
    );
    await runPiCliInstall({
      piCommand: process.execPath,
      prefixArgs: [script],
      sources: ["npm:pi-web-access", "npm:pi-memory"],
      env: { QINGZHOU_INSTALL_LOG: log },
    });
    expect(await readFile(log, "utf8")).toBe("npm:pi-web-access\nnpm:pi-memory\n");
  });
});
