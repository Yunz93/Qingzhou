import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import console from "node:console";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const binary = process.argv[2];
if (!binary) throw new Error("用法：node tests/desktop/tauri-smoke.mjs <桌面测试程序>");
const executable = path.resolve(binary);
const runtime = path.resolve(path.dirname(executable), process.platform === "darwin" ? "../Resources/runtime" : "runtime");
const workbenchPage = path.join(runtime, "web/index.html");
await mkdir(".qingzhou-test", { recursive: true });
const directory = path.resolve(await mkdtemp(".qingzhou-test/tauri-native-"));
const home = path.join(directory, "home");
const workspace = path.join(home, "project");
const data = path.join(directory, "data");
const logs = path.join(directory, "logs");
await Promise.all([mkdir(workspace, { recursive: true }), mkdir(data), mkdir(logs)]);
await writeFile(path.join(data, "settings.json"), JSON.stringify({ workspaceRoot: workspace, autoCheckForUpdates: false }));

const reservation = createServer().listen(0, "127.0.0.1");
await once(reservation, "listening");
const { port } = reservation.address();
await new Promise((resolve) => reservation.close(resolve));
const driver = `http://127.0.0.1:${port}`;

async function request(method, url, value, milliseconds = 4_000) {
  const response = await globalThis.fetch(driver + url, {
    method, signal: globalThis.AbortSignal.timeout(milliseconds),
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(value),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${method} ${url}：${JSON.stringify(result.value)}`);
  return result.value;
}

async function waitFor(read, message, timeout = 40_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      const result = await read();
      if (result) return result;
    } catch (error) { last = error; }
    await delay(100);
  }
  throw new Error(message, { cause: last });
}

async function start({ simulateMissingPage = false } = {}) {
  const started = Date.now();
  const movedPage = `${workbenchPage}.smoke-test`;
  let pageMoved = false;
  if (simulateMissingPage) {
    await rename(workbenchPage, movedPage);
    pageMoved = true;
  }
  const processHandle = spawn(executable, [], { env: {
    ...process.env, QINGZHOU_DESKTOP_E2E: "1", QINGZHOU_E2E: "1", TAURI_WEBDRIVER_PORT: String(port),
    QINGZHOU_DATA_DIR: data, QINGZHOU_HOME_DIR: home, QINGZHOU_DESKTOP_LOG_DIR: logs, QINGZHOU_ALLOWED_ROOTS: workspace,
  }, stdio: "inherit" });
  const exited = once(processHandle, "close");
  try {
    await waitFor(() => request("GET", "/status"), "桌面测试驱动未就绪");
    const { sessionId } = await waitFor(
      () => request("POST", "/session", { capabilities: {
        alwaysMatch: { "wdio:tauriServiceOptions": { windowLabel: "main" } },
      } }, 20_000),
      "桌面主窗口未接受 WebDriver 会话",
    );
    const session = `/session/${sessionId}`;
    const execute = (script, ...args) => request("POST", `${session}/execute/sync`, { script, args });
    if (pageMoved) {
      await waitFor(async () => {
        const status = await execute(`return { message: document.querySelector('#status')?.textContent,
          actions: document.querySelector('#actions')?.hidden === false,
          path: location.pathname, origin: location.origin, heading: document.body?.innerText.slice(0, 120) }`);
        if (status.actions && status.message.includes("安装资源缺失：工作台页面")) return true;
        throw new Error(status.message ?? `启动页状态元素缺失（${status.origin}${status.path} ${status.heading}）`);
      }, "缺少页面时未显示中文启动提示与重试操作", 15_000);
      const diagnostic = await readFile(path.join(logs, "service.log"), "utf8");
      assert.match(diagnostic, /安装资源缺失：工作台页面/);
      assert.doesNotMatch(diagnostic, /Server listening at/);
      await rename(movedPage, workbenchPage);
      pageMoved = false;
      await execute("document.querySelector('#retry').click()");
    }
    async function waitForConnection(previous) {
      const address = await waitFor(async () => {
        const page = await execute(`return { origin: location.origin, path: location.pathname,
          ready: Boolean(document.querySelector('nav[aria-label=工作区]')),
          message: document.body?.innerText.slice(0, 140) }`);
        if (page.origin !== previous && page.ready) return page.origin;
        throw new Error(`${page.origin}${page.path} ${page.message}`);
      }, "系统 WebView 未加载工作区");
      const frame = await request("POST", `${session}/execute/async`, { args: [], script: `
        const done = arguments[arguments.length - 1];
        const socket = new WebSocket(location.origin.replace(/^http/, 'ws') + '/ws');
        const timeout = setTimeout(() => { socket.close(); done('timeout'); }, 5000);
        socket.onmessage = (event) => { clearTimeout(timeout); socket.close(); done(JSON.parse(event.data).type); };
        socket.onerror = () => { clearTimeout(timeout); done('error'); };
      ` }, 7000);
      assert.equal(frame, "snapshot", "系统 WebView 未收到经认证的会话快照");
      assert.equal((await globalThis.fetch(`${address}/api/session`)).status, 401);
      return address;
    }
    const address = await waitForConnection(null);
    console.log(`工作区就绪 ${Date.now() - started} ms`);
    async function screenshot(name) {
      const image = await request("GET", `${session}/screenshot`, undefined, 20_000);
      await writeFile(path.join(directory, name), Buffer.from(image, "base64"));
    }
    async function close() {
      await request("DELETE", `${session}/window`).catch(() => undefined);
      const termination = await waitFor(() => (processHandle.exitCode !== null || processHandle.signalCode !== null) && exited, "桌面未正常退出");
      assert.deepEqual(termination, [0, null]);
    }
    return { processHandle, session, execute, screenshot, close, address, waitForConnection };
  } catch (error) {
    processHandle.kill();
    throw error;
  } finally {
    if (pageMoved) await rename(movedPage, workbenchPage);
  }
}

async function serviceStarts() {
  const log = await readFile(path.join(logs, "service.log"), "utf8");
  assert.equal(/\/_desktop\/bootstrap\?ticket=|QINGZHOU_DESKTOP_TICKET/.test(log), false, "启动日志包含会话票据");
  return log.split("\n").filter((line) => line.includes('"msg":"Server listening at ')).map((line) => JSON.parse(line));
}

const first = await start({ simulateMissingPage: true });
let second;
try {
  const initial = await serviceStarts();
  assert.equal(initial.length, 1, "资源补齐后重试只启动一个服务");
  assert.equal(initial[0].msg, `Server listening at ${first.address}`);
  const title = "断线草稿验收";
  const composer = 'textarea[aria-label="输入消息"]';
  const draft = "本地服务断开时键入的草稿";
  await first.execute(`document.querySelector('[aria-label="新对话"]').click()`);
  await waitFor(() => first.execute("return Boolean(document.querySelector('#task-title'))"), "新对话未打开");
  await first.execute(`
    const title = document.querySelector('#task-title');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(title, arguments[0]);
    title.dispatchEvent(new Event('input', { bubbles: true }));
  `, title);
  await waitFor(() => first.execute("return document.querySelector('#task-title')?.getAttribute('value') === arguments[0]", title), "未同步新对话标题");
  await first.execute("document.querySelector('#task-title').form.requestSubmit()");
  await waitFor(async () => {
    const result = await first.execute(`
      return { title: [...document.querySelectorAll('h1')].some(node => node.textContent === arguments[0]),
        error: document.querySelector('[role=dialog] [role=alert]')?.textContent };
    `, title);
    if (result.error) throw new Error(result.error);
    return result.title;
  }, "对话未创建");
  await waitFor(async () => (await readFile(path.join(data, "state.json"), "utf8")).includes(title), "对话尚未落盘");
  process.kill(initial[0].pid, "SIGKILL");
  await waitFor(() => first.execute("return document.body.innerText.includes('连接已断开')"), "服务异常退出后未提示断开");
  await first.execute(`
    const input = document.querySelector(arguments[0]);
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, arguments[1]);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  `, composer, draft);
  await waitFor(() => first.execute("return document.body.innerText.includes('桌面草稿或偏好暂时无法保存')"), "未能在断线窗口输入草稿");
  const reconnect = () => first.execute(`[...document.querySelectorAll('button')].find(button => button.textContent.trim() === '重新连接').click()`);
  const preferences = path.join(data, "desktop-ui.json");
  const previousPreferences = await readFile(preferences, "utf8");
  await writeFile(preferences, "{{损坏的桌面偏好");
  await reconnect();
  await waitFor(() => first.execute("return document.body.innerText.includes('断线期间的草稿或偏好暂时无法保存')"), "保存失败后未提示重试");
  assert.equal(await first.execute("return location.origin"), first.address);
  assert.equal(await first.execute("return document.querySelector(arguments[0]).value", composer), draft);
  assert.equal(await readFile(preferences, "utf8"), "{{损坏的桌面偏好");
  await writeFile(preferences, previousPreferences);
  await reconnect();
  const newAddress = await first.waitForConnection(first.address);
  const restarted = await serviceStarts();
  assert.equal(restarted.length, 2, "异常退出后重试只启动一个服务");
  assert.notEqual(restarted[1].pid, initial[0].pid);
  assert.equal(restarted[1].msg, `Server listening at ${newAddress}`);
  const restored = JSON.parse(await readFile(preferences, "utf8"));
  assert(Object.values(restored).includes(draft), "服务重连丢失了断线时输入的草稿");
  await waitFor(() => first.execute("return document.querySelector(arguments[0])?.value === arguments[1]", composer, draft), "原对话未恢复可编辑草稿");
  console.log("缺失资源提示、恢复启动、服务退出和草稿恢复通过。");

  const preview = createHttpServer((_incoming, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>轻舟预览验证</title><main>本机预览页面</main>");
  }).listen(0, "127.0.0.1");
  await once(preview, "listening");
  try {
    const opened = await request("POST", `${first.session}/execute/async`, {
      args: [`http://127.0.0.1:${preview.address().port}/`], script: `
        const done = arguments[arguments.length - 1];
        window.__TAURI_INTERNALS__.invoke('preview_navigation', { action: 'open', url: arguments[0] })
          .then(() => done(true), (error) => done(String(error)));
      `,
    });
    assert.equal(opened, true);
    await waitFor(async () => (await request("GET", `${first.session}/window/handles`)).includes("website-preview"), "预览窗口未打开");
    await request("POST", `${first.session}/window`, { handle: "website-preview" });
    await waitFor(() => first.execute("return document.querySelector('main')?.textContent === '本机预览页面'"), "本机网页未加载");
    const denied = await request("POST", `${first.session}/execute/async`, { args: [], script: `
      const done = arguments[arguments.length - 1];
      if (!window.__TAURI_INTERNALS__) done(true);
      else window.__TAURI_INTERNALS__.invoke('check_signed_update').then(() => done(false), (error) => done(String(error)));
    ` });
    assert(denied === true || /denied|not allowed|主窗口/i.test(denied), denied);
    await request("DELETE", `${first.session}/window`);
    await request("POST", `${first.session}/window`, { handle: "main" });
  } finally {
    preview.close();
  }

  if (process.platform === "darwin") {
    const exercise = async (control) => {
      const result = await request("POST", `${first.session}/execute/async`, { args: [control], script: `
        const done = arguments[arguments.length - 1];
        window.__TAURI_INTERNALS__.invoke('exercise_native_control', { control: arguments[0] })
          .then(done, error => done({ error: String(error) }));
      ` });
      assert.equal(typeof result, "boolean", JSON.stringify(result));
      return result;
    };
    await first.execute(`
      const input = document.querySelector(arguments[0]);
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '左侧');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
      input.setSelectionRange(1, 1);
      const events = [];
      for (const name of ['compositionstart', 'compositionupdate', 'compositionend']) {
        input.addEventListener(name, event => events.push({ type: event.type, data: event.data, trusted: event.isTrusted }));
      }
      const prompts = [];
      const send = WebSocket.prototype.send;
      WebSocket.prototype.send = function (payload) {
        if (typeof payload === 'string') {
          const { type } = JSON.parse(payload);
          if (type?.startsWith('prompt.')) prompts.push(type);
        }
        return send.call(this, payload);
      };
      window.qingzhouCompositionTest = { events, prompts, restore: () => { WebSocket.prototype.send = send; } };
    `, composer);
    assert.equal(await exercise("beginDraftComposition"), true);
    await waitFor(() => first.execute(`
      return document.querySelector(arguments[0]).value === '左nihao侧' &&
        window.qingzhouCompositionTest.events.some(event => event.type === 'compositionstart' && event.trusted);
    `, composer), "WKWebView 未从 AppKit 进入组字状态");
    await first.execute(`
      document.querySelector(arguments[0]).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    `, composer);
    assert.equal(await first.execute("return document.querySelector(arguments[0]).value", composer), "左nihao侧");
    assert.equal(await exercise("commitDraftComposition"), true);
    await waitFor(() => first.execute(`
      return document.querySelector(arguments[0]).value === '左你好侧' &&
        window.qingzhouCompositionTest.events.some(event => event.type === 'compositionend' && event.data === '你好' && event.trusted);
    `, composer), "原生组字提交后丢失草稿或光标前后的文本");
    const composition = await first.execute(`
      const input = document.querySelector(arguments[0]);
      const test = window.qingzhouCompositionTest;
      test.restore();
      return { selection: [input.selectionStart, input.selectionEnd], focused: document.activeElement === input, prompts: test.prompts };
    `, composer);
    assert.deepEqual(composition, { selection: [3, 3], focused: true, prompts: [] });
    await waitFor(async () => Object.values(JSON.parse(await readFile(preferences, "utf8"))).includes("左你好侧"), "原生组字提交后的草稿未保存");
    console.log("AppKit 组字与提交保留中文草稿、光标和焦点，组字中的回车未发送消息。");

    await first.execute(`document.querySelector('[aria-label="新对话"]').click()`);
    const selectFolder = `Array.from(document.querySelectorAll('[role=dialog] button')).find(node => node.textContent.trim() === '选择文件夹…')`;
    await waitFor(() => first.execute(`return Boolean(${selectFolder})`), "找不到原生目录选择入口");
    const folderBefore = await first.execute("return document.querySelector('[role=dialog] p[title]')?.textContent");
    assert.equal(folderBefore, workspace);
    await first.execute(`
      window.__TAURI_INTERNALS__.invoke('pick_folder', { defaultPath: arguments[0] }).then(
        value => { window.qingzhouPickerTest = { value }; },
        error => { window.qingzhouPickerTest = { error: String(error) }; },
      );
    `, workspace);
    await waitFor(() => exercise("cancelFolderPicker"), "未出现可以取消的原生目录选择框", 12_000);
    const cancelled = await waitFor(() => first.execute("return window.qingzhouPickerTest"), "原生目录选择操作未结束");
    assert.deepEqual(cancelled, { value: null });
    await first.execute(`(${selectFolder}).click()`);
    await waitFor(() => exercise("cancelFolderPicker"), "从新对话无法打开原生目录选择框", 12_000);
    assert.equal(await first.execute("return document.querySelector('[role=dialog] p[title]')?.textContent"), folderBefore);
    await first.execute(`document.querySelector('[role=dialog] [aria-label="关闭"]').click()`);
    assert.equal(await exercise("settingsShortcut"), true);
    await waitFor(() => first.execute("return location.pathname === '/settings'"), "AppKit 设置快捷键未打开设置");
    await first.execute("history.back()");
    await waitFor(() => first.execute("return location.pathname === '/'"), "从设置返回工作区失败");
    console.log("AppKit 设置快捷键与原生目录选择取消通过。");
  }

  await first.execute("document.querySelector('aside a[href=\"/settings\"]').click()");
  await waitFor(() => first.execute("return location.pathname === '/settings'"), "设置未从工作区打开");
  const previousTheme = await first.execute("return document.documentElement.style.colorScheme");
  await first.execute("document.querySelector('a[href$=\"#settings-appearance\"]').click()");
  await waitFor(() => first.execute("return document.querySelector('#settings-appearance')?.hidden === false"), "外观设置未打开");
  await first.execute("document.querySelector('#settings-appearance button[aria-pressed=false]').click()");
  const theme = await waitFor(async () => {
    const current = await first.execute("return document.documentElement.style.colorScheme");
    return current !== previousTheme && current;
  }, "主题切换未生效");
  assert.match(theme, /^(dark|light)$/);
  await first.screenshot("settings.png");
  await request("POST", `${first.session}/window/rect`, { width: 533, height: 600 });
  await waitFor(() => first.execute("return innerWidth <= 533 && document.documentElement.scrollWidth <= innerWidth"), "最小尺寸布局溢出");
  await first.screenshot("settings-compact.png");
  await first.close();

  second = await start();
  assert.equal(await second.execute("return document.documentElement.style.colorScheme"), theme);
  const snapshot = JSON.parse(await readFile(path.join(data, "desktop-ui.json"), "utf8"));
  assert.equal(snapshot["qingzhou.theme"], theme);
  await waitFor(() => second.execute("return !document.body.innerText.includes('连接已断开')"), "会话连接未恢复");
  if (process.platform === "darwin") {
    await waitFor(() => second.execute(`
      const input = document.querySelector(arguments[0]);
      const titleVisible = [...document.querySelectorAll('h1')].some(node => node.textContent === arguments[1]);
      if (!titleVisible) {
        [...document.querySelectorAll('[aria-label="会话"] button')]
          .find(button => button.textContent.trim() === arguments[1])?.click();
        return false;
      }
      return input?.value === '左你好侧';
    `, composer, title), "重新打开会话后没有恢复原生组字草稿");
  }
  await second.screenshot("conversation.png");
  await second.close();
  console.log(`系统 WebView、WebSocket、独立预览、最小窗口、退出与主题恢复通过。截图目录 ${directory}`);
} finally {
  for (const native of [first, second]) if (native?.processHandle.exitCode === null) native.processHandle.kill();
}
