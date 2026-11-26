import { expect, test } from "@playwright/test";
import type { SetupStatus } from "../../apps/web/src/components/setup/SetupWizard";

const base: SetupStatus = {
  ready: true, piAvailable: true, piVersion: "test", piError: null, piBundled: true, authConfigured: false,
  configuredProviders: [], authEntries: [], geminiTarget: { kind: "official" },
  providers: [
    { id: "google", label: "Google Gemini", hint: "" },
    { id: "anthropic", label: "Anthropic (Claude)", hint: "" },
  ],
  oauthProviders: [{ id: "github", label: "GitHub Copilot" }],
  workspaceRoot: "/example", setupCompleted: true, allowedRoots: ["/example"], homeDir: "/example", dataDir: "/example/data", needsSetup: false,
};

test("first run opens Gemini and saves only the selected provider's key after testing and retrying", async ({ page }, testInfo) => {
  const fresh = { ...base, needsSetup: true, setupCompleted: false };
  const connected = { ...fresh, authConfigured: true, configuredProviders: ["google"],
    authEntries: [{ id: "google", label: "Google Gemini", kind: "api_key", source: "auth_file" }] };
  let completed = false;
  let probes = 0;
  let saves = 0;
  await page.route("**/api/setup", (route) => route.fulfill({ json: completed ? base : fresh }));
  await page.route("**/api/folders?*", (route) => route.fulfill({ json: { cwd: "/example", parent: null, entries: [], roots: ["/example"] } }));
  await page.route("**/api/setup/test-gemini", (route) => {
    expect(route.request().postDataJSON()).toEqual({ apiKey: "gemini-test-fixture" });
    probes++;
    return probes === 1 ? route.fulfill({ status: 403, json: { error: "Google 拒绝了此密钥。" } }) : route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/setup/api-key", (route) => {
    expect(route.request().postDataJSON()).toEqual({ provider: "google", apiKey: "gemini-test-fixture" });
    saves++;
    return saves === 1 ? route.fulfill({ status: 503, json: { error: "无法写入凭据，请重试。" } }) : route.fulfill({ json: connected });
  });
  await page.route("**/api/setup/workspace", (route) => {
    expect(route.request().postDataJSON()).toEqual({ path: "/example" });
    completed = true;
    return route.fulfill({ json: { ...connected, setupCompleted: true, needsSetup: false } });
  });

  await page.setViewportSize({ width: 533, height: 600 });
  await page.goto("/");
  const wizard = page.getByRole("dialog", { name: "连接模型服务" });
  const key = wizard.getByLabel("Google Gemini API Key", { exact: true });
  await expect(key).toHaveAttribute("type", "password");
  await expect(wizard.getByRole("link", { name: "从 AI Studio 获取密钥" })).toHaveAttribute("href", "https://aistudio.google.com/apikey");
  await expect(wizard.getByRole("button", { name: "测试连接" })).toBeDisabled();
  await expect(wizard.getByRole("button", { name: "保存并继续" })).toBeInViewport();
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("gemini-first-run-533.png") });
  await key.fill("draft-for-google");
  await wizard.getByLabel("服务商").selectOption("anthropic");
  await expect(wizard.getByLabel("Anthropic (Claude) API Key")).toHaveValue("");
  await wizard.getByLabel("服务商").selectOption("google");
  await expect(key).toHaveValue("draft-for-google");
  await key.fill("gemini-test-fixture");
  await wizard.getByRole("button", { name: "测试连接" }).click();
  await expect(wizard.getByRole("alert")).toContainText("Google 拒绝");
  await expect(key).toHaveValue("gemini-test-fixture");
  await wizard.getByRole("button", { name: "测试连接" }).click();
  await expect(wizard.getByRole("status")).toContainText("可读取 Gemini 模型目录");
  expect(saves).toBe(0);
  await key.press("Enter");
  await expect(wizard.getByRole("alert")).toContainText("无法写入凭据");
  await key.press("Enter");
  const folder = page.getByRole("dialog", { name: "选一个工作文件夹" });
  await expect(folder.getByRole("heading")).toBeFocused();
  await folder.getByRole("button", { name: "完成设置" }).click();
  await expect(folder).toHaveCount(0);
  expect(completed).toBe(true);
});

test("settings can test a stored Gemini key without revealing it, and the setup dialog can retry an offline load", async ({ page }, testInfo) => {
  const connected = { ...base, authConfigured: true, configuredProviders: ["google"],
    authEntries: [{ id: "google", label: "Google Gemini", kind: "api_key", source: "auth_file" }] };
  // Both setup and the live workbench expose credential metadata. Give this
  // browser the same synthetic account in both, independently of prior tests.
  await page.routeWebSocket("**/ws", (socket) => {
    const server = socket.connectToServer();
    server.onMessage((message) => {
      const frame = JSON.parse(String(message));
      for (const event of frame.__batch ? frame.events : [frame]) {
        if (event.payload?.authEntries) Object.assign(event.payload, {
          authEntries: connected.authEntries, authConfigured: true, configuredProviders: ["google"],
        });
      }
      socket.send(JSON.stringify(frame));
    });
  });
  let offline = false;
  await page.route("**/api/setup", (route) => offline
    ? route.fulfill({ status: 503, json: { error: "offline" } }) : route.fulfill({ json: connected }));
  await page.route("**/api/setup/test-gemini", (route) => {
    expect(route.request().postDataJSON()).toEqual({});
    return route.fulfill({ json: { ok: true } });
  });
  await page.addInitScript(() => localStorage.setItem("qingzhou.theme", "dark"));
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.goto("/settings");
  const key = page.getByLabel("Google Gemini API Key");
  await expect(key).toHaveValue("");
  await page.getByRole("button", { name: "测试连接" }).click();
  await expect(page.getByRole("status").filter({ hasText: "可读取 Gemini 模型目录" })).toBeVisible();
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("gemini-settings-dark.png") });
  await key.fill("changed-test-fixture");
  await expect(page.getByText("已连接，可读取 Gemini 模型目录。", { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  offline = true;
  await page.getByRole("button", { name: "打开设置向导" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toContainText("无法读取设置");
  offline = false;
  await dialog.getByRole("button", { name: "重试" }).click();
  await expect(dialog.getByRole("heading", { name: "连接模型服务" })).toBeFocused();
  await expect(dialog.getByRole("button", { name: "使用现有连接" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "打开设置向导" })).toBeFocused();
  await expect(key).toHaveValue("changed-test-fixture");
});

test("custom Gemini recipients require explicit confirmation again after a destination changes", async ({ page }) => {
  const target = { kind: "custom" as const, origins: ["https://relay.example"], revision: "a".repeat(64) };
  const moved = { ...target, origins: ["https://new-relay.example"], revision: "b".repeat(64) };
  const setup = { ...base, needsSetup: true, setupCompleted: false, geminiTarget: target };
  let saves = 0;
  await page.route("**/api/setup", (route) => route.fulfill({ json: setup }));
  await page.route("**/api/setup/api-key", (route) => {
    saves++;
    expect(route.request().postDataJSON().confirmedGeminiTarget).toBe(saves === 1 ? target.revision : moved.revision);
    return saves === 1 ? route.fulfill({ status: 409, json: { error: "请求接收方已变更", geminiTarget: moved } })
      : route.fulfill({ json: { ...setup, geminiTarget: moved, authConfigured: true } });
  });
  await page.goto("/");
  const wizard = page.getByRole("dialog", { name: "连接模型服务" });
  await wizard.getByLabel("Google Gemini API Key").fill("fixture-custom-relay");
  const save = wizard.getByRole("button", { name: "保存并继续" });
  const consent = wizard.getByRole("checkbox", { name: "我确认将密钥用于上述服务" });
  await expect(wizard.getByText(target.origins[0], { exact: true })).toBeVisible();
  await expect(wizard.getByRole("button", { name: "测试连接" })).toHaveCount(0);
  await expect(wizard.getByRole("link", { name: "从 AI Studio 获取密钥" })).toHaveCount(0);
  await expect(save).toBeDisabled();
  await consent.check();
  await save.click();
  await expect(wizard.getByRole("alert")).toContainText("请求接收方已变更");
  await expect(wizard.getByText(moved.origins[0], { exact: true })).toBeVisible();
  await expect(consent).not.toBeChecked();
  await expect(save).toBeDisabled();
  await consent.check();
  await save.click();
  await expect(page.getByRole("dialog", { name: "选一个工作文件夹" })).toBeVisible();
  expect(saves).toBe(2);
});
