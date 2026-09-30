import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";

const script = path.resolve("scripts/verify-release-version.ts");
const loader = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const manifests = ["package.json", "apps/desktop/package.json", "apps/server/package.json", "apps/web/package.json", "packages/protocol/package.json"];
let root: string;
beforeAll(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "qingzhou-release-version-"));
  for (const file of manifests) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), JSON.stringify({ version: "0.1.21" }));
  }
});
afterAll(() => rmSync(root, { recursive: true, force: true }));
function verify(tag: string) {
  return spawnSync(process.execPath, ["--import", loader, script, tag], { cwd: root, encoding: "utf8" });
}
it("accepts a stable tag matching every package version", () => {
  const result = verify("v0.1.21");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("v0.1.21");
});
it.each(["main", "nightly", "latest", "v0.1.21-beta.1", "v0.1.20"])("rejects invalid or mismatched publication tag %s", (tag) => {
  const result = verify(tag);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(/正式版本标签|不一致/);
});
it.each(manifests)("rejects version drift in %s", (file) => {
  const full = path.join(root, file);
  writeFileSync(full, JSON.stringify({ version: "0.1.20" }));
  try {
    const result = verify("v0.1.21");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(file);
  } finally {
    writeFileSync(full, JSON.stringify({ version: "0.1.21" }));
  }
});
