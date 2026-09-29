import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

export function applyDesktopEnv(): void {
  process.env.QINGZHOU_DESKTOP = "1";
  process.env.HOST = process.env.HOST ?? "127.0.0.1";
  process.env.PORT = process.env.PORT ?? "4310";
  process.env.QINGZHOU_VERSION = process.env.QINGZHOU_VERSION ?? app.getVersion();
  if (app.isPackaged) {
    process.env.NODE_ENV = "production";
  } else if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = "development";
  }

  process.env.QINGZHOU_WEB_DIST = webDistDir();
  process.env.QINGZHOU_APPROVAL_EXTENSION = approvalExtensionPath();
  process.env.QINGZHOU_EXEC_PATH = app.getPath("exe");
  const appPath = packagedAppPath();
  if (appPath) process.env.QINGZHOU_APP_PATH = appPath;

  const piEntry = resolvePiEntry();
  if (piEntry) {
    process.env.QINGZHOU_PI_ENTRY = piEntry;
    // Electron-as-Node. Prefer Helper.app on macOS (LSUIElement) so children
    // do not appear in the Dock as generic "exec" icons.
    process.env.QINGZHOU_NODE_BIN = macosElectronHelperBin(process.execPath);
    process.env.QINGZHOU_PI_BUNDLED = "1";
  }
  const toolsDir = resolvePiToolsDir();
  if (toolsDir) {
    process.env.QINGZHOU_PI_TOOLS = toolsDir;
  }
}

export function macosBundlePathFromExecPath(execPath: string): string | null {
  const match = execPath.match(/^(.*\.app)(?=\/Contents\/MacOS\/)/);
  return match?.[1] ?? null;
}

/** Helper.app has LSUIElement, so Node children do not take a Dock slot. */
export function macosElectronHelperBin(execPath: string): string {
  const bundle = macosBundlePathFromExecPath(execPath);
  if (!bundle) return execPath;
  const product = path.basename(execPath);
  for (const name of [`${product} Helper`, "Electron Helper"]) {
    const helper = path.join(bundle, "Contents", "Frameworks", `${name}.app`, "Contents", "MacOS", name);
    if (fs.existsSync(helper)) return helper;
  }
  return execPath;
}

export function packagedAppPath(): string | null {
  if (!app.isPackaged) return null;
  if (process.platform === "darwin") {
    return macosBundlePathFromExecPath(app.getPath("exe"));
  }
  return path.dirname(app.getPath("exe"));
}

export function webDistDir(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, "web");
  return path.resolve(app.getAppPath(), "../web/dist");
}

export function approvalExtensionPath(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, "approval.ts");
  return path.resolve(app.getAppPath(), "../server/extensions/approval.ts");
}

export function resolvePiEntry(): string | null {
  const candidates = [
    app.isPackaged
      ? path.join(
          process.resourcesPath,
          "pi",
          "node_modules",
          "@earendil-works",
          "pi-coding-agent",
          "dist",
          "cli.js",
        )
      : path.resolve(app.getAppPath(), "vendor/pi/node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
    path.resolve(app.getAppPath(), "../../node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function resolvePiToolsDir(): string | null {
  const candidates = [
    app.isPackaged
      ? path.join(process.resourcesPath, "tools")
      : path.resolve(app.getAppPath(), "vendor/tools"),
    path.resolve(app.getAppPath(), "vendor/tools"),
  ];
  for (const candidate of candidates) {
    if (
      fs.existsSync(path.join(candidate, "fd")) ||
      fs.existsSync(path.join(candidate, "fd.exe")) ||
      fs.existsSync(path.join(candidate, "rg")) ||
      fs.existsSync(path.join(candidate, "rg.exe"))
    ) {
      return candidate;
    }
  }
  return null;
}

export function preloadPath(mainDir: string): string {
  const cjs = path.join(mainDir, "../preload/index.cjs");
  if (fs.existsSync(cjs)) return cjs;
  return path.join(mainDir, "../preload/index.js");
}
