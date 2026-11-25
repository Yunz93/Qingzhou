import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeBrowserUrl } from "../../apps/web/src/lib/browser-url";

describe("normalizeBrowserUrl", () => {
  it("adds http for local hosts and https otherwise", () => {
    expect(normalizeBrowserUrl("127.0.0.1:5173")).toBe("http://127.0.0.1:5173/");
    expect(normalizeBrowserUrl("localhost:4310/health")).toBe("http://localhost:4310/health");
    expect(normalizeBrowserUrl("192.168.1.8:3000")).toBe("http://192.168.1.8:3000/");
    expect(normalizeBrowserUrl("example.com")).toBe("https://example.com/");
    expect(normalizeBrowserUrl("https://example.com/path")).toBe("https://example.com/path");
  });

  it("rejects script and local file URLs", () => {
    expect(normalizeBrowserUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeBrowserUrl("data:text/html,hi")).toBeNull();
    expect(normalizeBrowserUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeBrowserUrl("")).toBeNull();
  });
});

describe("inspector browser", () => {
  it("opens desktop websites in an isolated native window", () => {
    const browser = readFileSync(path.resolve("apps/web/src/components/inspector/InspectorBrowser.tsx"), "utf8");
    const desktop = readFileSync(path.resolve("apps/desktop/src-tauri/src/main.rs"), "utf8");
    expect(browser).toMatch(/preview\("open", url\)/);
    expect(browser).toContain("用系统浏览器打开");
    expect(desktop).toContain("WebviewWindowBuilder::new(&app, PREVIEW");
    expect(desktop).toContain(".incognito(true)");
    expect(desktop).toContain("!navigation_app.state::<Backend>().allows(url)");
  });
});
