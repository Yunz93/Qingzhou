import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { downloadPinnedSearchTool } from "../../apps/server/src/setup/pi-search-tools.ts";

const state = vi.hoisted(() => ({ events: [] as string[], destDir: "" }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    copyFile: async (...args: Parameters<typeof fs.copyFile>) => {
      await new Promise<void>((resolve) => setImmediate(resolve));
      await fs.copyFile(...args);
      state.events.push("copied");
    },
    rm: async (...args: Parameters<typeof fs.rm>) => {
      if (String(args[0]).includes("qingzhou-fd-") && state.destDir) state.events.push("cleanup");
      await fs.rm(...args);
    },
  };
});

it("finishes copying the downloaded binary before removing its extraction directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "qingzhou-download-test-"));
  try {
    const contents = path.join(root, "contents");
    await mkdir(contents);
    await writeFile(path.join(contents, "fd"), "pinned fd binary");
    const archive = path.join(root, "fd.tar.gz");
    execFileSync("tar", ["czf", "fd.tar.gz", "-C", "contents", "fd"], { cwd: root });
    const bytes = await readFile(archive);
    state.events = [];
    state.destDir = path.join(root, "installed");
    const installed = await downloadPinnedSearchTool("fd", state.destDir, {
      platform: "linux",
      fetchImpl: async () => new Response(bytes),
    });
    expect(await readFile(installed, "utf8")).toBe("pinned fd binary");
    expect(state.events).toEqual(["copied", "cleanup"]);
  } finally {
    state.destDir = "";
    await rm(root, { recursive: true, force: true });
  }
});
