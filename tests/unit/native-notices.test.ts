import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { stageNativeNotices } from "../../apps/desktop/scripts/native-notices.mjs";

let root: string;
const shared = "Original notice shared by both fixture crates.";
const vendor = "Original notice for a separately vendored component.";
async function makeCrate(directory: string, name: string, additions = "") {
  await mkdir(path.join(directory, "src"), { recursive: true });
  await writeFile(path.join(directory, "src/lib.rs"), "");
  await writeFile(path.join(directory, "Cargo.toml"),
    `[package]\nname = "${name}"\nversion = "1.0.0"\nedition = "2021"\nlicense = "MIT"\n${additions}`);
}
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "mowen cargo notices "));
  await makeCrate(root, "workspace-test", [
    '[dependencies]', 'tauri = { path = "tauri" }',
    "[target.'cfg(windows)'.dependencies]", 'windows-test = { path = "windows" }',
    '[build-dependencies]', 'build-test = { path = "build" }',
  ].join("\n"));
  await makeCrate(path.join(root, "tauri"), "tauri", "[features]\ncustom-protocol = []");
  await makeCrate(path.join(root, "windows"), "windows-test");
  await makeCrate(path.join(root, "build"), "build-test");
  await writeFile(path.join(root, "tauri/LICENSE"), shared);
  await writeFile(path.join(root, "windows/COPYING"), shared);
  await mkdir(path.join(root, "tauri/third_party"), { recursive: true });
  await writeFile(path.join(root, "tauri/third_party/NOTICE.txt"), vendor);
  execFileSync("cargo", ["generate-lockfile", "--offline"], { cwd: root });
});
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

it("matches the target's runtime graph and preserves and deduplicates original notices", async () => {
  const stage = (target: string) => stageNativeNotices({
    manifestPath: path.join(root, "Cargo.toml"), target, runtime: path.join(root, "output with spaces", target),
  });
  const windows = await readFile(await stage("x86_64-pc-windows-msvc"), "utf8");
  const mac = await readFile(await stage("aarch64-apple-darwin"), "utf8");
  expect(windows).toContain("windows-test 1.0.0");
  expect(mac).not.toContain("windows-test");
  for (const contents of [windows, mac]) {
    expect(contents).not.toContain("build-test");
    expect(contents).not.toContain(root);
    expect(contents).toContain("third_party/NOTICE.txt");
    expect(contents.split(shared)).toHaveLength(2);
    expect(contents.split(vendor)).toHaveLength(2);
  }
  await rm(path.join(root, "tauri/LICENSE"));
  await expect(stage("aarch64-apple-darwin")).rejects.toThrow("原生依赖缺少许可证声明：tauri@1.0.0");
});
