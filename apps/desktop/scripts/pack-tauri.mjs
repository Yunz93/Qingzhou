import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { proxiedFetch } from "../../server/dist/setup/http-proxy.js";
import { systemTar } from "../../server/dist/setup/system-tar.js";

const desktop = fileURLToPath(new URL("../", import.meta.url));
const root = path.resolve(desktop, "../..");
const release = path.join(desktop, "release");
const stagingRoot = path.join(desktop, "vendor");
const { productName, version } = JSON.parse(await readFile(path.join(desktop, "src-tauri/tauri.conf.json"), "utf8"));
const requireServer = createRequire(path.join(root, "apps/server/package.json"));
const requireRoot = createRequire(path.join(root, "package.json"));
const nodeVersion = "22.22.0";
const [requestedArch = "native", requiredPlatform] = process.argv.slice(2);
const arch = requestedArch === "native" ? process.arch : requestedArch;
const host = process.platform;
const tar = systemTar();
const platform = requiredPlatform ?? host;
const crossWindows = platform === "win32" && host === "darwin" && process.env.QINGZHOU_CROSS_WINDOWS === "1";
if (platform !== host && !crossWindows) {
  throw new Error(`此构建需要在 ${platform} 上运行。当前平台为 ${host}。`);
}
const mac = platform === "darwin";
const win = platform === "win32";
if ((!mac && !win) || !["arm64", "x64"].includes(arch) || (win && arch !== "x64")) {
  throw new Error(`无可用的桌面打包目标：${platform}-${arch}`);
}
const target = `${arch === "arm64" ? "aarch64" : "x86_64"}-${mac ? "apple-darwin" : "pc-windows-msvc"}`;
const testBuild = process.env.QINGZHOU_DESKTOP_E2E_BUILD === "1";
if (crossWindows && testBuild) throw new Error("WebView2 自动化需要在 Windows 上运行。");
const appOnly = mac && (testBuild || process.env.QINGZHOU_BUNDLE_APP_ONLY === "1");
const updateKey = process.env.QINGZHOU_TAURI_UPDATE_PUBKEY?.trim();
const signUpdates = !testBuild && Boolean(process.env.TAURI_SIGNING_PRIVATE_KEY);
const testEndpoint = testBuild && process.env.QINGZHOU_DESKTOP_E2E_UPDATE_URL;
const testVersion = testBuild && process.env.QINGZHOU_DESKTOP_E2E_VERSION;
const testWindowsInstaller = win && Boolean(testEndpoint);
if (testEndpoint && !/^http:\/\/127\.0\.0\.1:\d+\/[^\s]*$/.test(testEndpoint)) {
  throw new Error("桌面测试更新源必须是隔离的本机 HTTP 地址。");
}
if (testWindowsInstaller && (!testVersion || !updateKey)) {
  throw new Error("Windows 更新测试安装包需要测试版本和临时更新公钥。");
}
if (signUpdates && !updateKey) throw new Error("签名构建需要 QINGZHOU_TAURI_UPDATE_PUBKEY。");

await mkdir(stagingRoot, { recursive: true });
await mkdir(release, { recursive: true });
const staging = await mkdtemp(path.join(stagingRoot, `tauri-${platform}-${arch}-`));
const runtime = path.join(staging, "runtime");
const cargoTarget = path.resolve(desktop, process.env.CARGO_TARGET_DIR ?? "src-tauri/target");
// The bundler reads Cargo's output after compilation unlocks it. Keep the test executable away from the release path.
const targetDir = testBuild ? path.join(cargoTarget, "desktop-e2e") : cargoTarget;
const bundleFolder = path.join(targetDir, target, "release", "bundle");
await mkdir(runtime);

function run(command, args, options = {}) {
  console.log(`> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd: desktop, stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} 退出码：${result.status ?? result.signal}`);
}

async function download(url) {
  const response = await proxiedFetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`无法下载 ${url}（HTTP ${response.status}）`);
  return Buffer.from(await response.arrayBuffer());
}

async function stageNode() {
  const platformName = mac ? "darwin" : "win";
  const folder = `node-v${nodeVersion}-${platformName}-${arch}`;
  const archiveName = `${folder}.${mac ? "tar.gz" : "zip"}`;
  const base = `https://nodejs.org/dist/v${nodeVersion}`;
  const [archive, sums] = await Promise.all([download(`${base}/${archiveName}`), download(`${base}/SHASUMS256.txt`)]);
  const expected = sums.toString("utf8").split("\n").map((line) => line.trim().split(/\s+/))
    .find(([, name]) => name === archiveName)?.[0];
  if (!expected || createHash("sha256").update(archive).digest("hex") !== expected) {
    throw new Error(`Node.js SHA256 校验失败：${archiveName}`);
  }
  const archivePath = path.join(staging, archiveName);
  const binaryPath = win ? "node.exe" : "bin/node";
  await writeFile(archivePath, archive);
  run(tar, ["-xf", archivePath, "-C", staging, `${folder}/${binaryPath}`, `${folder}/LICENSE`]);
  await mkdir(path.join(runtime, "bin"));
  const executable = path.join(runtime, "bin", path.basename(binaryPath));
  const original = path.join(staging, folder, binaryPath);
  if (mac) {
    run("xcrun", ["strip", "-S", "-x", "-o", executable, original]);
    await chmod(executable, 0o755);
    run("codesign", ["--force", "--sign", "-", executable]);
  } else {
    await cp(original, executable);
  }
  await cp(path.join(staging, folder, "LICENSE"), path.join(runtime, "NODE-LICENSE"));
}

const keepFile = (file) => !/\.(?:[cm]?[jt]s|css)\.map$/i.test(file);

async function stagePi() {
  const source = path.join(desktop, "pi-runtime");
  const scratch = path.join(staging, "pi-install");
  await mkdir(scratch);
  await cp(path.join(source, "package.json"), path.join(scratch, "package.json"));
  await cp(path.join(source, "package-lock.json"), path.join(scratch, "package-lock.json"));
  run(host === "win32" ? "npm.cmd" : "npm", ["ci", "--omit=dev", "--ignore-scripts", `--cpu=${arch}`, `--os=${platform}`], { cwd: scratch, shell: host === "win32" });
  await cp(path.join(scratch, "node_modules"), path.join(runtime, "pi/node_modules"), {
    recursive: true,
    filter: (file) => keepFile(file) && path.basename(file) !== ".bin",
  });
}

async function stageService() {
  const server = path.join(root, "apps/server");
  await build({
    entryPoints: [path.join(server, "dist/desktop-main.js")],
    outfile: path.join(runtime, "service.mjs"),
    platform: "node",
    format: "esm",
    target: "node22",
    bundle: true,
    external: ["node-pty"],
    banner: { js: "import { createRequire as bundleRequire } from 'node:module'; import { fileURLToPath as bundlePath } from 'node:url'; const require = bundleRequire(import.meta.url); const __dirname = bundlePath(new URL('.', import.meta.url));" },
  });
  await cp(path.join(server, "extensions/approval.ts"), path.join(runtime, "approval.ts"));
  const web = path.join(runtime, "web");
  await cp(path.join(root, "apps/web/dist"), web, { recursive: true, filter: keepFile });
  const index = await readFile(path.join(web, "index.html"), "utf8");
  for (const [, asset] of index.matchAll(/\b(?:src|href)="(\/assets\/[^"\s]+)"/g)) {
    await readFile(path.join(web, asset));
  }

  const source = path.resolve(path.dirname(requireServer.resolve("node-pty")), "..");
  const pty = path.join(runtime, "node_modules/node-pty");
  const prebuilt = `prebuilds/${platform}-${arch}`;
  await mkdir(pty, { recursive: true });
  for (const entry of ["package.json", "LICENSE", "lib", "deps", prebuilt]) {
    await cp(path.join(source, entry), path.join(pty, entry), { recursive: true, filter: keepFile });
  }
  if (mac) await chmod(path.join(pty, prebuilt, "spawn-helper"), 0o755);
}

await stageNode();
await stagePi();
await stageService();
run(process.execPath, [requireRoot.resolve("tsx/cli"), "scripts/bundle-pi-tools.ts", arch, path.join(runtime, "tools"), platform], { cwd: root });

const cli = path.join(desktop, "node_modules/@tauri-apps/cli/tauri.js");
const icons = path.join(staging, "icons");
run(process.execPath, [cli, "icon", path.join(root, "apps/web/public/mowen.svg"), "--output", icons]);
const config = {
  ...(testBuild && !testWindowsInstaller ? { productName: "Mowen Desktop Test", identifier: "com.qingzhou.desktop.test" } : {}),
  ...(testWindowsInstaller ? { productName: "Qingzhou" } : {}),
  ...(testVersion ? { version: testVersion } : {}),
  bundle: {
    resources: { [`${runtime}/`]: "runtime/" },
    icon: [path.join(icons, "icon.png"), path.join(icons, mac ? "icon.icns" : "icon.ico")],
    createUpdaterArtifacts: signUpdates,
  },
  ...(updateKey ? { plugins: { updater: {
    pubkey: updateKey,
    endpoints: [testEndpoint || "https://github.com/Yunz93/Qingzhou/releases/latest/download/tauri-update.json"],
    ...(testEndpoint ? { dangerousInsecureTransportProtocol: true } : {}),
    windows: { installMode: "passive" },
  } } } : {}),
};
const configPath = path.join(staging, "bundle.json");
await writeFile(configPath, JSON.stringify(config));
const bundleArgs = mac ? ["--bundles", appOnly ? "app" : "app,dmg"]
  : testBuild && !testWindowsInstaller ? ["--no-bundle"] : ["--bundles", "nsis"];
run(process.execPath, [cli, "build", "--ci", "--target", target, "--config", configPath, ...bundleArgs,
  ...(crossWindows ? ["--runner", "cargo-xwin"] : []), ...(testBuild ? ["--features", "desktop-e2e"] : []), "--", "--locked"], {
  env: { ...process.env, CARGO_TARGET_DIR: targetDir },
});

if (testBuild) {
  if (win) {
    const testRuntime = path.join(bundleFolder, "../runtime");
    await cp(runtime, testRuntime, { recursive: true });
  }
} else if (mac) {
  const app = path.join(bundleFolder, "macos", `${productName}.app`);
  // The last Electron release requires this exact bundle name inside its ZIP.
  const legacyZipApp = path.join(staging, "Qingzhou.app");
  run("ditto", [app, legacyZipApp]);
  run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", legacyZipApp, path.join(release, `Qingzhou-mac-${arch}.zip`)]);
  if (signUpdates) {
    await cp(`${app}.tar.gz`, path.join(release, `Qingzhou-mac-${arch}.app.tar.gz`));
    await cp(`${app}.tar.gz.sig`, path.join(release, `Qingzhou-mac-${arch}.app.tar.gz.sig`));
  }
  if (!appOnly) await copyBundle("dmg", ".dmg", `Qingzhou-mac-${arch}.dmg`);
} else {
  await copyBundle("nsis", "-setup.exe", "Qingzhou-win-x64-setup.exe");
  if (signUpdates) await copyBundle("nsis", "-setup.exe.sig", "Qingzhou-win-x64-setup.exe.sig");
  const portable = path.join(staging, "portable");
  await mkdir(portable);
  await cp(path.join(bundleFolder, "../qingzhou.exe"), path.join(portable, "Qingzhou.exe"));
  await cp(runtime, path.join(portable, "runtime"), { recursive: true });
  run(tar, ["-a", "-c", "-f", path.join(release, "Qingzhou-win-x64-portable.zip"), "-C", portable, "."]);
}

async function copyBundle(folder, suffix, name) {
  const directory = path.join(bundleFolder, folder);
  const bundles = (await readdir(directory)).filter((file) => file.startsWith(`${productName}_${version}_`) && file.endsWith(suffix));
  if (bundles.length !== 1) throw new Error(`无法确定待交付的安装包：${directory}`);
  await cp(path.join(directory, bundles[0]), path.join(release, name));
}
