import { describe, expect, it } from "vitest";
import {
  normalizePackageSource,
  npmPackageName,
  packageSourceInstalled,
  packageSourceNames,
  packageSourcesEqual,
} from "../../packages/protocol/src/package-source.ts";

describe("package sources", () => {
  it("normalizes npm sources", () => {
    expect(normalizePackageSource("pi-memory")).toBe("npm:pi-memory");
    expect(packageSourcesEqual("pi-web-access", "npm:pi-web-access")).toBe(true);
    expect(npmPackageName("npm:@juicesharp/rpiv-todo")).toBe("@juicesharp/rpiv-todo");
    expect(packageSourceNames("npm:@juicesharp/rpiv-todo")).toEqual(["@juicesharp/rpiv-todo", "rpiv-todo"]);
  });

  it("detects installed packages by source or loaded extension name", () => {
    expect(packageSourceInstalled("npm:pi-web-access", [{ source: "npm:pi-web-access" }], [])).toBe(true);
    expect(packageSourceInstalled("pi-web-access", [], [{ name: "pi-web-access" }])).toBe(true);
    expect(packageSourceInstalled("npm:@juicesharp/rpiv-todo", [], [{ name: "rpiv-todo" }])).toBe(true);
    expect(packageSourceInstalled("npm:pi-memory", [], [{ name: "demo-ext" }])).toBe(false);
    expect(packageSourceInstalled("npm:pi-web-access", [], [])).toBe(false);
  });
});
