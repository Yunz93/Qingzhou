import { describe, expect, it } from "vitest";
import { platformFromUserAgent } from "../../apps/web/src/desktop-bridge.ts";

describe("desktop bridge", () => {
  it("reads platform from Electron user agents without preload", () => {
    expect(platformFromUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Electron/37.0.0")).toBe(
      "darwin",
    );
    expect(platformFromUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Electron/37.0.0")).toBe("win32");
    expect(platformFromUserAgent("Mozilla/5.0 (X11; Linux x86_64) Electron/37.0.0")).toBe("linux");
    expect(platformFromUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15")).toBe(
      null,
    );
  });
});
