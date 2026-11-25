import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
});

it.each([
  [undefined, 4310],
  ["4378", 4378],
])("uses the service port %s for all Vite development proxies", async (port, expectedPort) => {
  vi.stubEnv("PORT", port);
  vi.resetModules();
  const { default: config } = await import("../../apps/web/vite.config.ts");

  expect(config.server?.proxy).toEqual({
    "/ws": { target: `ws://127.0.0.1:${expectedPort}`, ws: true },
    "/api": { target: `http://127.0.0.1:${expectedPort}` },
    "/uploads": { target: `http://127.0.0.1:${expectedPort}` },
    "/health": { target: `http://127.0.0.1:${expectedPort}` },
  });
});
