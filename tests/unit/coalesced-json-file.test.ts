import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { CoalescedJsonFile } from "../../apps/server/src/tasks/coalesced-json-file.ts";

describe("CoalescedJsonFile", () => {
  it("finishes awaited startup writes without another active handle", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "qingzhou-coalesce-startup-"));
    const filePath = path.join(dir, "state.json");
    const moduleUrl = pathToFileURL(path.resolve("apps/server/src/tasks/coalesced-json-file.ts")).href;
    try {
      // Vitest keeps its own event loop alive, so this regression needs a child
      // with no server socket to keep an unreferenced debounce timer running.
      const script = `
        import { CoalescedJsonFile } from ${JSON.stringify(moduleUrl)};
        const file = new CoalescedJsonFile(${JSON.stringify(filePath)}, () => ({ recovered: true }));
        await file.flush();
        console.log("persisted");
      `;
      const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
        encoding: "utf8",
        timeout: 5_000,
      });
      expect(child.error).toBeUndefined();
      expect(child.status, child.stderr).toBe(0);
      expect(child.stdout.trim()).toBe("persisted");
      expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({ recovered: true });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("coalesces bursts into one durable write", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "qingzhou-coalesce-"));
    const filePath = path.join(dir, "state.json");
    let value = { n: 0 };
    const file = new CoalescedJsonFile(filePath, () => value, { debounceMs: 30, fsync: false });
    const writes = [];
    for (let i = 1; i <= 20; i += 1) {
      value = { n: i };
      writes.push(file.flush());
    }
    await Promise.all(writes);
    const raw = await readFile(filePath, "utf8");
    expect(JSON.parse(raw)).toEqual({ n: 20 });
  });

  it("flushNow covers pending mutations", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "qingzhou-coalesce-now-"));
    const filePath = path.join(dir, "state.json");
    let value = { n: 1 };
    const file = new CoalescedJsonFile(filePath, () => value, { debounceMs: 5_000, fsync: false });
    const pending = file.flush();
    value = { n: 2 };
    await file.flushNow({ fsync: true });
    await pending;
    const raw = await readFile(filePath, "utf8");
    expect(JSON.parse(raw)).toEqual({ n: 2 });
  });
});
