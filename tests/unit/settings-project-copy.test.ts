import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("settings project copy", () => {
  it("explains default workspace vs per-session folders and app data", () => {
    const page = readFileSync(path.resolve("apps/web/src/pages/SettingsPage.tsx"), "utf8");
    expect(page).toContain("默认工作文件夹");
    expect(page).toContain("新建对话或任务时的默认目录");
    expect(page).toContain("每个会话仍可选用其它文件夹");
    expect(page).toContain("信任默认工作区");
    expect(page).toContain("仅作用于下方默认文件夹");
    expect(page).toContain('aria-label="信任当前项目"');
    expect(page).toContain("应用数据目录");
    expect(page).toContain("不是你的代码项目");
    expect(page).not.toMatch(/settings-label">项目[\s\S]*?>工作文件夹</);
    expect(page).not.toContain(">数据保存在<");
  });
});
