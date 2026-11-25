import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { exportFileUrl } from "../../apps/web/src/lib/open-export.ts";

describe("desktop setup menu and export open", () => {
  it("routes the native menu through the scoped main webview", () => {
    const host = readFileSync(path.resolve("apps/desktop/src-tauri/src/main.rs"), "utf8");
    const bridge = readFileSync(path.resolve("apps/web/src/desktop-bridge.ts"), "utf8");
    for (const event of ["qingzhou://open-settings", "qingzhou://check-update"]) {
      expect(host).toContain(event);
      expect(bridge).toContain(event);
    }
    expect(host).toContain('"CmdOrCtrl+,"');
    expect(host).toContain(".webview(MAIN)");
    expect(host).toContain("verify_workbench");
  });

  it("checks skill updates without waiting on Pi reload_skills", () => {
    const src = readFileSync(path.resolve("apps/server/src/tasks/task-service.ts"), "utf8");
    const start = src.indexOf("private async checkResourceSkillUpdates");
    const end = src.indexOf("private async updateResourceSkills", start);
    const block = src.slice(start, end);
    expect(block).toMatch(/emitResources/);
    expect(block).not.toMatch(/reloadResources/);
  });

  it("encodes export file URLs", () => {
    expect(exportFileUrl("/tmp/a b.html")).toBe(`/api/exports?path=${encodeURIComponent("/tmp/a b.html")}`);
  });
});
