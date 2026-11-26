import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectModelsFile, listConfiguredProviders, saveApiKey } from "../../apps/server/src/setup/auth-status.ts";
import { SettingsStore } from "../../apps/server/src/setup/settings-store.ts";
import { listFolders } from "../../apps/server/src/setup/folder-browser.ts";

describe("setup helpers", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("writes api keys into a pi auth.json under a fake home", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "qingzhou-auth-"));
    dirs.push(home);
    await saveApiKey("anthropic", "sk-ant-test-key-123456", home);
    const raw = await readFile(path.join(home, ".pi", "agent", "auth.json"), "utf8");
    const json = JSON.parse(raw) as { anthropic: { type: string; key: string } };
    expect(json.anthropic).toEqual({ type: "api_key", key: "sk-ant-test-key-123456" });
    const providers = await listConfiguredProviders(home);
    expect(providers).toContain("anthropic");
  });

  it("overwrites an existing API key for the same provider", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "qingzhou-auth-update-"));
    dirs.push(home);
    await saveApiKey("anthropic", "sk-ant-old-key-123456", home);
    await saveApiKey("anthropic", "sk-ant-new-key-654321", home);
    const raw = await readFile(path.join(home, ".pi", "agent", "auth.json"), "utf8");
    const json = JSON.parse(raw) as { anthropic: { type: string; key: string } };
    expect(json.anthropic.key).toBe("sk-ant-new-key-654321");
  });

  it("counts explicit models across providers and legacy lists without counting endpoint or model overrides", async () => {
    const agentDir = await mkdtemp(path.join(os.tmpdir(), "mowen-model-count-"));
    dirs.push(agentDir);
    const inspect = () => inspectModelsFile(agentDir, agentDir);
    const configure = (value: unknown) => writeFile(path.join(agentDir, "models.json"), JSON.stringify(value));
    expect(await inspect()).toEqual({ present: false, count: 0 });
    await configure({ providers: { google: { baseUrl: "http://localhost:4310", modelOverrides: { existing: { name: "Renamed" } } } } });
    expect(await inspect()).toEqual({ present: true, count: 0 });
    await configure({ providers: { one: { models: [{ id: "a" }, { id: "b" }] }, two: { models: [{ id: "a" }] }, three: {} } });
    expect(await inspect()).toEqual({ present: true, count: 3 });
    for (const legacy of [[{ id: "legacy" }], { models: [{ id: "legacy" }] }]) {
      await configure(legacy);
      expect(await inspect()).toEqual({ present: true, count: 1 });
    }
  });

  it("persists workspace settings", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "qingzhou-settings-"));
    dirs.push(dataDir);
    const store = new SettingsStore(dataDir);
    await store.save({ workspaceRoot: "/tmp/work", setupCompletedAt: "2026-01-01T00:00:00.000Z" });
    const again = new SettingsStore(dataDir);
    await again.load();
    expect(again.get().workspaceRoot).toBe("/tmp/work");
    expect(again.get().setupCompletedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(again.get().trustProject).toBe(false);
    expect(again.get().autoCheckForUpdates).toBe(true);
    expect(again.get().skippedUpdateVersion).toBe("");
    await again.save({ trustProject: true, skippedUpdateVersion: "0.1.9", autoCheckForUpdates: false });
    const trusted = new SettingsStore(dataDir);
    await trusted.load();
    expect(trusted.get().trustProject).toBe(true);
    expect(trusted.get().autoCheckForUpdates).toBe(false);
    expect(trusted.get().skippedUpdateVersion).toBe("0.1.9");
  });

  it("lists only child folders inside browse roots", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qingzhou-folders-"));
    dirs.push(root);
    await mkdir(path.join(root, "docs"));
    await mkdir(path.join(root, "node_modules"));
    const result = await listFolders(root, [root]);
    expect(result.entries.map((entry) => entry.name)).toEqual(["docs"]);
  });
});
