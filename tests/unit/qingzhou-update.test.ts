import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  assertChecksum,
  currentQingzhouVersion,
  downloadUpdateFile,
  extractAppBundle,
  fetchLatestQingzhouRelease,
  githubReleaseDownloadUrl,
  humanizeGithubHttpStatus,
  inspectQingzhouUpdate,
  installQingzhouUpdate,
  isQingzhouUpdateAvailable,
  isValidReleaseTag,
  latestJsonDownloadUrl,
  macosBundlePathFromExecPath,
  canonicalizeUpdaterPlatformKey,
  changelogNotesForVersion,
  buildQingzhouLatestJson,
  parseQingzhouLatestJson,
  normalizeReleaseTag,
  parseQingzhouRelease,
  parseReleaseTagFromGithubUrl,
  parseSha256Sums,
  qingzhouRepo,
  relaunchWaiterCommand,
  replaceAppAtomically,
  requireChecksummedAsset,
  sha256Hex,
  shouldFallbackGithubRelease,
  syntheticGithubRelease,
  updaterPlatformKey,
  windowsInstallWaiterScript,
} from "../../apps/server/src/setup/qingzhou-update.ts";

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

function fakeRelease(assets: Array<{ name: string; url: string; size?: number }> = []) {
  return parseQingzhouRelease({
    tag_name: "v0.1.9",
    name: "Qingzhou 0.1.9",
    html_url: "https://github.com/Yunz93/Qingzhou/releases/tag/v0.1.9",
    body: "notes",
    published_at: "2026-09-06T00:00:00Z",
    prerelease: false,
    assets: assets.map((asset) => ({
      name: asset.name,
      browser_download_url: asset.url,
      size: asset.size ?? 42,
    })),
  });
}

describe("Qingzhou update metadata", () => {
  it("parses a GitHub release and compares semver tags", () => {
    const release = fakeRelease([{ name: "Qingzhou-mac-arm64.zip", url: "https://example.test/Qingzhou-mac-arm64.zip" }]);
    expect(release.version).toBe("0.1.9");
    expect(release.assets[0]?.name).toBe("Qingzhou-mac-arm64.zip");
    expect(isQingzhouUpdateAvailable(release.version, "0.1.8")).toBe(true);
    expect(isQingzhouUpdateAvailable(release.version, "0.1.9")).toBe(false);
    expect(isQingzhouUpdateAvailable("v0.1.8", "0.1.9")).toBe(false);
  });

  it("returns a user-facing error when GitHub metadata cannot be fetched", async () => {
    const result = await fetchLatestQingzhouRelease({ fetchJson: async () => { throw new Error("offline"); } });
    expect(result.release).toBeNull();
    expect(result.error).toBe("offline");
  });

  it("checks latest.json like Mozi instead of the GitHub API", () => {
    const src = readFileSync(path.resolve("apps/server/src/setup/qingzhou-update.ts"), "utf8");
    expect(src).toContain("releases/latest/download/${LATEST_JSON_NAME}");
    expect(src).not.toContain("api.github.com/repos/");
    expect(latestJsonDownloadUrl("Yunz93/Qingzhou")).toBe(
      "https://github.com/Yunz93/Qingzhou/releases/latest/download/latest.json",
    );
  });

  it("defaults to the renamed Qingzhou repo and humanizes GitHub 403", () => {
    expect(qingzhouRepo({})).toBe("Yunz93/Qingzhou");
    expect(humanizeGithubHttpStatus(403, "API rate limit exceeded")).toMatch(/限制了检查次数/);
    expect(humanizeGithubHttpStatus(429, "")).toMatch(/限制了检查次数/);
    expect(humanizeGithubHttpStatus(403, "")).toMatch(/HTTPS_PROXY/);
    expect(shouldFallbackGithubRelease(new Error("GitHub 返回 HTTP 403"))).toBe(true);
    expect(shouldFallbackGithubRelease(new Error("GitHub 返回 HTTP 404"))).toBe(true);
    expect(shouldFallbackGithubRelease(new Error("GitHub 限制了检查次数，请稍后再试。"))).toBe(true);
    expect(shouldFallbackGithubRelease(new Error(humanizeGithubHttpStatus(403, "API rate limit exceeded")))).toBe(true);
    expect(shouldFallbackGithubRelease(new Error(humanizeGithubHttpStatus(429)))).toBe(true);
    expect(shouldFallbackGithubRelease(new Error("offline"))).toBe(false);
  });

  it("parses a Mozi-shaped latest.json and falls back to the GitHub releases page when it is missing", async () => {
    const zip = "Qingzhou-mac-arm64.zip";
    const hash = "a".repeat(64);
    const parsed = parseQingzhouLatestJson({
      version: "0.1.11",
      notes: "from latest.json",
      pub_date: "2026-09-08T00:00:00Z",
      platforms: {
        "darwin-aarch64": {
          url: githubReleaseDownloadUrl("Yunz93/Qingzhou", "v0.1.11", zip),
          sha256: hash,
        },
      },
    });
    expect(parsed.release.version).toBe("0.1.11");
    expect(parsed.release.body).toBe("from latest.json");
    expect(parsed.sums.get(zip)).toBe(hash);
    expect(canonicalizeUpdaterPlatformKey("darwin-aarch64")).toBe("darwin-arm64");
    expect(canonicalizeUpdaterPlatformKey("windows-x86_64")).toBe("win32-x64");

    const fromManifest = await fetchLatestQingzhouRelease({
      fetchJson: async (url) => {
        expect(url).toBe(latestJsonDownloadUrl("Yunz93/Qingzhou"));
        return {
          version: "0.1.11",
          notes: "",
          pub_date: "2026-09-08T00:00:00Z",
          platforms: {
            "darwin-arm64": { url: githubReleaseDownloadUrl("Yunz93/Qingzhou", "v0.1.11", zip), sha256: hash },
          },
        };
      },
    });
    expect(fromManifest.error).toBeNull();
    expect(fromManifest.release?.version).toBe("0.1.11");
    expect(fromManifest.sums?.get(zip)).toBe(hash);

    const result = await fetchLatestQingzhouRelease({
      fetchJson: async () => {
        throw new Error("GitHub 限制了检查次数，请稍后再试。");
      },
      fetchLatestLocation: async () => "https://github.com/Yunz93/Qingzhou/releases/tag/v0.1.11",
    });
    expect(result.error).toBeNull();
    expect(result.release?.version).toBe("0.1.11");
    expect(result.release?.assets.some((asset) => asset.name === zip)).toBe(true);
    expect(parseReleaseTagFromGithubUrl("https://github.com/Yunz93/Qingzhou/releases/tag/v0.1.10")).toBe("v0.1.10");
    expect(githubReleaseDownloadUrl("Yunz93/Qingzhou", "v0.1.11", "SHA256SUMS.txt")).toMatch(/\/v0\.1\.11\/SHA256SUMS\.txt$/);
    expect(syntheticGithubRelease("Yunz93/Qingzhou", "v0.1.11").tag_name).toBe("v0.1.11");
  });

  it("reads the package version when QINGZHOU_VERSION is unset", () => {
    expect(currentQingzhouVersion({})).toMatch(/^\d+\.\d+\.\d+$/);
    expect(currentQingzhouVersion({ QINGZHOU_VERSION: "v1.2.3" })).toBe("1.2.3");
    expect(currentQingzhouVersion({ MOWEN_VERSION: "v0.1.8" })).toBe("0.1.8");
  });

  it("rejects updater payloads that do not match SHA256SUMS.txt", () => {
    const script = "#!/bin/bash\necho ok\n";
    const sums = parseSha256Sums(`${sha256Hex(script)}  install-macos.sh\n`);
    expect(() => assertChecksum("install-macos.sh", script, sums)).not.toThrow();
    expect(() => assertChecksum("install-macos.sh", `${script}tampered`, sums)).toThrow(/校验和/);
    expect(() => assertChecksum("missing.sh", script, sums)).toThrow(/没有/);
  });
});

describe("checksummed in-app artifacts", () => {
  it("maps updater platform keys like Mozi latest.json platforms", () => {
    expect(updaterPlatformKey("darwin", "arm64")).toBe("darwin-arm64");
    expect(updaterPlatformKey("darwin", "x86_64")).toBe("darwin-x64");
    expect(updaterPlatformKey("win32", "x64")).toBe("win32-x64");
    expect(() => updaterPlatformKey("linux", "x64")).toThrow(/暂不支持/);
  });

  it("writes a Mozi-shaped latest.json from SHA256SUMS.txt", () => {
    const zip = "Qingzhou-mac-arm64.zip";
    const exe = "Qingzhou-win-x64-setup.exe";
    const zipHash = "b".repeat(64);
    const exeHash = "c".repeat(64);
    const latest = buildQingzhouLatestJson({
      repo: "Yunz93/Qingzhou",
      tag: "v0.1.16",
      sums: new Map([
        [zip, zipHash],
        [exe, exeHash],
      ]),
      notes: "from changelog",
      pubDate: "2026-09-08T00:00:00Z",
    });
    expect(latest.version).toBe("0.1.16");
    expect(latest.notes).toBe("from changelog");
    expect(latest.platforms["darwin-arm64"]).toEqual({
      url: githubReleaseDownloadUrl("Yunz93/Qingzhou", "v0.1.16", zip),
      sha256: zipHash,
    });
    expect(latest.platforms["darwin-aarch64"]).toEqual(latest.platforms["darwin-arm64"]);
    expect(latest.platforms["windows-x86_64"]).toEqual(latest.platforms["win32-x64"]);
    expect(changelogNotesForVersion("## Unreleased\n\n## 0.1.16\n\n- 修好了更新。\n\n## 0.1.15\n\n- 旧的。\n", "v0.1.16")).toBe(
      "- 修好了更新。",
    );
  });

  it("requires a checksummed zip or setup exe and never accepts a DMG or install script", () => {
    const zip = "Qingzhou-mac-arm64.zip";
    const payload = "app-bytes";
    const sums = parseSha256Sums(`${sha256Hex(payload)}  ${zip}\n`);
    const release = fakeRelease([
      { name: zip, url: "https://example.test/Qingzhou-mac-arm64.zip" },
      { name: "Qingzhou-mac-arm64.dmg", url: "https://example.test/Qingzhou-mac-arm64.dmg" },
      { name: "install-macos.sh", url: "https://example.test/install-macos.sh" },
    ]);
    const asset = requireChecksummedAsset(release, sums, "darwin", "arm64");
    expect(asset.name).toBe(zip);
    expect(asset.sha256).toBe(sha256Hex(payload));
  });

  it("rejects a newer release that has no checksum for the platform artifact", () => {
    const release = fakeRelease([{ name: "Qingzhou-mac-arm64.zip", url: "https://example.test/app.zip" }]);
    expect(() =>
      requireChecksummedAsset(release, parseSha256Sums(`${"a".repeat(64)}  other.txt\n`), "darwin", "arm64"),
    ).toThrow(/SHA256SUMS.txt 缺少/);
    expect(() => requireChecksummedAsset(release, new Map(), "darwin", "arm64")).toThrow(/无效或为空/);
    expect(() =>
      requireChecksummedAsset(fakeRelease([{ name: "install-macos.sh", url: "https://example.test/install-macos.sh" }]), parseSha256Sums(`${"a".repeat(64)}  install-macos.sh\n`), "darwin", "arm64"),
    ).toThrow(/缺少平台安装包/);
  });

  it("fails the check when SHA256SUMS.txt does not list the platform zip", async () => {
    const release = fakeRelease([{ name: "Qingzhou-mac-arm64.zip", url: "https://example.test/app.zip" }]);
    const result = await inspectQingzhouUpdate({
      platform: "darwin",
      arch: "arm64",
      fetchJson: async () => ({
        version: "0.1.9",
        platforms: {
          "darwin-arm64": { url: "https://example.test/app.zip" },
        },
      }),
      fetchText: async () => `${"b".repeat(64)}  install-macos.sh\n`,
    });
    expect(result.release?.version).toBe(release.version);
    expect(result.asset).toBeNull();
    expect(result.error).toMatch(/SHA256SUMS.txt 缺少/);
  });

  it("does not install when the downloaded artifact fails the checksum", async () => {
    await expect(
      installQingzhouUpdate({
        version: "0.1.9",
        platform: "darwin",
        arch: "arm64",
        fetchJson: async () => ({
          version: "0.1.9",
          platforms: {
            "darwin-arm64": {
              url: "https://example.test/app.zip",
              sha256: sha256Hex("good"),
            },
          },
        }),
        fetchToFile: async (_url, dest) => {
          await writeFile(dest, "tampered");
        },
      }),
    ).rejects.toThrow(/校验和/);
  });

  it("downloads the checksummed zip, replaces the app, and never falls back to the website script", async () => {
    const payload = Buffer.from("signed-app");
    const hash = sha256Hex(payload);
    const calls: string[] = [];
    const result = await installQingzhouUpdate({
      version: "0.1.9",
      platform: "darwin",
      arch: "arm64",
      env: { QINGZHOU_APP_PATH: "/Applications/Qingzhou.app" },
      fetchJson: async () => ({
        version: "0.1.9",
        platforms: {
          "darwin-arm64": {
            url: "https://example.test/app.zip",
            sha256: hash,
          },
        },
      }),
      fetchToFile: async (_url, dest, onEvent) => {
        onEvent?.({ event: "Started", data: { contentLength: payload.length } });
        await writeFile(dest, payload);
        onEvent?.({ event: "Progress", data: { chunkLength: payload.length } });
        onEvent?.({ event: "Finished" });
      },
      extractApp: async () => "/tmp/incoming.app",
      replaceApp: async (target, incoming) => {
        calls.push(`replace:${target}:${incoming}`);
      },
      clearQuarantine: () => {
        calls.push("xattr");
      },
      spawnWaiter: (kind, target) => {
        calls.push(`waiter:${kind}:${target}`);
      },
    });
    expect(result).toMatchObject({ ok: true, version: "v0.1.9", platform: "darwin", relaunch: false });
    expect(calls).toEqual([
      "xattr",
      "replace:/Applications/Qingzhou.app:/tmp/incoming.app",
      "waiter:macos:/Applications/Qingzhou.app",
    ]);
  });
});

describe("atomic replace and helpers", () => {
  it("swaps the app and removes the backup", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "qingzhou-replace-"));
    dirs.push(temp);
    const target = path.join(temp, "Qingzhou.app");
    const incoming = path.join(temp, "incoming.app");
    const backup = path.join(temp, "backup.app");
    await mkdir(target);
    await writeFile(path.join(target, "marker.txt"), "old");
    await mkdir(incoming);
    await writeFile(path.join(incoming, "marker.txt"), "new");
    await replaceAppAtomically(target, incoming, backup);
    expect(await readFile(path.join(target, "marker.txt"), "utf8")).toBe("new");
    await expect(readFile(path.join(backup, "marker.txt"), "utf8")).rejects.toThrow();
  });

  it("rolls back when the incoming app is missing", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "qingzhou-replace-fail-"));
    dirs.push(temp);
    const target = path.join(temp, "Qingzhou.app");
    const incoming = path.join(temp, "missing.app");
    const backup = path.join(temp, "backup.app");
    await mkdir(target);
    await writeFile(path.join(target, "marker.txt"), "old");
    await expect(replaceAppAtomically(target, incoming, backup)).rejects.toThrow(/安装新版本失败/);
    expect(await readFile(path.join(target, "marker.txt"), "utf8")).toBe("old");
  });

  it("rejects non-zip update archives before invoking extraction tools", async () => {
    await expect(extractAppBundle("Qingzhou.dmg", "unused")).rejects.toThrow(/zip/);
  });

  // The macOS updater uses zip/unzip; Windows installs the verified setup.exe.
  it.skipIf(process.platform === "win32")("extracts the macOS Qingzhou.app from a zip", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "qingzhou-extract-"));
    dirs.push(temp);
    const appDir = path.join(temp, "Qingzhou.app");
    await mkdir(appDir);
    await writeFile(path.join(appDir, "marker.txt"), "bundle");
    const zipPath = path.join(temp, "Qingzhou-mac-arm64.zip");
    const { execFileSync } = await import("node:child_process");
    execFileSync("zip", ["-q", "-r", zipPath, "Qingzhou.app"], { cwd: temp });
    const extracted = await extractAppBundle(zipPath, path.join(temp, "out"));
    expect(extracted.endsWith("Qingzhou.app")).toBe(true);
    expect(await readFile(path.join(extracted, "marker.txt"), "utf8")).toBe("bundle");
  });

  it("reads the macOS bundle path from the Electron executable", () => {
    expect(macosBundlePathFromExecPath("/Applications/Qingzhou.app/Contents/MacOS/Qingzhou")).toBe(
      "/Applications/Qingzhou.app",
    );
    expect(macosBundlePathFromExecPath("/usr/bin/qingzhou")).toBeNull();
  });

  it("validates release tags and builds the relaunch waiter", () => {
    expect(normalizeReleaseTag("0.1.9")).toBe("v0.1.9");
    expect(isValidReleaseTag("v0.1.9")).toBe(true);
    expect(isValidReleaseTag("v1.0.0-beta.1")).toBe(true);
    expect(isValidReleaseTag("0.1.9")).toBe(false);
    expect(isValidReleaseTag("v0.1.9; rm -rf /")).toBe(false);
    const command = relaunchWaiterCommand(42, "/Applications/Qingzhou.app");
    expect(command).toContain("kill -0 42");
    expect(command).toContain('open "/Applications/Qingzhou.app"');
    const windows = windowsInstallWaiterScript(9, "C:\\Temp\\setup.exe", "C:\\App\\Qingzhou.exe");
    expect(windows).toContain("Get-Process -Id 9");
    expect(windows).toContain("/S");
    expect(windows).toContain("Remove-Item");
    expect(() => windowsInstallWaiterScript(1, "C:\\bad'path.exe", "C:\\App\\Qingzhou.exe")).toThrow(/路径无效/);
  });

  it("emits Started / Progress / Finished while downloading", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "qingzhou-dl-"));
    dirs.push(temp);
    const dest = path.join(temp, "app.zip");
    const body = new Uint8Array(100 * 1024).fill(7);
    const events: Array<{ event: string }> = [];
    await downloadUpdateFile(
      "https://example.test/app.zip",
      dest,
      (event) => events.push({ event: event.event }),
      async () =>
        new Response(body, {
          headers: { "content-length": String(body.byteLength) },
        }),
    );
    expect(events.map((item) => item.event)).toEqual(["Started", "Progress", "Finished"]);
    expect(sha256Hex(await readFile(dest))).toBe(sha256Hex(Buffer.from(body)));
  });

  it("keeps the in-app updater off the website install script", () => {
    const src = readFileSync(path.resolve("apps/server/src/setup/qingzhou-update.ts"), "utf8");
    expect(src).not.toMatch(/install-macos\.sh/);
    expect(src).not.toMatch(/--user/);
    expect(src).not.toMatch(/install-windows\.ps1/);
    expect(src).toContain("已终止安装");
    expect(src).toContain("Qingzhou-mac-arm64.zip");
    const workflow = readFileSync(path.resolve(".github/workflows/release.yml"), "utf8");
    expect(workflow).toContain("write-latest-json.ts");
    expect(workflow).toContain("dist/latest.json");
    const writer = readFileSync(path.resolve("scripts/write-latest-json.ts"), "utf8");
    expect(writer).toContain("buildQingzhouLatestJson");
    expect(writer).toContain("changelogNotesForVersion");
  });
});
