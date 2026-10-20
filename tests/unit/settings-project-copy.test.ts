import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("settings project copy", () => {
  it("explains default workspace vs per-session folders and app data", () => {
    const page = readFileSync(path.resolve("apps/web/src/pages/SettingsPage.tsx"), "utf8");
    expect(page).toContain("默认工作文件夹");
    expect(page).toContain("新对话默认使用此目录，可在会话中切换。");
    expect(page).toContain("信任默认工作区");
    expect(page).toContain("仅信任下方的默认工作文件夹。");
    expect(page).toContain('aria-label="信任默认工作区"');
    expect(page).toContain("应用数据目录");
    expect(page).toContain("会话和应用配置保存在此。");
    expect(page).not.toMatch(/settings-label">项目[\s\S]*?>工作文件夹</);
    expect(page).not.toContain(">数据保存在<");
  });
});
