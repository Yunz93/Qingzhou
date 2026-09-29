import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { exportFileUrl } from "../../apps/web/src/lib/open-export.ts";

describe("desktop setup menu and export open", () => {
  it("preload exposes openPath and onOpenSetup", () => {
    const src = readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    expect(src).toMatch(/qingzhou:open-path/);
    expect(src).toMatch(/qingzhou:open-setup/);
    expect(src).toMatch(/qingzhou:notify/);
    expect(src).toMatch(/qingzhou:check-update/);
    expect(src).toMatch(/relaunch\?: boolean/);
  });

  it("main process opens html paths and forwards the setup menu", () => {
    const src = readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    expect(src).toMatch(/qingzhou:open-path/);
    expect(src).toMatch(/qingzhou:open-setup/);
    expect(src).toMatch(/再次打开设置/);
    expect(src).toMatch(/检查更新/);
    expect(src).toMatch(/qingzhou:notify/);
    expect(src).not.toMatch(/extname\(filePath\)\.toLowerCase\(\) !== "\.html"/);
    expect(src).toMatch(/ipcMain\.removeHandler/);
    expect(src).toMatch(/if \(ipcReady\) return/);
    expect(src).toMatch(/if \(booting\) return booting/);
    expect(src).toMatch(/adoptSystemProxy/);
    expect(src).toMatch(/https:\/\/github.com\/Yunz93\/Qingzhou/);
    expect(src).toMatch(/payload\?\.relaunch !== false/);
  });

  it("adopts the system proxy for GitHub, OpenAI, pi.dev, and npm", () => {
    const src = readFileSync(path.resolve("apps/desktop/src/main/system-proxy.ts"), "utf8");
    expect(src).toContain("https://api.github.com");
    expect(src).toContain("https://api.openai.com");
    expect(src).toContain("https://pi.dev");
    expect(src).toContain("https://registry.npmjs.org");
  });

  it("checks skill updates without waiting on Pi reload_skills", () => {
    const src = readFileSync(path.resolve("apps/server/src/tasks/task-service.ts"), "utf8");
    const start = src.indexOf("private async checkResourceSkillUpdates");
    const end = src.indexOf("private async updateResourceSkills", start);
    const block = src.slice(start, end);
    expect(block).toMatch(/emitResources/);
    expect(block).not.toMatch(/reloadResources/);
  });

  it("records the packaged app path for in-app replace", () => {
    const src = readFileSync(path.resolve("apps/desktop/src/main/paths.ts"), "utf8");
    expect(src).toMatch(/QINGZHOU_APP_PATH/);
    expect(src).toMatch(/QINGZHOU_EXEC_PATH/);
    expect(src).toMatch(/packagedAppPath/);
    expect(src).toMatch(/macosElectronHelperBin/);
  });

  it("encodes export file URLs", () => {
    expect(exportFileUrl("/tmp/a b.html")).toBe(`/api/exports?path=${encodeURIComponent("/tmp/a b.html")}`);
  });
});
