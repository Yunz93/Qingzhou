import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CoalescedJsonFile } from "../../apps/server/src/tasks/coalesced-json-file.ts";

describe("CoalescedJsonFile", () => {
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
