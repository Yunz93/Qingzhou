import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const cssPath = path.resolve("apps/web/src/styles/app.css");

function stripLayer(source: string, layerName: string): { layered: string; rest: string } {
  const marker = `@layer ${layerName}`;
  const start = source.indexOf(marker);
  if (start < 0) return { layered: "", rest: source };
  let i = source.indexOf("{", start);
  if (i < 0) return { layered: "", rest: source };
  let depth = 0;
  for (; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          layered: source.slice(start, i + 1),
          rest: source.slice(0, start) + source.slice(i + 1),
        };
      }
    }
  }
  return { layered: source.slice(start), rest: source.slice(0, start) };
}

describe("macOS traffic-light inset", () => {
  it("is declared outside @layer components so Tailwind px/pl utilities cannot cover the lights", () => {
    const css = readFileSync(cssPath, "utf8");
    const { layered, rest } = stripLayer(css, "components");
    expect(layered).not.toMatch(/\.traffic-inline/);
    expect(rest).toMatch(
      /html\.desktop\[data-platform="darwin"\]\s+\.traffic-inline\s*\{[^}]*padding-left:\s*var\(--traffic-lights-inset\)\s*!important/,
    );
    expect(rest).toMatch(/--traffic-lights-inset:\s*80px/);
  });

  it("insets the conversation titlebar when the session list is not docked", () => {
    const layout = readFileSync(path.resolve("apps/web/src/layouts/WorkbenchLayout.tsx"), "utf8");
    expect(layout).toMatch(/dockLeft \? "" : "traffic-inline"/);
    expect(layout).toMatch(/MessageSquare[\s\S]*会话/);
    expect(layout).toMatch(/titlebar-meta/);
    expect(layout).toMatch(/titlebar-work-link/);
    expect(layout).toMatch(/flex shrink-0 items-center gap-0\.5/);
    expect(layout).not.toMatch(/className="chip app-no-drag/);
    expect(layout).not.toMatch(/已加载 AGENTS\.md/);
  });

  it("tags Electron shells before React mounts and falls back without preload", () => {
    const html = readFileSync(path.resolve("apps/web/index.html"), "utf8");
    expect(html).toMatch(/Electron/i);
    expect(html).toMatch(/dataset\.platform/);
    expect(html).toMatch(/classList\.toggle\("desktop"/);

    const bridge = readFileSync(path.resolve("apps/web/src/desktop-bridge.ts"), "utf8");
    expect(bridge).toMatch(/platformFromUserAgent/);
    expect(bridge).toMatch(/applyDesktopDocumentAttrs/);

    const desktopMain = readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    expect(desktopMain).toMatch(/insertCSS/);
    expect(desktopMain).toMatch(/traffic-inline/);

    const bundle = readFileSync(path.resolve("apps/desktop/scripts/bundle.mjs"), "utf8");
    expect(bundle).toMatch(/format:\s*"cjs"/);
    expect(bundle).toMatch(/index\.cjs/);
  });
});
