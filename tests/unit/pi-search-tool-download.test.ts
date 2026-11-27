import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
    expect(await readdir(state.destDir)).toEqual(["fd"]);
    expect(state.events).toEqual(["copied", "cleanup"]);
  } finally {
    state.destDir = "";
    await rm(root, { recursive: true, force: true });
  }
});

it("bundles the pinned tools with their own complete notices from the executable's release directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mowen-search-notices-"));
  const bundled = path.join(root, "tools");
  try {
    for (const tool of ["fd", "rg"] as const) {
      const release = path.join(root, tool + "-release");
      const notices = tool === "fd" ? ["LICENSE-APACHE", "LICENSE-MIT"] : ["COPYING", "LICENSE-MIT", "UNLICENSE"];
      await mkdir(path.join(release, "docs"), { recursive: true });
      await writeFile(path.join(release, tool), tool + " binary");
      await writeFile(path.join(release, "docs", "LICENSE-MIT"), "unrelated nested license");
      for (const notice of notices) await writeFile(path.join(release, notice), tool + "\r\n" + notice + "\r\n");

      const fixture = async () => {
        const archive = path.join(root, tool + ".tar.gz");
        execFileSync("tar", ["czf", archive, "-C", root, path.basename(release)]);
        const bytes = new Uint8Array(await readFile(archive));
        return { platform: "darwin" as const, includeNotices: true, fetchImpl: async () => new Response(bytes) };
      };
      const binary = await downloadPinnedSearchTool(tool, bundled, await fixture());
      expect(await readFile(binary, "utf8")).toBe(tool + " binary");
      const destination = path.join(bundled, "licenses", tool);
      expect((await readdir(destination)).sort()).toEqual(notices);
      for (const notice of notices) {
        expect(await readFile(path.join(destination, notice))).toEqual(await readFile(path.join(release, notice)));
      }

      await rm(path.join(release, "LICENSE-MIT"));
      const incomplete = path.join(root, tool + "-incomplete");
      await expect(downloadPinnedSearchTool(tool, incomplete, await fixture())).rejects.toThrow("Missing LICENSE-MIT");
      await expect(readdir(incomplete)).rejects.toMatchObject({ code: "ENOENT" });
    }
    expect(await readFile(path.join(bundled, "licenses", "fd", "LICENSE-MIT"), "utf8")).toContain("fd\r\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
