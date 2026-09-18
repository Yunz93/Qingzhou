import type { PiPackageCatalogItem } from "@qingzhou/protocol";

/** Prefer these when download counts are missing (npm fallback / fixture). */
export const HOT_PACKAGE_SOURCE_HINTS = [
  "npm:pi-web-access",
  "npm:pi-memory",
  "npm:@juicesharp/rpiv-todo",
  "npm:pi-subagents",
  "npm:pi-mcp-adapter",
  "npm:context-mode",
] as const;

const hintRank = new Map(
  HOT_PACKAGE_SOURCE_HINTS.map((source, index) => [source.toLowerCase(), index]),
);

function rank(item: PiPackageCatalogItem): number {
  return hintRank.get(item.source.toLowerCase()) ?? Number.POSITIVE_INFINITY;
}

/** Top packages for the package-center "热门" section. */
export function hotPackageItems(
  items: PiPackageCatalogItem[],
  limit = 8,
): PiPackageCatalogItem[] {
  if (items.length === 0 || limit <= 0) return [];
  return [...items]
    .sort((a, b) => {
      const downloadsA = a.downloads ?? -1;
      const downloadsB = b.downloads ?? -1;
      if (downloadsA !== downloadsB) return downloadsB - downloadsA;
      const hint = rank(a) - rank(b);
      if (hint !== 0) return hint;
      return a.name.localeCompare(b.name);
    })
    .slice(0, Math.min(limit, items.length));
}
