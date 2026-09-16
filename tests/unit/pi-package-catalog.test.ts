import { afterEach, describe, expect, it } from "vitest";
import {
  clearPiPackageCatalogCache,
  fetchPiPackageCatalog,
  parsePiPackagesHtml,
  shouldUsePiPackageCatalogFixture,
} from "../../apps/server/src/tasks/pi-package-catalog.ts";

const SAMPLE_HTML = `
<article class="surface-panel content-card" data-package-card="true" data-package-name="pi-web-access" data-package-types="extension" data-package-downloads="435217" data-package-path="/packages/pi-web-access">
  <h3 class="packages-name">pi-web-access</h3>
  <p class="packages-desc">Web search, URL fetching, and PDF extraction</p>
  <button type="button" data-copy-text="pi install npm:pi-web-access">Copy</button>
</article>
<article class="surface-panel content-card" data-package-card="true" data-package-name="@juicesharp/rpiv-todo" data-package-types="extension" data-package-downloads="147600" data-package-path="/packages/@juicesharp/rpiv-todo">
  <h3 class="packages-name">@juicesharp/rpiv-todo</h3>
  <p class="packages-desc">A todo list for the model</p>
  <button type="button" data-copy-text="pi install npm:@juicesharp/rpiv-todo">Copy</button>
</article>
`;

afterEach(() => {
  clearPiPackageCatalogCache();
});

describe("pi package catalog", () => {
  it("parses package cards from pi.dev HTML", () => {
    const items = parsePiPackagesHtml(SAMPLE_HTML);
    expect(items.map((item) => item.name)).toEqual(["pi-web-access", "@juicesharp/rpiv-todo"]);
    expect(items[0]).toMatchObject({
      source: "npm:pi-web-access",
      summary: "Web search, URL fetching, and PDF extraction",
      types: ["extension"],
      downloads: 435217,
      href: "https://pi.dev/packages/pi-web-access",
    });
    expect(items[1]?.source).toBe("npm:@juicesharp/rpiv-todo");
  });

  it("uses the e2e fixture instead of the network", async () => {
    expect(shouldUsePiPackageCatalogFixture({ QINGZHOU_E2E: "1" })).toBe(true);
    const result = await fetchPiPackageCatalog({ env: { QINGZHOU_E2E: "1" } });
    expect(result.source).toBe("fixture");
    expect(result.items.some((item) => item.source === "npm:pi-web-access")).toBe(true);
  });

  it("falls back to npm search when pi.dev HTML has no cards", async () => {
    const fetchImpl: typeof fetch = async (url) => {
      const href = String(url);
      if (href.includes("registry.npmjs.org")) {
        return new Response(
          JSON.stringify({
            objects: [
              {
                package: {
                  name: "pi-lens",
                  description: "Real-time code feedback",
                },
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("<html><body>no cards</body></html>", { status: 200 });
    };
    const result = await fetchPiPackageCatalog({ fetchImpl, skipCache: true, env: {} });
    expect(result.source).toBe("npm");
    expect(result.items).toEqual([
      {
        name: "pi-lens",
        source: "npm:pi-lens",
        summary: "Real-time code feedback",
        types: [],
        href: "https://pi.dev/packages/pi-lens",
      },
    ]);
  });
});
