import { describe, expect, it } from "vitest";
import { getDesktop, systemPlatform } from "../../apps/web/src/desktop-bridge.ts";

describe("desktop bridge", () => {
  it("identifies the platform of the system webview", () => {
    expect(systemPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15")).toBe("darwin");
    expect(systemPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/138.0")).toBe("win32");
    expect(systemPlatform("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit")).toBe("linux");
  });

  it("does not expose native commands in a browser or server context", () => {
    expect(getDesktop()).toBeNull();
  });
});
