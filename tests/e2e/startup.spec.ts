import { expect, test, type Locator, type Page } from "@playwright/test";
import type { SetupStatus } from "../../apps/web/src/components/setup/SetupWizard";

function accountFields(configured?: boolean) {
  return {
    authConfigured: configured,
    authEntries: configured ? [{ id: "google", label: "Google Gemini", kind: "api_key", source: "auth_file" }] : [],
    configuredProviders: configured ? ["google"] : [],
  };
}

async function isolateConversation(page: Page, configured: () => boolean | undefined, title?: string) {
  // The server is shared by the suite. Expose only this test's conversation and account.
  await page.routeWebSocket("**/ws", (socket) => {
    const server = socket.connectToServer();
    server.onMessage((message) => {
      const frame = JSON.parse(String(message));
      for (const event of frame.__batch ? frame.events : [frame]) {
        if (event.type === "snapshot") {
          const tasks = event.payload.tasks.filter((task: { title: string }) => task.title === title);
          Object.assign(event.payload, accountFields(configured()), { tasks, activeTaskId: tasks[0]?.id ?? null });
        }
      }
      socket.send(JSON.stringify(frame));
    });
  });
}

async function openWorkbench(page: Page, configured: boolean, title?: string) {
  await isolateConversation(page, () => configured, title);
  let setup: SetupStatus;
  await page.route("**/api/setup", async (route) => {
    const response = await route.fetch();
    setup = await response.json();
    await route.fulfill({ response, json: { ...setup, ...accountFields(configured), needsSetup: false } });
  });
  await page.route("**/api/setup/api-key", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ provider: "google", apiKey: "gemini-e2e-focus" });
    configured = true;
    await route.fulfill({ json: { ...setup, ...accountFields(configured), needsSetup: false } });
  });
  await Promise.all([
    page.waitForResponse((result) => new URL(result.url()).pathname === "/api/setup" && result.ok()),
    page.goto("/"),
  ]);
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
});

async function expectCenteredAction(main: Locator, action: Locator) {
  await expect(action).toBeInViewport();
  const area = (await main.boundingBox())!;
  const button = (await action.boundingBox())!;
  expect(Math.abs(button.x + button.width / 2 - area.x - area.width / 2)).toBeLessThan(24);
  const centerY = (button.y + button.height / 2 - area.y) / area.height;
  expect(centerY).toBeGreaterThan(0.33);
  expect(centerY).toBeLessThan(0.75);
}

for (const [layout, viewport] of [
  ["desktop", { width: 1280, height: 800 }],
  ["compact", { width: 375, height: 812 }],
] as const) {
  test(`empty conversation gives an unconnected account one centered connection action on ${layout}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await openWorkbench(page, false);
    const main = page.getByRole("main");
    const connect = main.getByRole("link", { name: "连接模型", exact: true });
    await expectCenteredAction(main, connect);
    await expect(main.getByRole("heading", { name: "先连接一个模型" })).toBeVisible();
    await expect(main.getByText(/API Key.*登录/)).toBeVisible();
    await expect(main.getByRole("button")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "连接模型", exact: true })).toHaveCount(1);
    await expect(connect).toHaveAttribute("href", "/settings#settings-auth");
    await page.screenshot({ path: testInfo.outputPath("connect-model.png"), animations: "disabled" });
    if (layout === "compact") await page.getByRole("button", { name: "打开导航" }).click();
    const create = page.getByRole("complementary", { name: "会话", exact: true }).getByRole("button", { name: "新对话", exact: true });
    await create.click();
    await expect(page.getByRole("dialog", { name: "新对话", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    const drawer = page.getByRole("dialog", { name: "工作区导航" });
    if (await drawer.isVisible()) await drawer.getByRole("button", { name: "关闭导航" }).click();
    await connect.click();
    await expect(page).toHaveURL(/\/settings#settings-auth$/);
    await expect(page.getByRole("navigation", { name: "设置分组" }).getByRole("link", { name: "账号与认证" })).toHaveAttribute("aria-current", "page");
    const back = page.getByRole("link", { name: "返回对话", exact: true });
    await back.click();
    await expect(connect).toBeFocused();
    await connect.press("Enter");
    await expect(back).toBeVisible();
    await page.goBack();
    await expect(connect).toBeFocused();

    if (layout === "desktop") {
      await connect.press("Enter");
      await page.getByLabel("Google Gemini API Key", { exact: true }).fill("gemini-e2e-focus");
      await page.getByRole("button", { name: "保存密钥", exact: true }).click();
      await expect(page.getByText(/已保存密钥。/)).toBeVisible();
      await back.click();
      await expect(main.getByRole("button", { name: "新建对话", exact: true })).toBeFocused();
    }
  });

  test(`empty conversation gives a connected account a centered new conversation action on ${layout}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await openWorkbench(page, true);
    const main = page.getByRole("main");
    const create = main.getByRole("button", { name: "新建对话", exact: true });
    await expectCenteredAction(main, create);
    await expect(main.getByRole("heading", { name: "开始一段对话" })).toBeVisible();
    await expect(main.getByText(/工作文件夹.*提问/)).toBeVisible();
    await expect(page.getByRole("link", { name: "连接模型", exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("start-conversation.png"), animations: "disabled" });
    await create.click();
    await expect(page.getByRole("dialog", { name: "新对话", exact: true })).toBeVisible();
  });
}

test("returning before a credential save completes preserves the user's focus choice", async ({ context }) => {
  for (const moveToSearch of [false, true]) {
    await test.step(moveToSearch ? "keep focus in conversation search" : "transfer focus to the new primary action", async () => {
      const page = await context.newPage();
      let releaseSave!: () => void;
      const pending = new Promise<void>((resolve) => { releaseSave = resolve; });
      try {
        await openWorkbench(page, false);
        await page.route("**/api/setup/api-key", async (route) => {
          await pending;
          await route.fallback();
        });
        const main = page.getByRole("main");
        const connect = main.getByRole("link", { name: "连接模型", exact: true });
        await connect.click();
        await page.getByLabel("Google Gemini API Key", { exact: true }).fill("gemini-e2e-focus");
        await Promise.all([
          page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/api/setup/api-key"),
          page.getByRole("button", { name: "保存密钥", exact: true }).click(),
        ]);
        await page.getByRole("link", { name: "返回对话", exact: true }).click();
        await expect(connect).toBeFocused();
        const search = page.getByRole("textbox", { name: "搜索会话" });
        if (moveToSearch) {
          await search.click();
          await page.keyboard.insertText("项目");
        }
        releaseSave();
        const create = main.getByRole("button", { name: "新建对话", exact: true });
        await expect(create).toBeVisible();
        if (moveToSearch) {
          await expect(search).toBeFocused();
          await page.keyboard.insertText("计划");
          await expect(search).toHaveValue("项目计划");
        } else {
          await expect(create).toBeFocused();
        }
      } finally {
        releaseSave();
        await page.unrouteAll({ behavior: "wait" });
        await page.close();
      }
    });
  }
});

test("an existing conversation without credentials keeps a compact keyboard-accessible connection hint", async ({ page }, testInfo) => {
  const title = `待配置模型的对话 ${testInfo.repeatEachIndex}`;
  await openWorkbench(page, false, title);
  await page.getByRole("complementary", { name: "会话", exact: true }).getByRole("button", { name: "新对话", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新对话", exact: true });
  await dialog.getByLabel("标题", { exact: true }).fill(title);
  await dialog.getByRole("button", { name: "创建对话", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });

  const hint = page.getByRole("status").filter({ has: page.getByRole("link", { name: "连接模型", exact: true }) });
  const connect = hint.getByRole("link", { name: "连接模型", exact: true });
  await expect(connect).toBeInViewport();
  expect((await hint.boundingBox())!.height).toBeLessThan(80);
  await expect(page.getByRole("main").getByRole("link", { name: "连接模型", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("输入消息", { exact: true })).toBeInViewport();
  await connect.press("Enter");
  await expect(page).toHaveURL(/\/settings#settings-auth$/);
});

test("a slow or failed credential scan keeps the workbench socket available without reporting missing credentials", async ({ page }) => {
  let releaseScan!: () => void;
  const scan = new Promise<void>((resolve) => { releaseScan = resolve; });
  await isolateConversation(page, () => undefined);
  await page.route("**/api/setup", async (route) => {
    await scan;
    await route.fulfill({ status: 503, json: { error: "读取失败" } });
  });
  const session = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/session" && response.request().method() === "HEAD",
  { timeout: 5000 });
  const connected = page.waitForEvent("websocket", { predicate: (socket) => socket.url().endsWith("/ws"), timeout: 5000 });
  const missing = page.getByRole("link", { name: "连接模型", exact: true })
    .or(page.getByRole("heading", { name: "先连接一个模型" }));
  try {
    const [, response] = await Promise.all([page.goto("/"), session, connected]);
    expect(response.status()).toBe(204);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(missing).toHaveCount(0);
    const failed = page.waitForResponse((result) => new URL(result.url()).pathname === "/api/setup" && result.status() === 503);
    releaseScan();
    await (await failed).finished();
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(missing).toHaveCount(0);
    await expect(page.getByText("连接模型服务后即可发送消息。", { exact: true })).toHaveCount(0);
  } finally {
    releaseScan();
  }
});

test("an explicit missing-credentials snapshot still offers a connection when the setup request fails", async ({ page }) => {
  await isolateConversation(page, () => false);
  await page.route("**/api/setup", (route) => route.fulfill({ status: 503 }));
  await page.goto("/");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "先连接一个模型" })).toBeVisible();
  await expect(main.getByRole("link", { name: "连接模型" })).toHaveAttribute("href", "/settings#settings-auth");
});
