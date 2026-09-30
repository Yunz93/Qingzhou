import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { humanizeUserFacingError } from "../../apps/server/src/setup/pi-agent-dir.ts";
import {
  ensurePiSearchTools,
  guiSearchToolDirs,
  humanizeSearchToolDownloadError,
  PINNED_FD_VERSION,
  searchToolDownloadUrl,
  searchToolBinaryName,
  shouldFetchPinnedSearchTools,
} from "../../apps/server/src/setup/pi-search-tools.ts";

describe("Pi search tools (fd / ripgrep)", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("pins GitHub release URLs instead of calling /releases/latest", () => {
    expect(searchToolDownloadUrl("fd", "darwin", "arm64")).toBe(
      `https://github.com/sharkdp/fd/releases/download/v${PINNED_FD_VERSION}/fd-v${PINNED_FD_VERSION}-aarch64-apple-darwin.tar.gz`,
    );
    expect(searchToolDownloadUrl("rg", "darwin", "arm64")).toContain("/BurntSushi/ripgrep/releases/download/");
    expect(searchToolDownloadUrl("fd", "darwin", "arm64")).not.toContain("/releases/latest");
  });

  it("puts Homebrew and common GUI bins ahead of a stripped Electron PATH", () => {
    expect(guiSearchToolDirs("/Users/yunz", "darwin")).toContain("/opt/homebrew/bin");
    expect(guiSearchToolDirs("/Users/yunz", "darwin")).toContain("/usr/local/bin");
  });

  it("does not fetch during tests or e2e", () => {
    expect(shouldFetchPinnedSearchTools({ VITEST: "true" })).toBe(false);
    expect(shouldFetchPinnedSearchTools({ QINGZHOU_E2E: "1" })).toBe(false);
    expect(shouldFetchPinnedSearchTools({ QINGZHOU_SKIP_PI_TOOLS_FETCH: "1" })).toBe(false);
    expect(shouldFetchPinnedSearchTools({ NODE_ENV: "production" })).toBe(true);
  });

  it("copies bundled fd/rg into Pi's agent bin so Pi skips GitHub", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "qingzhou-tools-home-"));
    const bundled = await mkdtemp(path.join(os.tmpdir(), "qingzhou-tools-bundle-"));
    dirs.push(home, bundled);
    const agentDir = path.join(home, ".pi", "agent");
    await writeFile(path.join(bundled, "fd"), "#!/bin/sh\necho fd\n", { mode: 0o755 });
    await writeFile(path.join(bundled, "rg"), "#!/bin/sh\necho rg\n", { mode: 0o755 });

    let fetched = 0;
    const installed = await ensurePiSearchTools({
      agentDir,
      env: { PATH: "/usr/bin", QINGZHOU_PI_TOOLS: bundled },
      homeDir: home,
      bundledDir: bundled,
      fetchMissing: true,
      platform: "linux",
      download: async () => {
        fetched += 1;
        throw new Error("should not download");
      },
    });

    expect(fetched).toBe(0);
    expect(installed.fd).toBe(path.join(agentDir, "bin", "fd"));
    expect(installed.rg).toBe(path.join(agentDir, "bin", "rg"));
    expect(await readFile(path.join(agentDir, "bin", "fd"), "utf8")).toContain("echo fd");
  });

  it("copies a PATH binary named fdfind as fd", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "qingzhou-tools-fdfind-"));
    const pathDir = await mkdtemp(path.join(os.tmpdir(), "qingzhou-tools-path-"));
    dirs.push(home, pathDir);
    await writeFile(path.join(pathDir, process.platform === "win32" ? "fdfind.exe" : "fdfind"), "#!/bin/sh\necho fdfind\n", { mode: 0o755 });
    const agentDir = path.join(home, ".pi", "agent");
    const installed = await ensurePiSearchTools({
      agentDir,
      env: { PATH: pathDir },
      homeDir: home,
      fetchMissing: false,
      platform: process.platform === "win32" ? "win32" : "linux",
    });
    expect(installed.fd).toBe(path.join(agentDir, "bin", searchToolBinaryName("fd")));
    expect(await readFile(path.join(agentDir, "bin", searchToolBinaryName("fd")), "utf8")).toContain("fdfind");
  });

  it("humanizes Pi's GitHub API 403 download warning", () => {
    const text = [
      "fd not found. Downloading...",
      "ripgrep not found. Downloading...",
      "Warning: Failed to download ripgrep: GitHub API error: 403",
      "Warning: Failed to download fd: GitHub API error: 403",
    ].join("\n");
    expect(humanizeSearchToolDownloadError(text)).toMatch(/brew install fd ripgrep/);
    expect(humanizeUserFacingError(new Error(text))).toMatch(/brew install fd ripgrep/);
  });
});
