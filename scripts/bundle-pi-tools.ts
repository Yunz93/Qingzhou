import { mkdir } from "node:fs/promises";
import path from "node:path";
import { downloadPinnedSearchTool } from "../apps/server/src/setup/pi-search-tools.ts";

const architecture = process.argv[2] ?? process.arch;
if (architecture !== "x64" && architecture !== "arm64") {
  throw new Error(`Unsupported search tool architecture: ${architecture}`);
}

const dest = path.resolve("apps/desktop/vendor/tools");
await mkdir(dest, { recursive: true });

console.log("Downloading pinned fd and ripgrep for", architecture, "into", dest);
for (const tool of ["fd", "rg"] as const) {
  const installed = await downloadPinnedSearchTool(tool, dest, { architecture });
  console.log("bundled", tool, "->", installed);
}
