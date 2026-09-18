import { describe, expect, it } from "vitest";
import { hotPackageItems } from "../../apps/web/src/lib/package-center.ts";
import type { PiPackageCatalogItem } from "@qingzhou/protocol";

function item(
  name: string,
  downloads?: number,
  source = `npm:${name}`,
): PiPackageCatalogItem {
  return {
    name,
    source,
    summary: name,
    types: ["extension"],
    downloads,
    href: `https://pi.dev/packages/${name}`,
  };
}

describe("hotPackageItems", () => {
  it("ranks by downloads and keeps a hot section", () => {
    const hot = hotPackageItems(
      [item("low", 10), item("mid", 50), item("top", 900), item("also-low", 5)],
      2,
    );
    expect(hot.map((entry) => entry.name)).toEqual(["top", "mid"]);
  });

  it("falls back to known popular sources when downloads are missing", () => {
    const hot = hotPackageItems(
      [
        item("context-mode", undefined, "npm:context-mode"),
        item("other"),
        item("pi-web-access", undefined, "npm:pi-web-access"),
      ],
      2,
    );
    expect(hot.map((entry) => entry.source)).toEqual(["npm:pi-web-access", "npm:context-mode"]);
  });
});
