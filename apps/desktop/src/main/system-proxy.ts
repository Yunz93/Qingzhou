import { session } from "electron";
import { normalizeProxyEnv, parsePacProxyResult, readProxyUrl } from "@qingzhou/server";

/** Hosts that skill updates / plugin catalog / auth need through the system proxy. */
export const SYSTEM_PROXY_PROBE_URLS = [
  "https://api.github.com",
  "https://api.openai.com",
  "https://pi.dev",
  "https://registry.npmjs.org",
] as const;

/** If the user did not set HTTP(S)_PROXY, copy the OS/Clash system proxy into env. */
export async function adoptSystemProxy(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  if (readProxyUrl(env)) return normalizeProxyEnv(env);
  try {
    for (const target of SYSTEM_PROXY_PROBE_URLS) {
      const pac = await session.defaultSession.resolveProxy(target);
      const proxy = parsePacProxyResult(pac);
      if (!proxy) continue;
      env.HTTPS_PROXY = proxy;
      env.HTTP_PROXY = env.HTTP_PROXY ?? proxy;
      return normalizeProxyEnv(env);
    }
    return null;
  } catch {
    return null;
  }
}
