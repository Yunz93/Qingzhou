import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("native terminal and in-app updates", () => {
  it("renders the inspector terminal with xterm.js", () => {
    const src = readFileSync(path.resolve("apps/web/src/components/inspector/InspectorTerminal.tsx"), "utf8");
    expect(src).toContain("@xterm/xterm");
    expect(src).toContain("addon-fit");
    expect(src).toContain("allowTransparency: true");
    expect(src).toContain('aria-label", "终端"');
    expect(src).toContain("term-xterm-frame");
    expect(src).toContain("overviewRuler");
    // PTY must start after fit with measured cols/rows — default 80×24 then resize leaves blank rows.
    expect(src).toMatch(/fit\.fit\(\);\s*\n\s*await socketClient\.send\("term\.start"/);
    expect(src).not.toContain("term-input");
  });

  it("checks for updates on launch and from the desktop menu", () => {
    const banner = readFileSync(path.resolve("apps/web/src/components/app/UpdateBanner.tsx"), "utf8");
    const bridge = readFileSync(path.resolve("apps/web/src/components/desktop/DesktopMenuBridge.tsx"), "utf8");
    const store = readFileSync(path.resolve("apps/web/src/stores/update-store.ts"), "utf8");
    const settings = readFileSync(path.resolve("apps/web/src/components/settings/AppUpdateSection.tsx"), "utf8");
    const progress = readFileSync(path.resolve("apps/web/src/components/settings/UpdateProgressPanel.tsx"), "utf8");
    expect(banner).toContain("更新并重启");
    expect(banner).toContain("忽略");
    expect(banner).toContain("skippedUpdateVersion");
    expect(bridge).toContain("onCheckUpdate");
    expect(bridge).toContain("hydrate");
    expect(bridge).toContain("autoCheckForUpdates");
    expect(bridge).toContain("requestIdleCallback");
    expect(store).toContain("https://github.com/Yunz93/Qingzhou/releases");
    expect(store).toContain("text/event-stream");
    expect(settings).toContain("立即检查");
    expect(settings).toContain("下载安装更新");
    expect(settings).toContain("忽略这个版本");
    expect(settings).toContain("发布说明");
    expect(settings).toContain("启动后自动检查更新");
    expect(progress).toContain("更新进度");
    expect(progress).toContain("正在下载安装包");
  });
});
