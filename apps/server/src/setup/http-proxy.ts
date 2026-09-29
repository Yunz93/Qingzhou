import * as undici from "undici";

const LOCAL_NO_PROXY = "127.0.0.1,localhost,::1";

export function readProxyUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const proxy =
    env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || env.ALL_PROXY || env.all_proxy;
  const trimmed = proxy?.trim() ?? "";
  return trimmed || null;
}

/** Copy ALL_PROXY into HTTPS_PROXY and keep loopback off the proxy. */
export function normalizeProxyEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const proxy = readProxyUrl(env);
  if (!proxy) return null;
  if (!env.HTTPS_PROXY && !env.https_proxy) env.HTTPS_PROXY = proxy;
  if (!env.HTTP_PROXY && !env.http_proxy) env.HTTP_PROXY = proxy;
  if (!env.NO_PROXY && !env.no_proxy) env.NO_PROXY = LOCAL_NO_PROXY;
  return proxy;
}

/** Parse Chromium/Electron `resolveProxy` output (`PROXY host:port; DIRECT`). */
export function parsePacProxyResult(result: string): string | null {
  const token = result.split(";")[0]?.trim() ?? "";
  if (!token || /^DIRECT$/i.test(token)) return null;
  const match = token.match(/^(PROXY|HTTPS|HTTP|SOCKS5|SOCKS4|SOCKS)\s+(\S+)/i);
  if (!match?.[2]) return null;
  // Clash mixed-port accepts HTTP CONNECT on the same port as SOCKS.
  return `http://${match[2]}`;
}

export function isUnsupportedRegionError(raw: string): boolean {
  return /unsupported_country_region_territory|territory not supported/i.test(raw);
}

export function humanizeUnsupportedRegionError(error: unknown): string | null {
  const raw = error instanceof Error ? error.message : String(error);
  if (!isUnsupportedRegionError(raw)) return null;
  return [
    "OpenAI 拒绝了这个地区的请求（HTTP 403 unsupported_country_region_territory）。",
    "浏览器登录会走系统代理，轻舟换 token 和后续 API 默认不走。",
    "请设置 HTTPS_PROXY（例如 http://127.0.0.1:7890），或让系统代理对所有应用生效后重启轻舟。",
  ].join("\n");
}

export async function applyEnvHttpProxy(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const proxy = normalizeProxyEnv(env);
  if (!proxy) return null;
  try {
    if (typeof undici.EnvHttpProxyAgent === "function" && typeof undici.setGlobalDispatcher === "function") {
      undici.setGlobalDispatcher(new undici.EnvHttpProxyAgent());
    } else if (typeof undici.ProxyAgent === "function" && typeof undici.setGlobalDispatcher === "function") {
      undici.setGlobalDispatcher(new undici.ProxyAgent(proxy));
    }
  } catch {
    // Env is still set so child processes and https.request can pick it up.
  }
  return proxy;
}

/**
 * Outbound fetch that honors HTTP(S)_PROXY via undici's EnvHttpProxyAgent.
 * Electron/Node global `fetch` may ignore the npm-undici dispatcher, so callers that
 * must reach the public internet (plugin catalog, GitHub) should use this helper.
 */
export async function proxiedFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const proxy = readProxyUrl();
  if (proxy) {
    const dispatcher = new undici.EnvHttpProxyAgent();
    return (await undici.fetch(input as never, { ...init, dispatcher } as never)) as unknown as Response;
  }
  return fetch(input, init);
}
