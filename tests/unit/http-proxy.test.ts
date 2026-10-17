import { createServer } from "node:http";
import { describe, expect, it, vi } from "vitest";
import {
  isUnsupportedRegionError,
  normalizeProxyEnv,
  parsePacProxyResult,
  proxiedFetch,
  readProxyUrl,
} from "../../apps/server/src/setup/http-proxy.ts";
import { humanizeAuthHttpError, humanizeUserFacingError } from "../../apps/server/src/setup/pi-agent-dir.ts";

describe("HTTP proxy and region errors", () => {
  it("parses Chromium PAC proxy results", () => {
    expect(parsePacProxyResult("DIRECT")).toBeNull();
    expect(parsePacProxyResult("PROXY 127.0.0.1:7890; DIRECT")).toBe("http://127.0.0.1:7890");
    expect(parsePacProxyResult("HTTPS 127.0.0.1:7890")).toBe("http://127.0.0.1:7890");
    expect(parsePacProxyResult("SOCKS5 127.0.0.1:7890")).toBe("http://127.0.0.1:7890");
  });

  it("copies ALL_PROXY into HTTPS_PROXY and keeps localhost direct", () => {
    const env: NodeJS.ProcessEnv = { ALL_PROXY: "http://127.0.0.1:7890" };
    expect(readProxyUrl(env)).toBe("http://127.0.0.1:7890");
    expect(normalizeProxyEnv(env)).toBe("http://127.0.0.1:7890");
    expect(env.HTTPS_PROXY).toBe("http://127.0.0.1:7890");
    expect(env.NO_PROXY).toMatch(/127\.0\.0\.1/);
  });

  it("does not treat OpenAI geo 403 as a bad API key", () => {
    const raw =
      'OpenAI Codex token exchange failed (403): {"error":{"code":"unsupported_country_region_territory","message":"Country, region, or territory not supported","type":"request_forbidden"}}';
    expect(isUnsupportedRegionError(raw)).toBe(true);
    expect(humanizeAuthHttpError(raw)).toBeNull();
    const text = humanizeUserFacingError(new Error(raw));
    expect(text).toMatch(/unsupported_country_region_territory/);
    expect(text).toMatch(/HTTPS_PROXY/);
    expect(text).not.toMatch(/密钥没有权限/);
  });

  it("routes proxiedFetch through the proxy when HTTPS_PROXY is set", async () => {
    const destinations: string[] = [];
    const proxy = createServer();
    proxy.on("connect", (request, socket) => {
      destinations.push(request.url ?? "");
      socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
    });
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    const address = proxy.address();
    if (!address || typeof address === "string") throw new Error("missing proxy port");
    const proxyUrl = `http://127.0.0.1:${address.port}`;
    // EnvHttpProxyAgent gives lowercase variables precedence. Isolate both
    // spellings so an inherited developer/CI proxy cannot escape this fixture.
    for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"]) vi.stubEnv(name, proxyUrl);
    for (const name of ["NO_PROXY", "no_proxy"]) vi.stubEnv(name, "127.0.0.1,localhost,::1");
    try {
      await expect(proxiedFetch("https://qingzhou-proxy.invalid", { signal: AbortSignal.timeout(2000) })).rejects.toThrow();
      expect(destinations).toEqual(["qingzhou-proxy.invalid:443"]);
    } finally {
      vi.unstubAllEnvs();
      await new Promise<void>((resolve, reject) => proxy.close((error) => error ? reject(error) : resolve()));
    }
  });
});
