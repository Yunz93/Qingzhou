import {
  PI_PACKAGES_CATALOG_URL,
  normalizePackageSource,
  piPackageCatalogItemSchema,
  type PiPackageCatalogItem,
  type PiPackageCatalogResult,
} from "@qingzhou/protocol";
import { qingzhouEnv } from "../config.js";

const CATALOG_TIMEOUT_MS = 12_000;
const CATALOG_TTL_MS = 5 * 60 * 1000;
const NPM_SEARCH_URL = "https://registry.npmjs.org/-/v1/search?text=keywords:pi-package&size=250";
const USER_AGENT = "qingzhou-pi-packages";

export const E2E_PI_PACKAGE_CATALOG: PiPackageCatalogItem[] = [
  {
    name: "pi-web-access",
    source: "npm:pi-web-access",
    summary: "Web search, URL fetching, GitHub cloning, and PDF extraction for Pi.",
    types: ["extension"],
    href: "https://pi.dev/packages/pi-web-access",
  },
  {
    name: "pi-memory",
    source: "npm:pi-memory",
    summary: "Long-term memory, daily logs, and scratchpad for Pi.",
    types: ["extension"],
    href: "https://pi.dev/packages/pi-memory",
  },
];

let cache: { at: number; result: PiPackageCatalogResult } | null = null;

export function clearPiPackageCatalogCache(): void {
  cache = null;
}

export function piPackagesCatalogUrl(env: NodeJS.ProcessEnv = process.env): string {
  return qingzhouEnv(env, "PI_PACKAGES_URL")?.trim() || PI_PACKAGES_CATALOG_URL;
}

export function shouldUsePiPackageCatalogFixture(env: NodeJS.ProcessEnv = process.env): boolean {
  return qingzhouEnv(env, "E2E") === "1";
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function attr(block: string, name: string): string {
  const match = block.match(new RegExp(`\\b${name}="([^"]*)"`, "i"));
  return match ? decodeHtml(match[1] ?? "") : "";
}

function classText(block: string, className: string): string {
  const match = block.match(
    new RegExp(`class="[^"]*\\b${className}\\b[^"]*"[^>]*>([\\s\\S]*?)</`, "i"),
  );
  return decodeHtml((match?.[1] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
}

function sourceFromCopy(copy: string): string | null {
  const match = copy.match(/\bpi\s+install\s+(\S+)/i);
  if (!match?.[1]) return null;
  const source = normalizePackageSource(match[1]);
  return source || null;
}

export function parsePiPackagesHtml(html: string): PiPackageCatalogItem[] {
  const items: PiPackageCatalogItem[] = [];
  const seen = new Set<string>();
  const articleRe = /<article\b[^>]*\bdata-package-card="true"[^>]*>[\s\S]*?<\/article>/gi;
  for (const match of html.matchAll(articleRe)) {
    const block = match[0];
    const name = attr(block, "data-package-name");
    if (!name) continue;
    const source = sourceFromCopy(attr(block, "data-copy-text")) ?? normalizePackageSource(name);
    const key = source.toLowerCase();
    if (!source || seen.has(key)) continue;
    seen.add(key);
    const pathAttr = attr(block, "data-package-path") || `/packages/${name}`;
    const href = pathAttr.startsWith("http")
      ? pathAttr
      : `https://pi.dev${pathAttr.startsWith("/") ? pathAttr : `/${pathAttr}`}`;
    const downloadsRaw = attr(block, "data-package-downloads");
    const downloads = downloadsRaw ? Number(downloadsRaw) : Number.NaN;
    const parsed = piPackageCatalogItemSchema.safeParse({
      name,
      source,
      summary: classText(block, "packages-desc"),
      types: attr(block, "data-package-types").split(/\s+/).filter(Boolean),
      downloads: Number.isFinite(downloads) ? downloads : undefined,
      href,
    });
    if (parsed.success) items.push(parsed.data);
  }
  return items;
}

function parseNpmSearch(payload: unknown): PiPackageCatalogItem[] {
  if (!payload || typeof payload !== "object" || !("objects" in payload)) return [];
  const objects = (payload as { objects?: unknown }).objects;
  if (!Array.isArray(objects)) return [];
  const items: PiPackageCatalogItem[] = [];
  const seen = new Set<string>();
  for (const entry of objects) {
    if (!entry || typeof entry !== "object") continue;
    const pkg = (entry as { package?: unknown }).package;
    if (!pkg || typeof pkg !== "object") continue;
    const name = typeof (pkg as { name?: unknown }).name === "string" ? (pkg as { name: string }).name.trim() : "";
    if (!name) continue;
    const source = normalizePackageSource(name);
    const key = source.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const description =
      typeof (pkg as { description?: unknown }).description === "string"
        ? (pkg as { description: string }).description.trim()
        : "";
    const parsed = piPackageCatalogItemSchema.safeParse({
      name,
      source,
      summary: description,
      types: [],
      href: `https://pi.dev/packages/${name}`,
    });
    if (parsed.success) items.push(parsed.data);
  }
  return items;
}

async function fetchText(
  url: string,
  fetchImpl: typeof fetch,
  headers?: Record<string, string>,
): Promise<string> {
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
    redirect: "follow",
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/json;q=0.9,*/*;q=0.8",
      ...headers,
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

export async function fetchPiPackageCatalog(input: {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: number;
  skipCache?: boolean;
} = {}): Promise<PiPackageCatalogResult> {
  const env = input.env ?? process.env;
  if (shouldUsePiPackageCatalogFixture(env)) {
    return { items: E2E_PI_PACKAGE_CATALOG, source: "fixture" };
  }

  const now = input.now ?? Date.now();
  if (!input.skipCache && cache && now - cache.at < CATALOG_TTL_MS) {
    return cache.result;
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const catalogUrl = piPackagesCatalogUrl(env);
  let lastError: unknown;
  try {
    const html = await fetchText(catalogUrl, fetchImpl);
    const items = parsePiPackagesHtml(html);
    if (items.length > 0) {
      const result: PiPackageCatalogResult = { items, source: "pi.dev" };
      cache = { at: now, result };
      return result;
    }
  } catch (error) {
    lastError = error;
  }

  try {
    const body = await fetchText(NPM_SEARCH_URL, fetchImpl, { accept: "application/json" });
    const items = parseNpmSearch(JSON.parse(body) as unknown);
    if (items.length > 0) {
      const result: PiPackageCatalogResult = { items, source: "npm" };
      cache = { at: now, result };
      return result;
    }
  } catch (error) {
    lastError = error;
  }

  const detail = lastError instanceof Error ? lastError.message : "";
  throw new Error(detail ? `无法加载插件中心。${detail}` : "无法加载插件中心。请检查网络后重试。");
}
