import * as esbuild from "esbuild";
import { cpSync, chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

await esbuild.build({
  entryPoints: ["src/main/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "out/main/index.js",
  external: ["electron", "node-pty"],
  sourcemap: true,
  banner: {
    js: "import { createRequire as __qingzhouCreateRequire } from 'node:module'; const require = __qingzhouCreateRequire(import.meta.url);",
  },
});

// node-pty contains platform native binaries. Keep the package beside the
// bundled main process so electron-builder can ship it inside the asar.
const ptyRoot = path.resolve(path.dirname(require.resolve("node-pty")), "..");
const bundledPty = path.resolve("out/main/pty-runtime");
mkdirSync(bundledPty, { recursive: true });
cpSync(ptyRoot, bundledPty, { recursive: true });
if (process.platform !== "win32") {
  try { chmodSync(path.join(bundledPty, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"), 0o755); } catch { /* optional prebuild */ }
}

await esbuild.build({
  entryPoints: ["src/preload/index.ts"],
  bundle: true,
  platform: "node",
  // CJS preload is more reliable with sandbox:true across Electron versions.
  format: "cjs",
  outfile: "out/preload/index.cjs",
  external: ["electron"],
  sourcemap: true,
});

console.log("bundled Electron main and preload");
