import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

async function createConversation(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "新对话", exact: true }).click();
  await page.getByRole("button", { name: "输入路径", exact: true }).click();
  await page.getByLabel("工作文件夹", { exact: true }).fill(path.join(process.cwd(), ".qingzhou-test/e2e-project"));
  await page.getByLabel("标题", { exact: true }).fill("对话阅读排版");
  await page.getByRole("button", { name: "创建对话", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "新对话", exact: true })).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "会话", exact: true }).getByRole("button").filter({ hasText: "对话阅读排版" }).first()).toContainText("就绪");
}

test("conversation keeps Markdown structure while streaming and makes rich replies readable", async ({ page }, testInfo) => {
  await createConversation(page);
  await page.getByLabel("输入消息", { exact: true }).fill("RENDER_CONVERSATION");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const log = page.getByRole("log");
  await expect(log).toContainText("const greeting");
  await expect(page.getByRole("button", { name: "停止", exact: true })).toBeVisible();
  const headingDuringStream = await log.getByRole("heading", { name: "阅读结论", exact: true }).isVisible();
  await page.screenshot({ path: testInfo.outputPath("conversation-streaming.png"), fullPage: true, animations: "disabled" });
  await expect(page.getByRole("button", { name: "停止", exact: true })).toHaveCount(0);
  await log.getByRole("heading", { name: "阅读结论", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("conversation-desktop.png"), fullPage: true, animations: "disabled" });
  expect(headingDuringStream).toBe(true);
  await expect(log.getByRole("table")).toHaveCount(1);
  await expect(log.locator(".markdown-pre code")).toContainText("console.log(greeting)");
  await expect(log.locator("a[href^='javascript:'], script")).toHaveCount(0);
  expect(await page.evaluate(() => (window as Window & { __markdownInjected?: boolean }).__markdownInjected)).toBeUndefined();
  await expect(log.getByRole("button", { name: "2 段思考记录", exact: false })).toHaveAttribute("aria-expanded", "false");
  await expect(log.getByRole("button", { name: "读取了 2 个文件", exact: false })).toHaveAttribute("aria-expanded", "false");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await log.getByRole("button", { name: "复制代码", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("const greeting = '你好，轻舟';\nconsole.log(greeting);");
  for (const width of [533, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await log.getByRole("heading", { name: "实施方案", exact: true }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`conversation-${width}.png`), fullPage: true, animations: "disabled" });
  }
  await page.getByRole("button", { name: "切换到深色", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("conversation-dark.png"), fullPage: true, animations: "disabled" });
});

test("a tool group exposes a failure that arrives after its initial collapsed render", async ({ page }) => {
  await createConversation(page);
  await page.getByLabel("输入消息", { exact: true }).fill("RENDER_TOOL_FAILURE");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const group = page.getByRole("log").getByRole("button", { name: "读取了 2 个文件", exact: false });
  await expect(group).toBeVisible();
  await expect(page.getByRole("log").getByText("读取失败：文件暂不可用，原始输出仍可查看。", { exact: true })).toBeVisible();
  await expect(group).toHaveAttribute("aria-expanded", "true");
  await group.click();
  await expect(group).toHaveAttribute("aria-expanded", "false");
});
