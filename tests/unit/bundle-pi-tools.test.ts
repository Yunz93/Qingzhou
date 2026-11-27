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
  { args: ["x64"], architecture: "x64", platform: "darwin" },
  { args: ["arm64"], architecture: "arm64", platform: "darwin" },
  { args: [], architecture: "arm64", platform: "darwin" },
  { args: ["x64", "vendor/windows-tools", "win32"], architecture: "x64", platform: "win32" },
])("downloads $platform-$architecture tools with arguments $args on an ARM Mac", async ({ args, architecture, platform }) => {
  vi.stubGlobal("process", new Proxy(process, {
    get(target, key) {
      if (key === "arch") return "arm64";
      if (key === "platform") return "darwin";
      if (key === "argv") return ["node", "bundle-pi-tools.ts", ...args];
      return Reflect.get(target, key);
    },
  }));
  await import("../../scripts/bundle-pi-tools.ts");
  expect(downloadPinnedSearchTool).toHaveBeenCalledTimes(2);
  for (const tool of ["fd", "rg"]) {
    expect(downloadPinnedSearchTool).toHaveBeenCalledWith(tool, expect.any(String), { architecture, platform, includeNotices: true });
  }
});

it("rejects unsupported targets before downloading tools", async () => {
  vi.stubGlobal("process", new Proxy(process, {
    get: (target, key) => key === "argv" ? ["node", "bundle-pi-tools.ts", "unknown"] : Reflect.get(target, key),
  }));
  await expect(import("../../scripts/bundle-pi-tools.ts")).rejects.toThrow("Unsupported search tool architecture");
  expect(downloadPinnedSearchTool).not.toHaveBeenCalled();
});
