import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readTheme, toggleTheme } from "../../apps/web/src/lib/theme.ts";
import { resolveCssColor, termTheme, TERM_TRANSPARENT_BG } from "../../apps/web/src/lib/term-theme.ts";

describe("theme", () => {
  it("defaults to light when storage and system preference are unavailable", () => {
    expect(readTheme()).toBe("light");
  });

  it("toggles between dark and light", () => {
    expect(toggleTheme("dark")).toBe("light");
    expect(toggleTheme("light")).toBe("dark");
  });

  it("gives the terminal a light palette and a dark palette", () => {
    expect(termTheme("light").background).toBe(TERM_TRANSPARENT_BG);
    expect(termTheme("dark").background).toBe(TERM_TRANSPARENT_BG);
    expect(resolveCssColor("var(--color-ink)", "#abc")).toBe("#abc");
    expect(termTheme("light").foreground).not.toBe(termTheme("dark").foreground);
    const term = readFileSync(path.resolve("apps/web/src/components/inspector/InspectorTerminal.tsx"), "utf8");
    const styles = readFileSync(path.resolve("apps/web/src/styles/app.css"), "utf8");
    expect(term).toContain("useTheme");
    expect(term).toContain("termTheme(theme)");
    expect(term).toContain("allowTransparency: true");
    expect(styles).toMatch(/\.term-shell\s*\{[^}]*background:\s*transparent/);
    expect(styles).toMatch(/\.term-head\s*\{[^}]*background:\s*transparent/);
    expect(styles).toMatch(/\.term-xterm \.xterm-viewport\s*\{[^}]*background:\s*transparent/);
    expect(styles).toMatch(/\.term-xterm-frame\s*\{[^}]*padding:\s*0 10px 10px/);
    expect(styles).toMatch(/\.term-xterm\s*\{[^}]*padding:\s*0;/);
    expect(styles).not.toMatch(/always-dark terminal/);
    expect(term).toContain("overviewRuler");
    expect(term).toContain("term-xterm-frame");
    expect(term).toMatch(/term\.start[\s\S]*cols:\s*term\.cols/);
  });
});

