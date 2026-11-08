import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const project = path.join(process.cwd(), ".qingzhou-test/e2e-project");
const home = path.join(process.cwd(), ".qingzhou-test/e2e-home");
const otherProject = path.join(home, "second-project");
test.beforeAll(() => {
  mkdirSync(project, { recursive: true });
  mkdirSync(otherProject, { recursive: true });
  writeFileSync(path.join(otherProject, "AGENTS.md"), "# second project rules\n");
  mkdirSync(path.join(home, ".pi/agent/skills/demo"), { recursive: true });
  writeFileSync(path.join(project, "AGENTS.md"), "# interaction test rules\n");
  writeFileSync(path.join(home, ".pi/agent/AGENTS.md"), "# global test rules\n");
  writeFileSync(path.join(home, ".pi/agent/auth.json"), JSON.stringify({ github: { type: "oauth" } }));
  writeFileSync(path.join(home, ".pi/agent/skills/demo/SKILL.md"), "# demo");
});

async function createConversation(page: Page, title: string, cwd = project) {
  await page.goto("/");
  await page.getByRole("button", { name: "新对话", exact: true }).click();
  await page.getByRole("button", { name: "输入路径" }).click();
  await page.getByLabel("工作文件夹").fill(cwd);
  await page.getByLabel("标题", { exact: true }).fill(title);
  await page.getByRole("button", { name: "创建对话" }).click();
  await expect(page.getByRole("dialog", { name: "新对话", exact: true })).toHaveCount(0);
  await expect(page.getByRole("banner").getByText(title, { exact: true })).toBeVisible();
  await expect(page.getByLabel("输入消息")).toBeEnabled();
  await expect(page.getByRole("complementary", { name: "会话", exact: true }).getByRole("button").filter({ hasText: title }).first()).toContainText("就绪");
}
async function createPlan(page: Page, title: string, description = "original goal") {
  await page.goto("/board");
  await page.getByRole("button", { name: "项目", exact: true }).click();
  await page.getByRole("menuitem", { name: "新项目…" }).click();
  const dialog = page.getByRole("dialog", { name: "启动项目" });
  await dialog.getByRole("button", { name: "输入路径" }).click();
  await dialog.getByLabel("项目文件夹").fill(project);
  await dialog.getByLabel("项目名称").fill(`Project ${title}`);
  await dialog.getByRole("button", { name: "启动项目", exact: true }).click();
  await page.getByRole("button", { name: "新建任务" }).click();
  await page.getByLabel("标题", { exact: true }).fill(title);
  await page.getByLabel("目标说明").fill(description);
  await page.getByRole("button", { name: "保存到计划" }).click();
  await page.getByText(title, { exact: true }).click();
  await expect(page.getByRole("dialog", { name: title })).toBeVisible();
}

test("popover Esc never aborts a running reply and restores its trigger", async ({ page }) => {
  const commands: string[] = [];
  await page.routeWebSocket("**/ws", (route) => {
    const server = route.connectToServer();
    route.onMessage((message) => { commands.push(JSON.parse(String(message)).type); server.send(message); });
  });
  await createConversation(page, "Esc safeguard");
  await page.getByLabel("输入消息").fill(`please stream this slowly ${"word ".repeat(80)}`);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("button", { name: "停止", exact: true })).toBeVisible();
  const mode = page.getByRole("button", { name: "模式", exact: true });
  await mode.click();
  await expect(page.getByRole("dialog", { name: "模式与审批" })).toBeVisible();
  await page.screenshot({ path: "/tmp/qingzhou-mode-after.png" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "模式与审批" })).toHaveCount(0);
  await expect(mode).toBeFocused();
  await page.getByRole("button", { name: "上下文用量", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "上下文用量" })).toHaveCount(0);
  await page.getByLabel("输入消息").press("ControlOrMeta+f");
  await expect(page.getByLabel("在对话中查找")).toBeVisible();
  await mode.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "模式与审批" })).toHaveCount(0);
  await expect(page.getByLabel("在对话中查找")).toBeVisible();
  await page.getByLabel("在对话中查找").press("Escape");
  expect(commands).not.toContain("agent.abort");
  await expect(page.getByRole("button", { name: "停止", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "停止", exact: true }).click();
});

test("new conversation focus stays in the modal and Esc returns focus", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "新对话", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "新对话" });
  await expect(dialog).toContainText("默认使用当前工作文件夹");
  await expect.poll(() => dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await dialog.getByRole("button", { name: "创建对话" }).focus();
  await page.keyboard.press("Tab");
  expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("sidebar search, collapse, rename, and archive undo are recoverable", async ({ page }) => {
  await createConversation(page, "Sidebar recovery");
  const sidebar = page.getByRole("complementary", { name: "会话", exact: true });
  await page.getByLabel("搜索会话").fill("no-matching-conversation-54321");
  await expect(sidebar).toContainText("没有匹配的会话");
  await sidebar.getByRole("button", { name: "清空搜索" }).click();
  const heading = sidebar.getByRole("heading").filter({ hasText: "e2e-project" }).getByRole("button");
  await heading.click();
  await expect(sidebar.getByText("Sidebar recovery", { exact: true })).toBeHidden();
  await heading.click();
  await sidebar.getByRole("button", { name: "会话操作 Sidebar recovery" }).click();
  await sidebar.getByRole("menuitem", { name: "重命名" }).click();
  await sidebar.getByLabel("重命名会话").fill("Sidebar renamed");
  await sidebar.getByLabel("重命名会话").press("Enter");
  await expect(sidebar.getByText("Sidebar renamed", { exact: true })).toBeVisible();
  await page.getByLabel("搜索会话").fill("Sidebar");
  await expect(sidebar.locator("li[draggable=true]")).toHaveCount(0);
  await page.getByLabel("搜索会话").fill("");
  await sidebar.getByRole("button", { name: "会话操作 Sidebar renamed" }).click();
  await sidebar.getByRole("menuitem", { name: "归档 Sidebar renamed" }).click();
  await expect(sidebar.getByText("Sidebar renamed", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "撤销归档" }).click();
  await expect(sidebar.getByText("Sidebar renamed", { exact: true })).toBeVisible();
  await page.reload();
  await expect(sidebar.getByText("Sidebar renamed", { exact: true })).toBeVisible();
  await sidebar.getByRole("button", { name: "会话操作 Sidebar renamed" }).click();
  await sidebar.getByRole("menuitem", { name: "归档 Sidebar renamed" }).click();
  await expect(page.getByRole("button", { name: "撤销归档" })).toBeVisible();
  await page.reload();
  await sidebar.getByRole("button", { name: "已归档会话" }).click();
  await page.getByRole("button", { name: "恢复 Sidebar renamed" }).click();
  await page.keyboard.press("Escape");
  await expect(sidebar.getByText("Sidebar renamed", { exact: true })).toBeVisible();
});

test("objective drafts survive close, reload, and settings round-trip until saved or discarded", async ({ page }) => {
  await createPlan(page, "Durable objective");
  await page.getByLabel("目标说明").fill("unsaved revised goal");
  await expect(page.getByText("草稿已暂存，关闭后可继续编辑")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Durable objective" })).toHaveCount(0);
  await page.getByRole("button", { name: "Durable objective 准备开始" }).click();
  await expect(page.getByLabel("目标说明")).toHaveValue("unsaved revised goal");
  await page.reload();
  await expect(page.getByLabel("目标说明")).toHaveValue("unsaved revised goal");
  // A modal deliberately prevents background navigation; close before opening settings.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Durable objective" })).toHaveCount(0);
  await expect(page).not.toHaveURL(/item=/);
  await page.getByLabel("搜索任务").fill("Durable");
  await page.getByRole("link", { name: "设置", exact: true }).click();
  await page.getByRole("link", { name: "返回工作" }).click();
  await expect(page.getByLabel("搜索任务")).toHaveValue("Durable");
  await page.getByRole("button", { name: "Durable objective 准备开始" }).click();
  await expect(page.getByLabel("目标说明")).toHaveValue("unsaved revised goal");
  await page.getByRole("button", { name: "放弃修改" }).click();
  await expect(page.getByLabel("目标说明")).toHaveValue("original goal");
  await page.getByLabel("目标说明").fill("saved revised goal");
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("目标说明")).toHaveValue("saved revised goal");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "新建任务" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "新建任务" })).toHaveCount(0);
  await page.getByLabel("搜索任务").fill("no-matching-task-54321");
  await expect(page.getByText("没有匹配的任务")).toBeVisible();
  await page.getByRole("button", { name: "清空搜索" }).click();
  await expect(page.getByText("Durable objective", { exact: true })).toBeVisible();
});

test("rules drafts survive resource tab switches and reload", async ({ page }) => {
  await createConversation(page, "Rules draft");
  await page.getByRole("button", { name: "详情", exact: true }).click();
  await page.getByRole("button", { name: "资源", exact: true }).click();
  await page.getByRole("button", { name: "约定", exact: true }).click();
  const editor = page.getByLabel("约定内容");
  await expect(editor).toBeEnabled();
  await editor.fill("# local unsaved rules");
  await page.getByRole("button", { name: "技能", exact: true }).click();
  await page.getByRole("button", { name: "约定", exact: true }).click();
  await expect(editor).toHaveValue("# local unsaved rules");
  await page.reload();
  await page.getByRole("button", { name: "详情", exact: true }).click();
  await page.getByRole("button", { name: "资源", exact: true }).click();
  await page.getByRole("button", { name: "约定", exact: true }).click();
  await expect(editor).toBeEnabled();
  await expect(editor).toHaveValue("# local unsaved rules");
  await page.getByRole("button", { name: "放弃修改" }).click();
  await expect(editor).toHaveValue("# interaction test rules\n");
});

test("rule file switching is paused during a slow save", async ({ page }) => {
  let releaseSave: (() => void) | null = null;
  const writeIds = new Set<string>();
  let completedSaves = 0;
  await page.routeWebSocket("**/ws", (route) => {
    const server = route.connectToServer();
    server.onMessage((message) => {
      const frame = JSON.parse(String(message));
      for (const event of frame.__batch ? frame.events : [frame]) {
        if (event.type === "request.succeeded" && writeIds.delete(event.payload.requestId)) completedSaves += 1;
      }
      route.send(message);
    });
    route.onMessage((message) => {
      const command = JSON.parse(String(message));
      if (command.type === "resources.write") { writeIds.add(command.id); releaseSave = () => server.send(message); }
      else server.send(message);
    });
  });
  await createConversation(page, "Rules other project", otherProject);
  await createConversation(page, "Rules saving");
  await page.getByRole("button", { name: "详情", exact: true }).click();
  await page.getByRole("button", { name: "固定详情", exact: true }).click();
  await page.getByRole("button", { name: "资源", exact: true }).click();
  const editor = page.getByLabel("约定内容");
  await expect(editor).toBeEnabled();
  await editor.fill("# saved local content");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => Boolean(releaseSave)).toBe(true);
  const globalTab = page.locator(`button[title="${path.join(home, ".pi/agent/AGENTS.md")}"]`);
  await expect(globalTab).toBeDisabled();
  releaseSave!();
  await expect.poll(() => completedSaves).toBe(1);
  await expect(globalTab).toBeEnabled();
  await globalTab.click();
  await expect(editor).toBeEnabled();
  await expect(editor).toHaveValue("# global test rules\n");
  const localTab = page.locator(`button[title="${path.join(project, "AGENTS.md")}"]`);
  await localTab.click();
  await expect(editor).toBeEnabled();
  await editor.fill("# delayed save from previous project");
  releaseSave = null;
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => Boolean(releaseSave)).toBe(true);
  await page.getByRole("complementary", { name: "会话", exact: true }).getByRole("button").filter({ hasText: "Rules other project" }).first().click();
  await expect(editor).toBeEnabled();
  await expect(editor).toHaveValue("# second project rules\n");
  releaseSave!();
  await expect.poll(() => completedSaves).toBe(2);
  await expect(editor).toHaveValue("# second project rules\n");
});

test("a composer popover keeps focus inside the work conversation modal", async ({ page }) => {
  await createPlan(page, "Nested focus", `please stream this slowly ${"word ".repeat(80)}`);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Nested focus" })).toHaveCount(0);
  await page.getByRole("button", { name: /^全部 / }).click();
  await page.getByRole("article").filter({ hasText: "Nested focus" }).getByRole("button", { name: "开始执行", exact: true }).click();
  await page.getByRole("article").filter({ hasText: "Nested focus" }).getByRole("button", { name: "查看执行", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Nested focus" });
  await drawer.getByRole("button", { name: "模式", exact: true }).click();
  await expect(drawer.getByRole("dialog", { name: "模式与审批" })).toBeVisible();
  const end = drawer.locator("button:enabled").last();
  await end.focus();
  await page.keyboard.press("Tab");
  expect(await drawer.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(drawer.getByRole("dialog", { name: "模式与审批" })).toHaveCount(0);
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
});

test("settings distinguishes load failure, retries, and failed trust save", async ({ page }) => {
  await page.route("**/api/setup", (route) => route.fulfill({ status: 503, json: { error: "offline" } }));
  await page.goto("/settings");
  await expect(page.getByRole("alert")).toContainText("读取设置失败");
  await page.getByRole("link", { name: "模型与引擎", exact: true }).click();
  await expect(page.getByText("暂时无法读取", { exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "设置分组" }).getByRole("link", { name: "项目", exact: true }).click();
  await expect(page.getByLabel("信任默认工作区")).toBeDisabled();
  await page.unroute("**/api/setup");
  await page.getByRole("button", { name: "重试", exact: true }).click();
  const trust = page.getByLabel("信任默认工作区");
  await expect(trust).toBeEnabled();
  const previous = await trust.isChecked();
  await page.route("**/api/setup/trust", (route) => route.fulfill({ status: 503, json: { error: "无法保存项目权限" } }));
  await trust.focus();
  await trust.press("Space");
  await expect(page.getByRole("alert")).toContainText("无法保存项目权限");
  expect(await trust.isChecked()).toBe(previous);
});

test("discrete mode choices retain permissions and settings fits narrow light and dark views", async ({ page }) => {
  await createConversation(page, "Readable selectors");
  await page.getByRole("button", { name: "模式", exact: true }).click();
  const policy = page.getByRole("dialog", { name: "模式与审批" });
  await expect(policy.getByText("交互模式", { exact: true })).toBeVisible();
  await expect(policy.getByRole("button", { name: "每次确认", exact: true })).toBeVisible();
  await expect(policy.locator(".policy-picker-rail").last().getByRole("button")).toHaveText(["只读", "每次确认", "自动审核", "自动通过"]);
  await expect(policy.getByRole("slider")).toHaveCount(0);
  await policy.getByRole("button", { name: "规划", exact: true }).click();
  await expect(policy.getByRole("button", { name: "规划", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(policy.getByRole("button", { name: "自动通过", exact: true })).toBeDisabled();
  await policy.getByRole("button", { name: "代理", exact: true }).click();
  await expect(policy.getByRole("button", { name: "代理", exact: true })).toHaveAttribute("aria-pressed", "true");
  await policy.getByRole("button", { name: "自动通过", exact: true }).click();
  await expect(policy.getByRole("button", { name: "自动通过", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await page.reload();
  await page.getByRole("button", { name: "模式", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "模式与审批" }).getByRole("button", { name: "自动通过", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "模型和思考", exact: true }).click();
  const model = page.getByRole("dialog", { name: "模型和思考" });
  await expect(model.getByRole("slider", { name: "滑动选择思考强度" })).toBeVisible();
  await expect(model.getByText("思考强度", { exact: true })).toBeVisible();
  await model.getByRole("slider", { name: "滑动选择思考强度" }).fill("3");
  await expect(page.getByRole("button", { name: "模型和思考" })).toContainText("中");
  await page.keyboard.press("Escape");
  await page.goto("/settings");
  await page.getByRole("button", { name: "环境变量", exact: true }).click();
  await expect(page.getByText(/修改系统环境或 .env 后/)).toBeVisible();
  await page.getByRole("navigation", { name: "设置分组" }).getByRole("link", { name: "项目", exact: true }).click();
  await expect(page.getByText("默认工作文件夹", { exact: true })).toBeVisible();
  await expect(page.getByText("新对话默认使用此目录，可在会话中切换。")).toBeVisible();
  await page.setViewportSize({ width: 533, height: 600 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(533);
  await page.getByRole("link", { name: "外观", exact: true }).click();
  await page.getByRole("button", { name: "浅色", exact: true }).click();
  await page.screenshot({ path: ".qingzhou-test/ui-audit/51-settings-narrow-light.png", fullPage: true });
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(533);
  await page.screenshot({ path: ".qingzhou-test/ui-audit/52-settings-narrow-dark.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: ".qingzhou-test/ui-audit/53-settings-mobile.png", fullPage: true });
});

test("a rejected objective save keeps the draft available for retry", async ({ page }) => {
  let rejectSave = true;
  let delaySave = false;
  let releaseSave: (() => void) | null = null;
  await page.routeWebSocket("**/ws", (route) => {
    const server = route.connectToServer();
    let latest: Record<string, unknown> = {};
    server.onMessage((message) => {
      const frame = JSON.parse(String(message));
      latest = frame.__batch ? frame.events.at(-1) : frame;
      route.send(message);
    });
    route.onMessage((message) => {
      const command = JSON.parse(String(message));
      if (rejectSave && command.type === "workItem.update") {
        route.send(JSON.stringify({ ...latest, eventId: `failed-${command.id}`, type: "request.failed", payload: { requestId: command.id, error: "测试保存失败，请重试" } }));
      } else if (delaySave && command.type === "workItem.update") {
        releaseSave = () => server.send(message);
      } else server.send(message);
    });
  });
  await createPlan(page, "Rejected save");
  await page.getByLabel("目标说明").fill("draft after failed save");
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByRole("alert").last()).toContainText("测试保存失败");
  await expect(page.getByLabel("目标说明")).toHaveValue("draft after failed save");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Rejected save" })).toHaveCount(0);
  await page.getByRole("button", { name: "Rejected save 准备开始" }).click();
  await expect(page.getByLabel("目标说明")).toHaveValue("draft after failed save");
  rejectSave = false;
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  delaySave = true;
  await page.getByLabel("目标说明").fill("first delayed revision");
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect.poll(() => Boolean(releaseSave)).toBe(true);
  await page.getByLabel("目标说明").fill("newer unsaved revision");
  releaseSave!();
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("目标说明")).toHaveValue("newer unsaved revision");
});


test("a pending send keeps typing available and disables duplicate submission until acknowledged", async ({ page }) => {
  let release: (() => void) | undefined;
  let held = false;
  await page.routeWebSocket("**/ws", (route) => {
    const server = route.connectToServer();
    server.onMessage((message) => route.send(message));
    route.onMessage((message) => {
      const command = JSON.parse(String(message));
      if (!held && command.type === "prompt.send") {
        held = true;
        release = () => server.send(message);
      } else server.send(message);
    });
  });
  await createConversation(page, "Pending send feedback");
  await page.getByLabel("输入消息").fill("request held for acknowledgment");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await page.getByLabel("输入消息").fill("keep typing while send pending");
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "发送", exact: true })).toHaveAttribute("aria-busy", "true");
  release!();
  await expect(page.getByText("Echo: request held for acknowledgment", { exact: true })).toBeVisible();
  await expect(page.getByLabel("输入消息")).toHaveValue("keep typing while send pending");
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeEnabled();
});

test("settings section navigation preserves the work return target and keeps navigation visible", async ({ page }) => {
  await page.goto("/board");
  await page.getByRole("link", { name: "设置", exact: true }).click();
  await expect(page.getByRole("link", { name: "返回工作", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "设置分组" }).getByRole("link", { name: "关于与更新", exact: true }).click();
  await expect(page.getByRole("link", { name: "返回工作", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "设置分组" })).toBeInViewport();
  await expect(page.getByRole("button", { name: "更新详情", exact: true })).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: "立即检查", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "更新详情", exact: true }).click();
  await expect(page.getByRole("button", { name: "收起详情", exact: true })).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("link", { name: "返回工作", exact: true }).click();
  await expect(page).toHaveURL(/\/board/);
});

test("a question displays waiting feedback and empty Enter cannot bypass a disabled confirmation", async ({ page }) => {
  await createConversation(page, "Question clarity");
  await page.getByLabel("输入消息").fill("INPUT:填写本轮说明");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const dialog = page.getByTestId("interaction-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("complementary", { name: "会话", exact: true })).toContainText("等待回答");
  await expect(page.getByText("回答当前问题后继续", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "确定", exact: true })).toBeDisabled();
  await dialog.getByRole("textbox").press("Enter");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox").fill("已检查当前实现");
  await dialog.getByRole("textbox").press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Input: 已检查当前实现", { exact: true })).toBeVisible();
});

test("compact directory selection keeps a typed path when an older browse request returns", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新对话", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新对话", exact: true });
  await expect(dialog.locator(".folder-field-summary")).toContainText(project);
  await expect(dialog.getByRole("tree")).toHaveCount(0);
  let releaseBrowse: (() => Promise<void>) | undefined;
  await page.route("**/api/folders?**", (route) => {
    releaseBrowse = () => route.fulfill({ json: { cwd: project, parent: null, entries: [], roots: [project] } });
  });
  await dialog.getByRole("button", { name: "浏览", exact: true }).click();
  await expect.poll(() => Boolean(releaseBrowse)).toBe(true);
  await dialog.getByRole("button", { name: "输入路径", exact: true }).click();
  await dialog.getByLabel("工作文件夹", { exact: true }).fill(`${project}/typed-folder`);
  await releaseBrowse!();
  await expect(dialog.getByLabel("工作文件夹", { exact: true })).toHaveValue(`${project}/typed-folder`);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "新对话", exact: true })).toBeFocused();
});

test("conversation conversion creates a project without losing its source or draft", async ({ page }) => {
  const directory = path.join(project, "conversion-ui-redesign");
  mkdirSync(directory, { recursive: true });
  await createConversation(page, "转需求草稿恢复", directory);
  await page.getByLabel("输入消息").fill("保留这个讨论作为需求来源");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("Echo: 保留这个讨论作为需求来源", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "整理为需求", exact: true }).click();
  const conversion = page.getByRole("dialog", { name: "整理为需求", exact: true });
  await conversion.getByLabel("目标说明").fill("保留输入的目标草稿");
  await conversion.getByLabel("验收标准").fill("来源可追溯，保存后不执行");
  await conversion.getByRole("button", { name: "新建项目", exact: true }).click();
  const projectDialog = page.getByRole("dialog", { name: "启动项目", exact: true });
  await projectDialog.getByLabel("项目名称").fill("不保存的名称");
  await page.keyboard.press("Escape");
  await expect(conversion).toBeVisible();
  await expect(conversion.getByLabel("目标说明")).toHaveValue("保留输入的目标草稿");
  await expect(conversion.getByRole("button", { name: "新建项目", exact: true })).toBeFocused();
  await conversion.getByRole("button", { name: "新建项目", exact: true }).click();
  await projectDialog.getByLabel("项目名称").fill("对话转需求示例");
  await projectDialog.getByRole("button", { name: "启动项目", exact: true }).click();
  await expect(projectDialog).toBeHidden();
  await expect(conversion.getByLabel("目标项目").locator("option:checked")).toHaveText("对话转需求示例");
  await expect(conversion.getByLabel("验收标准")).toHaveValue("来源可追溯，保存后不执行");
  await expect(conversion.locator("summary").filter({ hasText: "选择作为依据的聊天片段" })).toContainText("2 条");
  await expect(conversion.getByRole("button", { name: "保存并完善需求", exact: true })).toBeDisabled();
});

test("settings groups retain local inputs and theme changes fit the supported narrow windows", async ({ page }, testInfo) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "API Key", exact: true }).click();
  await page.getByLabel("服务商").selectOption("anthropic");
  const key = page.getByLabel("Anthropic (Claude) API Key");
  await key.fill("test-only-unsaved-value");
  await page.getByRole("link", { name: "外观", exact: true }).click();
  await expect(key).toBeHidden();
  for (const theme of ["浅色", "深色"] as const) {
    await page.getByRole("button", { name: theme, exact: true }).click();
    for (const width of [533, 390]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.getByRole("navigation", { name: "设置分组" })).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath(`settings-${theme}-${width}.png`) });
    }
  }
  await page.getByRole("link", { name: "账号与认证", exact: true }).click();
  await expect(key).toHaveValue("test-only-unsaved-value");
  await expect(page.getByRole("button", { name: "API Key", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("setup distinguishes an environment key from a saved login", async ({ page }) => {
  await page.route('**/api/setup', async (route) => {
    const response = await route.fetch();
    const status = await response.json();
    await route.fulfill({ response, json: { ...status, needsSetup: true, setupCompleted: false,
      authConfigured: true, configuredProviders: ['deepseek'],
      authEntries: [{ id: 'deepseek', label: 'DeepSeek', kind: 'api_key', source: 'env', envVar: 'DEEPSEEK_API_KEY' }] } });
  });
  await page.goto('/');
  const wizard = page.getByRole('dialog');
  await wizard.getByRole('button', { name: '继续', exact: true }).click();
  await wizard.getByRole('button', { name: 'API Key', exact: true }).click();
  await wizard.getByLabel('服务商', { exact: true }).selectOption('deepseek');
  await expect(wizard.getByText('环境变量 DEEPSEEK_API_KEY', { exact: true })).toBeVisible();
  await expect(wizard.getByText('已保存密钥', { exact: true })).toHaveCount(0);
  await wizard.getByRole('button', { name: '使用现有连接', exact: true }).click();
  await expect(wizard.getByRole('heading', { name: '选一个工作文件夹', exact: true })).toBeVisible();
});
