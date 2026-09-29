import { describe, expect, it } from "vitest";
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
    const prevHttps = process.env.HTTPS_PROXY;
    const prevHttp = process.env.HTTP_PROXY;
    process.env.HTTPS_PROXY = "http://127.0.0.1:9";
    process.env.HTTP_PROXY = "http://127.0.0.1:9";
    try {
      await expect(proxiedFetch("https://example.com", { signal: AbortSignal.timeout(2000) })).rejects.toThrow();
    } finally {
      if (prevHttps === undefined) delete process.env.HTTPS_PROXY;
      else process.env.HTTPS_PROXY = prevHttps;
      if (prevHttp === undefined) delete process.env.HTTP_PROXY;
      else process.env.HTTP_PROXY = prevHttp;
    }
  });
});
