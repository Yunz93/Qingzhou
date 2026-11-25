import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

const script = path.resolve("scripts/install-windows.ps1");
const powerShell = process.env.QINGZHOU_TEST_POWERSHELL || (process.platform === "win32" ? "powershell.exe" : "");

it.runIf(Boolean(powerShell)).each([
  { args: ["-Nightly"], error: /NamedParameterNotFound/ },
  { args: ["-Version", "nightly"], error: /latest.*v0\.1\.21/ },
  { args: ["-Version", "main"], error: /latest.*v0\.1\.21/ },
])("rejects unsupported release selection $args before installing", ({ args, error }) => {
  // Arguments are fixed fixtures; shadow downloads so a regression cannot install an app.
  const command = `
    function Invoke-WebRequest { throw 'UNEXPECTED_DOWNLOAD' }
    try {
      & $env:QINGZHOU_TEST_INSTALLER ${args.join(" ")}
    } catch {
      [Console]::Error.WriteLine($_.FullyQualifiedErrorId)
      [Console]::Error.WriteLine($_.Exception.Message)
      exit 1
    }
  `;
  const result = spawnSync(powerShell, ["-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8", env: { ...process.env, QINGZHOU_TEST_INSTALLER: script, QINGZHOU_VERSION: "latest", QINGZHOU_UPDATE_PARENT_PID: "" },
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(error);
  expect(result.stdout).not.toContain("warning:");
  expect(result.stdout).not.toContain("downloaded SHA256SUMS.txt");
});

it.runIf(Boolean(powerShell)).each([
  { name: "successful install", exitCode: "0", checksumMatches: true },
  { name: "installer failure", exitCode: "23", checksumMatches: true },
  { name: "checksum mismatch", exitCode: "0", checksumMatches: false },
])("validates and cleans up a $name", ({ exitCode, checksumMatches }) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "qingzhou-windows-install-test-"));
  const temp = path.join(root, "temp");
  const launchLog = path.join(root, "launch.log");
  const payload = "isolated install";
  const checksum = checksumMatches ? createHash("sha256").update(payload).digest("hex") : "0".repeat(64);
  const command = `
    function Invoke-WebRequest {
      param([string]$Uri, [string]$OutFile, [switch]$UseBasicParsing)
      if ($Uri.EndsWith('/SHA256SUMS.txt')) {
        [IO.File]::WriteAllText($OutFile, "$env:FIXTURE_CHECKSUM  Qingzhou-win-x64-setup.exe")
      } elseif ($Uri.EndsWith('/Qingzhou-win-x64-setup.exe')) {
        [IO.File]::WriteAllText($OutFile, $env:FIXTURE_PAYLOAD)
      } else {
        throw 'asset not found'
      }
    }
    function Unblock-File { param([string]$Path) }
    function Start-Process {
      param([string]$FilePath, [switch]$Wait, [switch]$PassThru)
      [IO.File]::WriteAllText($env:FIXTURE_LAUNCH_LOG, [IO.File]::ReadAllText($FilePath))
      [PSCustomObject]@{ ExitCode = [int]$env:FIXTURE_EXIT_CODE }
    }
    & $env:QINGZHOU_TEST_INSTALLER
  `;
  try {
    mkdirSync(temp);
    const result = spawnSync(powerShell, ["-NoProfile", "-NonInteractive", "-Command", command], {
      encoding: "utf8",
      env: {
        ...process.env,
        TEMP: temp,
        PROCESSOR_ARCHITECTURE: "AMD64",
        PROCESSOR_ARCHITEW6432: "",
        QINGZHOU_TEST_INSTALLER: script,
        QINGZHOU_VERSION: "latest",
        QINGZHOU_UPDATE_PARENT_PID: "",
        FIXTURE_CHECKSUM: checksum,
        FIXTURE_PAYLOAD: payload,
        FIXTURE_EXIT_CODE: exitCode,
        FIXTURE_LAUNCH_LOG: launchLog,
      },
    });
    const shouldSucceed = checksumMatches && exitCode === "0";
    if (shouldSucceed) {
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("setup finished");
    } else {
      expect(result.status, result.stdout).not.toBe(0);
      expect(result.stdout).not.toContain("setup finished");
      if (checksumMatches) expect(result.stderr).toContain(exitCode);
    }
    if (checksumMatches) {
      expect(readFileSync(launchLog, "utf8")).toBe(payload);
    } else {
      expect(readdirSync(root)).not.toContain("launch.log");
    }
    expect(readdirSync(temp)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
