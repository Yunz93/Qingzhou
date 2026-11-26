import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn, spawnSync } from "node:child_process";
import console from "node:console";
import { once } from "node:events";
import { createReadStream } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { URL } from "node:url";
import { createProjectHistory } from "./legacy-history.mjs";

if (process.platform !== "win32" || process.env.GITHUB_ACTIONS !== "true" || !process.env.RUNNER_TEMP) {
  throw new Error("签名升级测试使用一次性 Windows CI 运行器的应用登记及资料目录。");
}
const [sourceInstaller, candidate] = process.argv.slice(2).map((file) => path.resolve(file));
if (!sourceInstaller || !candidate) throw new Error("请提供旧测试安装包和已签名的候选安装包。");
const { version, identifier } = JSON.parse(await readFile(new URL("../../apps/desktop/src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const signature = (await readFile(`${candidate}.sig`, "utf8")).trim();
const { size } = await stat(candidate);
assert(signature && size);

const root = await mkdtemp(path.join(process.env.RUNNER_TEMP, "qingzhou-signed-"));
const install = path.join(root, "Signed Update Installation");
const portable = path.join(root, "Portable Copy");
const workspace = path.join(root, "Upgrade Project");
const binary = path.join(install, "Qingzhou.exe");
const data = path.join(homedir(), ".qingzhou");
const serviceLog = path.join(process.env.LOCALAPPDATA, identifier, "logs", "service.log");
const settings = path.join(data, "settings.json");
const snapshot = path.join(data, "desktop-ui.json");
const saved = { "qingzhou.theme": "dark", "qingzhou:shared-draft:signed-test": "需保留的未发送草稿" };
// The NSIS restart uses the Windows shell, which may not inherit process-local settings.
await mkdir(data);
await mkdir(workspace);
await writeFile(settings, JSON.stringify({ workspaceRoot: workspace, autoCheckForUpdates: false }));
await writeFile(snapshot, JSON.stringify(saved));

function powershell(script) {
  const result = spawnSync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", `$ErrorActionPreference = 'Stop'; ${script}`], {
    encoding: "utf8", timeout: 120_000,
    env: { ...process.env, QINGZHOU_TEST_INSTALLER: sourceInstaller, QINGZHOU_TEST_ROOT: install, QINGZHOU_TEST_EXE: binary },
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, [result.stderr, result.stdout].filter(Boolean).join("\n"));
  return result.stdout.trim();
}

const port = 4385;
const updateOrigin = `http://127.0.0.1:${port}`;
let corrupt = true;
let downloads = 0;
const feed = createServer((request, response) => {
  if (request.url === "/latest.json") {
    const asset = { signature, url: `${updateOrigin}/setup.exe` };
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
      version, notes: "Windows 签名更新回归", platforms: { "windows-x86_64": asset },
    }));
  } else if (request.url === "/setup.exe") {
    downloads += 1;
    response.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": size });
    if (corrupt) response.write(Buffer.of(0));
    const input = createReadStream(candidate, { start: corrupt ? 1 : 0 });
    input.on("error", (error) => response.destroy(error));
    response.on("close", () => input.destroy());
    input.pipe(response);
  } else {
    response.writeHead(404).end();
  }
});

async function waitFor(read, message, timeout = 45_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await read();
      if (result) return result;
    } catch (error) { lastError = error; }
    await delay(250);
  }
  throw new Error(message, { cause: lastError });
}

async function driver(method, route, body, timeout = 4_000) {
  const response = await globalThis.fetch(`http://127.0.0.1:4448${route}`, {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: globalThis.AbortSignal.timeout(timeout),
  });
  const { value } = await response.json();
  if (!response.ok) throw new Error(`${method} ${route}: ${JSON.stringify(value)}`);
  return value;
}

async function exercise(executable, test) {
  const app = spawn(executable, [], {
    env: { ...process.env, QINGZHOU_DESKTOP_E2E: "1", QINGZHOU_E2E: "1", TAURI_WEBDRIVER_PORT: "4448" },
    stdio: "inherit",
  });
  const exited = once(app, "exit");
  let session;
  try {
    await waitFor(() => driver("GET", "/status"), "Windows 测试驱动未就绪");
    const { sessionId } = await waitFor(
      () => driver("POST", "/session", { capabilities: {
        alwaysMatch: { "wdio:tauriServiceOptions": { windowLabel: "main" } },
      } }, 20_000),
      "Windows 主窗口未接受 WebDriver 会话",
    );
    session = `/session/${sessionId}`;
    await waitFor(() => driver("POST", `${session}/execute/sync`, {
      script: "return Boolean(document.querySelector('nav[aria-label=工作区]'))", args: [],
    }), "WebView2 未加载工作区");
    const invoke = (command) => driver("POST", `${session}/execute/async`, {
      args: [command, version], script: `
        const [command, version, done] = arguments;
        const binding = window.__TAURI_INTERNALS__;
        const args = { version };
        if (command === "download_signed_update") args.progress = "__CHANNEL__:" + binding.transformCallback(() => {}, false);
        binding.invoke(command, args).then(value => done({ ok: true, value }), error => done({ ok: false, error: String(error) }));
      `,
    }, 35_000);
    const send = async (type, payload) => {
      const reply = await driver("POST", `${session}/execute/async`, {
        args: [type, payload], script: `
          const [type, payload, done] = arguments;
          const id = crypto.randomUUID();
          const socket = new WebSocket(location.origin.replace(/^http/, 'ws') + '/ws');
          const timeout = setTimeout(() => finish({ error: '工作流请求超时 ' + type }), 8000);
          function finish(result) { clearTimeout(timeout); socket.close(); done(result); }
          socket.onopen = () => socket.send(JSON.stringify({ id, type, payload }));
          socket.onerror = () => finish({ error: '工作流连接失败 ' + type });
          socket.onmessage = (event) => {
            const frame = JSON.parse(event.data);
            const reply = (frame.__batch ? frame.events : [frame]).find(entry => entry.payload?.requestId === id);
            if (reply) finish(reply.type === 'request.succeeded' ? { data: reply.payload.data } : { error: reply.payload.error });
          };
        `,
      }, 10_000);
      assert(!reply.error, reply.error);
      return reply.data;
    };
    await test(invoke, exited, send);
  } finally {
    if (app.exitCode === null) {
      if (session) await driver("DELETE", `${session}/window`).catch(() => undefined);
      await waitFor(() => app.exitCode !== null, "Windows 测试应用未退出", 15_000).catch(() => app.kill());
    }
  }
}

async function serviceStarts() {
  return (await readFile(serviceLog, "utf8")).match(/Server listening at /g)?.length ?? 0;
}

feed.listen(port, "127.0.0.1");
await once(feed, "listening");
let cleanupError;
try {
  powershell(`$command = Start-Process -FilePath $env:QINGZHOU_TEST_INSTALLER -ArgumentList @('/S', "/D=$env:QINGZHOU_TEST_ROOT") -Wait -PassThru
    exit $command.ExitCode`);
  const legacyRegistration = String.raw`HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Qingzhou`;
  const brandedRegistration = String.raw`HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Mowen`;
  const displayVersion = (registry) => powershell(`Get-ItemPropertyValue -LiteralPath '${registry}' -Name DisplayVersion`);
  assert.equal(displayVersion(legacyRegistration), "0.1.27");
  console.log("已安装 0.1.27 验证包。");
  await cp(install, portable, { recursive: true, errorOnExist: true, force: false });
  await exercise(path.join(portable, "Qingzhou.exe"), async (invoke) => {
    assert.deepEqual(await invoke("check_signed_update"), { ok: true, value: { version, body: "Windows 签名更新回归", canInstall: false } });
    const blocked = await invoke("download_signed_update");
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /便携包/);
    assert.match((await invoke("install_signed_update")).error, /便携包/);
    assert.equal(downloads, 0);
  });
  console.log("同机便携副本拒绝执行安装和下载。");
  await exercise(binary, async (invoke, exited, send) => {
    const history = await createProjectHistory(send, workspace);
    const before = JSON.parse(await readFile(path.join(data, "workflow.json"), "utf8"));
    const confirmedPrd = before.prds.find(prd => prd.id === history.prdId);
    assert(confirmedPrd?.confirmedAt, "旧版 PRD 确认未落盘");
    const offered = await invoke("check_signed_update");
    assert.deepEqual(offered, { ok: true, value: { version, body: "Windows 签名更新回归", canInstall: true } });
    const invalid = await invoke("download_signed_update");
    assert.equal(invalid.ok, false);
    assert.match(invalid.error, /signature|签名/i);
    assert.equal(downloads, 1);
    assert.equal(displayVersion(legacyRegistration), "0.1.27");
    console.log("原安装拒绝被篡改的安装包，并保留 0.1.27。");

    corrupt = false;
    const downloaded = await invoke("download_signed_update");
    assert.equal(downloaded.ok, true, downloaded.error);
    assert.equal(downloads, 2);
    console.log("原安装已验证正确的更新签名。");
    const starts = await serviceStarts();
    const installing = invoke("install_signed_update").catch((error) => ({ transportEnded: String(error) }));
    const first = await Promise.race([exited, installing]);
    if (Array.isArray(first)) assert.deepEqual(first, [0, null]);
    else if (first.ok === false) throw new Error(first.error);
    await waitFor(async () => await serviceStarts() > starts, "签名安装未在原资料目录自动重启", 90_000);
    assert.deepEqual(await exited, [0, null]);
    assert.equal(displayVersion(brandedRegistration), version);
    const installedPath = powershell(`Get-ItemPropertyValue -LiteralPath '${brandedRegistration}' -Name InstallLocation`);
    assert.equal(path.normalize(installedPath.replace(/^"|"$/g, "")).toLowerCase(), install.toLowerCase(), "升级后的登记未指向原有安装目录");
    assert.equal(powershell(`Test-Path -LiteralPath '${legacyRegistration}'`), "False");
    const updated = JSON.parse(await readFile(snapshot, "utf8"));
    for (const [key, value] of Object.entries(saved)) assert.equal(updated[key], value);
    const restored = JSON.parse(await readFile(path.join(data, "work-items.json"), "utf8"));
    assert(restored.projects.some(project => project.id === history.project.id));
    assert(restored.items.some(item => item.id === history.item.id && item.title === history.item.title));
    const workflow = JSON.parse(await readFile(path.join(data, "workflow.json"), "utf8"));
    assert.deepEqual(workflow.prds.find(prd => prd.id === history.prdId), confirmedPrd);
    for (const event of [history.configured, history.confirmed]) {
      assert(workflow.events.some(entry => entry.id === event.id && entry.message === event.message));
    }
  });
  console.log(`Windows 原生签名升级到 ${version}：便携版拒绝安装，坏签名被拒绝，原位安装及重启后保留项目、确认历史、主题和草稿。`);
} finally {
  feed.closeAllConnections();
  feed.close();
  try {
    powershell(`Get-Process | Where-Object { $_.ProcessName -ieq 'qingzhou' -and $_.Path -ieq $env:QINGZHOU_TEST_EXE } | ForEach-Object {
      if ($_.CloseMainWindow() -and !$_.WaitForExit(15000)) { throw '签名升级测试窗口未正常退出。' }
    }`);
  } catch (error) {
    cleanupError = error;
    console.error("关闭签名升级测试进程时出错。", error);
  }
}
if (cleanupError) throw cleanupError;
