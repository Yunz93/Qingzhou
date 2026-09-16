import { z } from "zod";

export const PI_PACKAGES_CATALOG_URL = "https://pi.dev/packages";

export function normalizePackageSource(source: string): string {
  const trimmed = source.trim();
  if (!trimmed) return "";
  if (
    trimmed.startsWith("npm:") ||
    trimmed.startsWith("git:") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("file:") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../") ||
    trimmed.startsWith("/")
  ) {
    return trimmed;
  }
  return `npm:${trimmed}`;
}

export function packageSourcesEqual(a: string, b: string): boolean {
  return normalizePackageSource(a).toLowerCase() === normalizePackageSource(b).toLowerCase();
}

export function npmPackageName(source: string): string | null {
  const normalized = normalizePackageSource(source);
  if (!normalized.startsWith("npm:")) return null;
  const name = normalized.slice(4).trim();
  return name || null;
}

export function packageSourceNames(source: string): string[] {
  const npmName = npmPackageName(source);
  if (!npmName) return [];
  const names = new Set<string>([npmName]);
  if (npmName.includes("/")) names.add(npmName.slice(npmName.lastIndexOf("/") + 1));
  return [...names];
}

export function packageSourceInstalled(
  source: string,
  packages: Array<{ source: string }>,
  extensions: Array<{ name: string }> = [],
): boolean {
  if (packages.some((item) => packageSourcesEqual(item.source, source))) return true;
  const names = new Set(packageSourceNames(source).map((name) => name.toLowerCase()));
  if (names.size === 0) return false;
  return extensions.some((item) => names.has(item.name.toLowerCase()));
}

export const piPackageCatalogItemSchema = z.object({
  name: z.string().min(1),
  source: z.string().min(1),
  summary: z.string().default(""),
  types: z.array(z.string()).default([]),
  downloads: z.number().int().nonnegative().optional(),
  href: z.string().min(1),
});
export type PiPackageCatalogItem = z.infer<typeof piPackageCatalogItemSchema>;

export const piPackageCatalogResultSchema = z.object({
  items: z.array(piPackageCatalogItemSchema),
  source: z.enum(["pi.dev", "npm", "fixture"]),
});
export type PiPackageCatalogResult = z.infer<typeof piPackageCatalogResultSchema>;
