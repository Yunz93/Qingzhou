import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("native window chrome", () => {
  it("keeps new workbench controls below the native title bar", () => {
    const host = readFileSync(path.resolve("apps/desktop/src-tauri/src/main.rs"), "utf8");
    const layout = readFileSync(path.resolve("apps/web/src/layouts/WorkbenchLayout.tsx"), "utf8");
    expect(host).toMatch(/\.min_inner_size\(533\.0, 600\.0\)/);
    expect(host).not.toMatch(/TitleBarStyle::Overlay/);
    expect(layout).toMatch(/<WorkspaceToolbar>/);
    expect(layout).toMatch(/aria-label="打开导航"/);
    expect(layout).toMatch(/onPinToggle=\{isMd \? toggleLeftPinned : undefined\}/);
  });
});
