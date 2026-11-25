import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

function pathFromScript(relative) {
  return fileURLToPath(new URL(relative, import.meta.url));
}

const child = spawn("cargo", ["run", "--locked", "--manifest-path", "src-tauri/Cargo.toml"], {
  stdio: "inherit",
  env: {
    ...process.env,
    TAURI_CONFIG: JSON.stringify({ identifier: "com.qingzhou.desktop.dev", productName: "Mowen Dev" }),
    QINGZHOU_DATA_DIR: process.env.QINGZHOU_DATA_DIR ?? pathFromScript("../../../.qingzhou"),
    QINGZHOU_DEV_NODE: process.execPath,
    QINGZHOU_DEV_ENTRY: pathFromScript("../../server/dist/desktop-main.js"),
    QINGZHOU_DEV_WEB_DIST: pathFromScript("../../web/dist"),
    QINGZHOU_DEV_APPROVAL: pathFromScript("../../server/extensions/approval.ts"),
  },
});
child.on("error", (error) => {
  console.error(`无法启动 Tauri 开发宿主：${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
});
