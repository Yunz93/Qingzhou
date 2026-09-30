import { afterEach, expect, it, vi } from "vitest";
import { downloadPinnedSearchTool } from "../../apps/server/src/setup/pi-search-tools.ts";

vi.mock("../../apps/server/src/setup/pi-search-tools.ts", () => ({
  downloadPinnedSearchTool: vi.fn().mockResolvedValue("bundled-tool"),
}));
vi.mock("node:fs/promises", () => ({ mkdir: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.resetModules();
});

it.each([
  { argument: "x64", architecture: "x64" },
  { argument: "arm64", architecture: "arm64" },
  { argument: undefined, architecture: "arm64" },
])("downloads tools for target $architecture with argument $argument on an ARM host", async ({ argument, architecture }) => {
  vi.stubGlobal("process", new Proxy(process, {
    get: (target, key) => key === "arch" ? "arm64" : key === "argv" ? ["node", "bundle-pi-tools.ts", ...(argument ? [argument] : [])] : Reflect.get(target, key),
  }));
  await import("../../scripts/bundle-pi-tools.ts");
  expect(downloadPinnedSearchTool).toHaveBeenCalledTimes(2);
  for (const tool of ["fd", "rg"]) {
    expect(downloadPinnedSearchTool).toHaveBeenCalledWith(tool, expect.any(String), { architecture });
  }
});

it("rejects unsupported targets before downloading tools", async () => {
  vi.stubGlobal("process", new Proxy(process, {
    get: (target, key) => key === "argv" ? ["node", "bundle-pi-tools.ts", "unknown"] : Reflect.get(target, key),
  }));
  await expect(import("../../scripts/bundle-pi-tools.ts")).rejects.toThrow("Unsupported search tool architecture");
  expect(downloadPinnedSearchTool).not.toHaveBeenCalled();
});
