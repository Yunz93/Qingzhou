import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyPiBinToEnv,
  assertInstallScriptUrl,
  candidatePiPaths,
  DEFAULT_PI_INSTALL_SCRIPT_URL,
  DEFAULT_PI_NPM_LATEST_URL,
  discoverPiExecutable,
  fetchLatestPiVersion,
  InstallPiError,
  isPiUpdateAvailable,
  parsePiVersion,
  PI_NPM_PACKAGE,
  piInstallScriptUrl,
  piNpmLatestUrl,
  prependPath,
  resetInstallPiLock,
  runOfficialPiInstall,
  stripInstallerLog,
  unixInstallChildEnv,
  windowsNpmInstallArgs,
} from "../../apps/server/src/setup/install-pi.ts";

describe("official Pi installer helpers", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    resetInstallPiLock();
    for (const dir of dirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("uses the official script URL and npm package", () => {
    expect(DEFAULT_PI_INSTALL_SCRIPT_URL).toBe("https://pi.dev/install.sh");
    expect(windowsNpmInstallArgs()).toEqual([
      "install",
      "-g",
      "--ignore-scripts",
      "--min-release-age=0",
      "--no-fund",
      "--no-audit",
      "--progress=false",
      PI_NPM_PACKAGE,
    ]);
    expect(piInstallScriptUrl({ QINGZHOU_PI_INSTALL_SCRIPT_URL: "http://127.0.0.1:9/install.sh" })).toBe(
      "http://127.0.0.1:9/install.sh",
    );
    expect(DEFAULT_PI_NPM_LATEST_URL).toContain(PI_NPM_PACKAGE);
    expect(piNpmLatestUrl({ QINGZHOU_PI_NPM_LATEST_URL: "http://127.0.0.1:9/latest.json" })).toBe(
      "http://127.0.0.1:9/latest.json",
    );
  });

  it("compares installed Pi versions against the latest", () => {
    expect(parsePiVersion("v0.30.2")).toEqual([0, 30, 2]);
    expect(parsePiVersion("0.0.0-fake")).toEqual([0, 0, 0]);
    expect(isPiUpdateAvailable("0.30.2", "0.30.2")).toBe(false);
    expect(isPiUpdateAvailable("0.31.0", "0.30.2")).toBe(true);
    expect(isPiUpdateAvailable("0.30.2", "0.31.0")).toBe(false);
    expect(isPiUpdateAvailable("0.30.2", "0.0.0-fake")).toBe(true);
    expect(isPiUpdateAvailable(null, "0.30.2")).toBe(false);
  });

  it("reads the latest Pi version from the npm registry payload", async () => {
    const result = await fetchLatestPiVersion({
      env: { QINGZHOU_PI_NPM_LATEST_URL: "http://127.0.0.1:9/latest.json" },
      fetchText: async (url) => {
        expect(url).toBe("http://127.0.0.1:9/latest.json");
        return JSON.stringify({ version: "0.40.1" });
      },
    });
    expect(result).toEqual({ version: "0.40.1", error: null });
    const bad = await fetchLatestPiVersion({
      env: { QINGZHOU_PI_NPM_LATEST_URL: "http://127.0.0.1:9/latest.json" },
      fetchText: async () => "not-json",
    });
    expect(bad.version).toBeNull();
    expect(bad.error).toMatch(/无法解析/);
  });

  it("rejects non-https remote script URLs and allows localhost http", () => {
    expect(() => assertInstallScriptUrl("https://pi.dev/install.sh")).not.toThrow();
    expect(() => assertInstallScriptUrl("http://127.0.0.1:4310/install.sh")).not.toThrow();
    expect(() => assertInstallScriptUrl("http://example.com/install.sh")).toThrow(InstallPiError);
    expect(() => assertInstallScriptUrl("not a url")).toThrow(InstallPiError);
  });

  it("runs the installer without a TTY and with TERM=dumb", () => {
    const env = unixInstallChildEnv({ PATH: "/usr/bin", HOME: "/tmp/old" }, "/tmp/qingzhou-home");
    expect(env.TERM).toBe("dumb");
    expect(env.CI).toBe("1");
    expect(env.HOME).toBe("/tmp/qingzhou-home");
  });

  it("discovers Pi under ~/.pi/agent/bin before the npm prefix", () => {
    expect(candidatePiPaths("/home/me", "/usr/local", "linux")[0]).toBe(path.join("/home/me", ".pi", "agent", "bin", "pi"));
    expect(candidatePiPaths("/home/me", "/usr/local", "linux")).toContain(path.join("/usr/local", "bin", "pi"));
    expect(candidatePiPaths("C:\\Users\\me", "C:\\npm", "win32")[0]).toBe(
      path.join("C:\\Users\\me", ".pi", "agent", "bin", "pi.cmd"),
    );
    expect(candidatePiPaths("C:\\Users\\me", "C:\\npm", "win32")).toContain(path.join("C:\\npm", "pi.cmd"));
  });

  it("prepends the discovered bin directory onto PATH", () => {
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };
    applyPiBinToEnv("/home/me/.pi/agent/bin/pi", env, "linux");
    expect(env.PI_BIN).toBe("/home/me/.pi/agent/bin/pi");
    expect(env.PATH).toBe("/home/me/.pi/agent/bin:/usr/bin:/bin");
    prependPath("/home/me/.pi/agent/bin", env, "linux");
    expect(env.PATH).toBe("/home/me/.pi/agent/bin:/usr/bin:/bin");
  });

  it("finds a writable Pi binary from candidate paths", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "qingzhou-pi-bin-"));
    dirs.push(home);
    const bin = path.join(home, ".pi", "agent", "bin", "pi");
    expect(
      await discoverPiExecutable({
        homeDir: home,
        npmPrefix: "/usr/local",
        exists: (file) => file === bin,
        platform: "linux",
      }),
    ).toBe(bin);
  });

  it("strips ANSI sequences from installer logs", () => {
    expect(stripInstallerLog("\u001B[1mPi\u001B[0m installed\r\n")).toBe("Pi installed");
  });

  it("downloads the official script and runs it with sh on unix", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "qingzhou-pi-run-"));
    dirs.push(home);
    const binDir = path.join(home, ".pi", "agent", "bin");
    const calls: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
    const result = await runOfficialPiInstall({
      homeDir: home,
      env: { PATH: process.env.PATH, QINGZHOU_PI_INSTALL_SCRIPT_URL: "https://pi.dev/install.sh" },
      platform: "linux",
      download: async (url) => {
        expect(url).toBe("https://pi.dev/install.sh");
        return "#!/bin/sh\necho installing\n";
      },
      runCommand: async (command, args, env) => {
        calls.push({ command, args, env });
        await mkdir(binDir, { recursive: true });
        await writeFile(path.join(binDir, "pi"), "#!/bin/sh\necho 0.0.0-test\n", { mode: 0o755 });
        return { code: 0, stdout: "No terminal detected; continuing without confirmation.\nPi was installed successfully.\n", stderr: "" };
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe("/bin/sh");
    expect(calls[0]?.args[0]).toMatch(/install\.sh$/);
    expect(calls[0]?.env.TERM).toBe("dumb");
    expect(calls[0]?.env.HOME).toBe(home);
    expect(calls[0]?.env.PATH?.split(":")).toContain("/bin");
    expect(result.ok).toBe(true);
    expect(result.bin).toBe(path.join(binDir, "pi"));
    expect(result.log).toContain("Pi was installed successfully");
  });

  it("uses npm install -g on Windows", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "qingzhou-pi-win-"));
    dirs.push(home);
    let command = "";
    let args: string[] = [];
    await runOfficialPiInstall({
      homeDir: home,
      env: { PATH: process.env.PATH },
      platform: "win32",
      download: async () => {
        throw new Error("Windows should not download install.sh");
      },
      runCommand: async (cmd, argv) => {
        command = cmd;
        args = argv;
        return { code: 0, stdout: "added 1 package", stderr: "" };
      },
    });
    expect(command).toBe("npm.cmd");
    expect(args).toEqual(windowsNpmInstallArgs());
  });

  it("serializes concurrent install attempts", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "qingzhou-pi-lock-"));
    dirs.push(home);
    let started = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = () =>
      runOfficialPiInstall({
        homeDir: home,
        platform: "linux",
        download: async () => "echo hi",
        runCommand: async () => {
          started += 1;
          await gate;
          return { code: 0, stdout: "ok", stderr: "" };
        },
      });
    const first = run();
    const second = run();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(started).toBe(1);
    release();
    await Promise.all([first, second]);
    expect(started).toBe(1);
  });

  it("surfaces a clear error when the installer exits non-zero", async () => {
    await expect(
      runOfficialPiInstall({
        homeDir: "/tmp",
        platform: "linux",
        download: async () => "echo fail",
        runCommand: async () => ({
          code: 1,
          stdout: "error: Node.js 22.19.0 or newer is required to install Pi.\n",
          stderr: "",
        }),
      }),
    ).rejects.toMatchObject({
      name: "InstallPiError",
      message: expect.stringMatching(/Node\.js 22\.19/),
    });
  });
});
