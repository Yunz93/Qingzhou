import { spawnSync } from "node:child_process";
import path from "node:path";
import { expect, it } from "vitest";
const script = path.resolve("scripts/install-windows.ps1");
it.runIf(process.platform === "win32").each([
  { args: ["-Nightly"], error: /NamedParameterNotFound/ },
  { args: ["-Version", "nightly"], error: /latest.*v0\.1\.21/ },
  { args: ["-Version", "main"], error: /latest.*v0\.1\.21/ },
])("rejects unsupported release selection $args before installing", ({ args, error }) => {
  // Arguments are fixed fixtures; shadow downloads so a regression cannot install an app.
  const command = `function Invoke-WebRequest { throw 'UNEXPECTED_DOWNLOAD' }; & $env:QINGZHOU_TEST_INSTALLER ${args.join(" ")}`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8", env: { ...process.env, QINGZHOU_TEST_INSTALLER: script, QINGZHOU_VERSION: "latest", QINGZHOU_UPDATE_PARENT_PID: "" },
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(error);
  expect(result.stdout).not.toContain("warning:");
  expect(result.stdout).not.toContain("downloaded SHA256SUMS.txt");
});
