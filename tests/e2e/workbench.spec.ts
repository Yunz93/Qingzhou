import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";

const project = path.join(process.cwd(), ".qingzhou-test", "e2e-project");
const home = path.join(process.cwd(), ".qingzhou-test", "e2e-home");

test.beforeAll(() => {
  mkdirSync(project, { recursive: true });
  mkdirSync(path.join(home, ".pi", "agent", "skills", "demo"), { recursive: true });
  mkdirSync(path.join(home, ".pi", "agent", "extensions"), { recursive: true });
  mkdirSync(path.join(home, ".pi", "agent", "sessions", "e2e"), { recursive: true });
  writeFileSync(path.join(project, "README.md"), "e2e");
  writeFileSync(path.join(project, "AGENTS.md"), "# e2e agents");
  writeFileSync(
    path.join(home, ".pi", "agent", "auth.json"),
    JSON.stringify({ github: { type: "oauth" } }),
  );
  writeFileSync(path.join(home, ".pi", "agent", "models.json"), JSON.stringify({ models: [{ id: "fake" }] }));
  writeFileSync(path.join(home, ".pi", "agent", "skills", "demo", "SKILL.md"), "# demo");
  writeFileSync(path.join(home, ".pi", "agent", "extensions", "demo-ext.ts"), "export default function () {}");
  writeFileSync(
    path.join(home, ".pi", "agent", "sessions", "e2e", "resume.jsonl"),
    [
      JSON.stringify({ type: "session", id: "e2e-resume", cwd: project }),
      JSON.stringify({
        type: "message",
        message: { role: "user", content: [{ type: "text", text: "resume from e2e" }] },
      }),
    ].join("\n"),
  );
  rmSync(path.join(project, "denied.txt"), { force: true });
  writeFileSync(
    path.join(home, ".pi", "agent", "settings.json"),
    `${JSON.stringify({ packages: [] }, null, 2)}\n`,
  );
  rmSync(path.join(home, ".pi", "agent", "mcp.json"), { force: true });
});

test("workbench core loop", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "新对话" }).click();
  await chooseTypePath(page);
  await page.getByLabel("工作文件夹").fill(project);
  await page.getByLabel("标题").fill("E2E task");
  await page.getByRole("button", { name: "创建对话" }).click();
  await expect(page.getByRole("banner").getByText("E2E task")).toBeVisible();
  await expect(page.getByLabel("输入消息")).toBeEnabled({ timeout: 15_000 });

  await page.getByLabel("输入消息").fill("hello from e2e please stream this slowly for steer");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByRole("button", { name: "停止" })).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("输入消息").fill("steer now");
  await page.getByLabel("输入消息").press("Enter");
  await expect(page.getByText("Steered: steer now").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "停止" })).toHaveCount(0);

  await page.getByLabel("输入消息").fill("change course");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("Echo: change course").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "复制消息" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "克隆会话" })).toBeVisible();

  await page.getByRole("button", { name: "模式" }).click();
  await page.getByRole("menuitem", { name: "每次确认" }).click();
  await expect(page.getByRole("button", { name: "模式" })).toHaveText(/每次确认/);

  await page.getByLabel("输入消息").fill("WRITE:denied.txt:secret");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByRole("heading", { name: "允许修改文件吗？" })).toBeVisible();
  await page.getByLabel("输入消息").click({ force: true });
  await expect(page.getByRole("button", { name: "允许这次" })).toBeVisible();
  await page.getByRole("button", { name: "拒绝", exact: true }).click();
  expect(existsSync(path.join(project, "denied.txt"))).toBe(false);
  await expect(page.getByRole("button", { name: "停止" })).toHaveCount(0);

  await page.getByLabel("输入消息").fill("BASH:echo hi");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByRole("heading", { name: "允许运行这条命令吗？" })).toBeVisible();
  await page.locator(".composer-well").click({ force: true, position: { x: 24, y: 16 } });
  await expect(page.getByRole("button", { name: "拒绝", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "拒绝", exact: true }).click();

  await page.reload();
  await expect(page.getByText("Steered: steer now").first()).toBeVisible();

  await page.getByRole("button", { name: "模型和思考" }).click();
  await page.getByRole("radio", { name: "较高" }).click();
  await page.getByRole("button", { name: /归档 E2E task/ }).click();
});

test("shows an explicit banner when the model changes", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新对话" }).click();
  await chooseTypePath(page);
  await page.getByLabel("工作文件夹").fill(project);
  await page.getByLabel("标题").fill("Model switch");
  await page.getByRole("button", { name: "创建对话" }).click();
  await expect(page.getByRole("banner").getByText("Model switch")).toBeVisible();
  await expect(page.getByLabel("输入消息")).toBeEnabled({ timeout: 15_000 });

  await page.getByRole("button", { name: "模型和思考" }).click();
  await expect(page.getByRole("radio", { name: "很少" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "最大" })).toHaveCount(0);
  await page.getByRole("button", { name: "选择模型" }).click();
  await expect(page.getByText("推荐模型集")).toBeVisible();
  await page.getByRole("menuitem", { name: "Fake Model 2" }).click();
  await expect(page.getByRole("status").filter({ hasText: "模型已从 Fake Model 更改为 Fake Model 2。" })).toBeVisible();
  await page.getByRole("button", { name: "模型和思考" }).click();
  await expect(page.getByRole("radio", { name: "最大" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "很少" })).toHaveCount(0);
});

test("keyboard and viewports", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "n", metaKey: true, bubbles: true }));
  });
  await expect(page.getByRole("heading", { name: "新对话" })).toBeVisible();
  await page.keyboard.press("Escape");

  for (const size of [
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
    { width: 375, height: 812 },
  ] as const) {
    await page.setViewportSize(size);
    await expect(page.locator("body")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);
  }
});

test("macOS traffic lights leave room for the sidebar title", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.evaluate(() => {
    document.documentElement.classList.add("desktop");
    document.documentElement.dataset.platform = "darwin";
  });
  const sidebar = page.getByRole("complementary", { name: "会话" });
  await expect(sidebar).toBeVisible();
  const header = sidebar.locator(".traffic-inline");
  const paddingLeft = await header.evaluate((el) => getComputedStyle(el).paddingLeft);
  expect(Number.parseFloat(paddingLeft)).toBeGreaterThanOrEqual(80);
  const titleLeft = await sidebar.locator("p", { hasText: /^会话$/ }).evaluate((el) => el.getBoundingClientRect().left);
  expect(titleLeft).toBeGreaterThanOrEqual(80);
});

test("macOS traffic lights leave room when the session list is unpinned", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.evaluate(() => {
    document.documentElement.classList.add("desktop");
    document.documentElement.dataset.platform = "darwin";
  });
  const sidebar = page.getByRole("complementary", { name: "会话" });
  await expect(sidebar).toBeVisible();
  await sidebar.getByRole("button", { name: "取消固定会话列表" }).click();
  const sessionsBtn = page.getByRole("button", { name: "会话", exact: true });
  await expect(sessionsBtn).toBeVisible();
  const titlebar = page.locator("header.titlebar");
  const paddingLeft = await titlebar.evaluate((el) => getComputedStyle(el).paddingLeft);
  expect(Number.parseFloat(paddingLeft)).toBeGreaterThanOrEqual(80);
  const btnLeft = await sessionsBtn.evaluate((el) => el.getBoundingClientRect().left);
  expect(btnLeft).toBeGreaterThanOrEqual(80);
});

test("reduced motion disables the status ring spin", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const duration = await page.evaluate(() => {
    const el = document.createElement("div");
    el.className = "pi-ring-spin";
    document.body.appendChild(el);
    return getComputedStyle(el).animationDuration;
  });
  expect(duration === "0s" || duration === "0.01ms").toBeTruthy();
});

test("pi mvp settings, skills, resume, and runtime controls", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByText("启动后自动检查更新")).toBeVisible();
  await expect(page.getByRole("button", { name: /立即检查|正在检查/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "认证" })).toBeVisible();
  await expect(page.getByRole("button", { name: "订阅登录", pressed: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("服务商")).toHaveValue("github");
  await expect(page.getByText("已登录").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "检查更新", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "检查更新", exact: true })).toBeEnabled({ timeout: 20_000 });
  await page.getByRole("button", { name: "API Key", exact: true }).click();
  await page.getByLabel("服务商").selectOption("anthropic");
  await page.getByLabel("Anthropic (Claude) API Key").fill("sk-ant-e2e-updated-key-123456");
  await page.getByRole("button", { name: "保存密钥" }).click();
  await expect(page.getByText("已保存 Anthropic (Claude) 的密钥。")).toBeVisible();
  await expect(page.getByText("已保存密钥").first()).toBeVisible();
  await expect(page.getByText(/models\.json/)).toBeVisible();
  await expect(page.getByText("已找到")).toBeVisible();
  await expect(page.getByText("信任当前项目")).toBeVisible();
  await page.getByRole("button", { name: "打开设置向导" }).click();
  await page.getByRole("button", { name: "继续" }).click();
  await expect(page.getByText("/login")).toBeVisible();
  await expect(page.getByRole("button", { name: "使用已有登录" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto("/");
  await page.getByRole("button", { name: "新对话" }).click();
  await expect(page.getByText("继续本机上的 Pi 会话")).toBeVisible();
  await expect(page.getByText("resume from e2e")).toBeVisible();
  await chooseTypePath(page);
  await page.getByLabel("工作文件夹").fill(project);
  await page.getByLabel("标题").fill("MVP task");
  await page.getByRole("button", { name: "创建对话" }).click();
  await expect(page.getByRole("banner").getByText("MVP task")).toBeVisible();
  await expect(page.getByText("已加载 AGENTS.md")).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "详情" }).click();
  await page.getByRole("button", { name: "资源" }).click();
  await page.getByRole("button", { name: "约定" }).click();
  await expect(page.getByRole("complementary", { name: "详情" }).getByRole("button", { name: "AGENTS.md" }).first()).toBeVisible();
  await page.getByRole("button", { name: "技能" }).click();
  await expect(page.getByRole("complementary", { name: "详情" }).getByText("demo")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "详情" }).getByRole("button", { name: "检查更新" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "详情" }).getByText("没有可更新的系统技能。")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("complementary", { name: "详情" }).getByText("用户 · 本地技能")).toBeVisible();
  await page.getByRole("button", { name: "插件" }).click();
  await expect(page.getByRole("complementary", { name: "详情" }).getByText("pi-web-access")).toBeVisible();
  await page.getByRole("button", { name: "技能" }).click();
  await expect(page.getByRole("complementary", { name: "详情" }).getByText("没有可更新的系统技能。")).toBeVisible();
  await page.getByRole("button", { name: "文件" }).click();
  await page.getByRole("button", { name: "资源" }).click();
  await expect(page.getByRole("complementary", { name: "详情" }).getByText("没有可更新的系统技能。")).toBeVisible();
  await page.getByRole("button", { name: "插件" }).click();
  await expect(page.getByRole("complementary", { name: "详情" }).getByText("demo-ext")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "详情" }).getByText("pi-web-access")).toBeVisible();
  await expect(page.getByRole("button", { name: /安装推荐/ })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "详情" }).getByText("推荐安装")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "详情" }).getByText("已安装", { exact: true })).toHaveCount(0);
  const presetSources = [
    "npm:pi-web-access",
    "npm:pi-memory",
    "npm:@juicesharp/rpiv-todo",
    "npm:pi-subagents",
    "npm:pi-mcp-adapter",
    "npm:context-mode",
  ];
  const readPiPackages = () => {
    try {
      const parsed = JSON.parse(readFileSync(path.join(home, ".pi", "agent", "settings.json"), "utf8")) as {
        packages?: string[];
      };
      return parsed.packages ?? [];
    } catch {
      return [] as string[];
    }
  };
  await page.getByRole("button", { name: "安装 pi-web-access" }).click();
  await expect.poll(readPiPackages).toContain("npm:pi-web-access");
  await page.getByRole("button", { name: /安装推荐/ }).click();
  await expect(page.getByRole("button", { name: /安装推荐/ })).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "详情" }).getByText("推荐安装")).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "详情" }).getByText("已安装", { exact: true })).toHaveCount(7);
  await expect(page.getByRole("button", { name: "正在安装…" })).toHaveCount(0);
  await expect.poll(readPiPackages).toEqual(expect.arrayContaining(presetSources));
  await expect
    .poll(() => {
      try {
        const parsed = JSON.parse(readFileSync(path.join(home, ".pi", "agent", "mcp.json"), "utf8")) as {
          mcpServers?: Record<string, unknown>;
        };
        return parsed.mcpServers ?? {};
      } catch {
        return {};
      }
    })
    .toHaveProperty("context-mode");
  await page.getByRole("button", { name: "关闭详情" }).click();

  await page.getByRole("button", { name: "上下文用量" }).click();
  await expect(page.getByRole("dialog", { name: "上下文用量" }).getByText(/20 \/ .+ tokens/)).toBeVisible();
  await expect(page.getByText("接近上限时自动压缩")).toBeVisible();
  await expect(page.getByText("出错时自动重试")).toBeVisible();
  await expect(page.getByLabel("压缩时额外交代")).toBeVisible();
});

test("visual workbench at required viewports", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新对话" }).click();
  await chooseTypePath(page);
  await page.getByLabel("工作文件夹").fill(project);
  await page.getByLabel("标题").fill("Visual task");
  await page.getByRole("button", { name: "创建对话" }).click();
  await expect(page.getByRole("banner").getByText("Visual task")).toBeVisible();

  for (const size of [
    { name: "1440", width: 1440, height: 900 },
    { name: "1280", width: 1280, height: 800 },
    { name: "375", width: 375, height: 812 },
  ] as const) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await expect(page.locator("body")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflow).toBe(false);
  }
});

async function chooseTypePath(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "输入路径" }).click();
}

async function createTask(page: import("@playwright/test").Page, title: string): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("complementary", { name: "会话" })).toBeVisible();
  const leftoverDialog = page.locator(".dialog-scrim");
  if ((await leftoverDialog.count()) > 0) {
    const dismiss = page.getByRole("button", { name: /^(取消|拒绝)$/ }).first();
    if ((await dismiss.count()) > 0) {
      await dismiss.click();
    } else {
      await page.keyboard.press("Escape");
    }
    await expect(leftoverDialog).toHaveCount(0);
  }
  const list = page.getByRole("complementary", { name: "会话" }).locator("li");
  try {
    await expect.poll(async () => list.count(), { timeout: 2_000 }).toBeGreaterThan(0);
  } catch {
    // A fresh server has no leftover sessions to archive.
  }
  while ((await list.count()) > 0) {
    const count = await list.count();
    const item = list.first();
    await item.hover();
    await item.getByRole("button", { name: /^归档 / }).click();
    await expect(list).toHaveCount(count - 1);
  }
  await page.getByRole("button", { name: "新对话" }).click();
  await chooseTypePath(page);
  await page.getByLabel("工作文件夹").fill(project);
  await page.getByLabel("标题").fill(title);
  await page.getByRole("button", { name: "创建对话" }).click();
  await expect(page.getByRole("banner").getByText(title)).toBeVisible();
}

test("stacked user bubbles stay separated", async ({ page }) => {
  await createTask(page, "Bubble task");
  await expect(page.getByLabel("输入消息")).toBeEnabled({ timeout: 15_000 });
  for (const text of ["alpha bubble", "beta bubble"]) {
    await expect(page.getByRole("button", { name: "停止" })).toHaveCount(0);
    await expect(page.getByLabel("输入消息")).toBeEnabled();
    await page.getByLabel("输入消息").fill(text);
    await page.getByRole("button", { name: "发送" }).click();
    await expect(page.getByText(`Echo: ${text}`).first()).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "停止" })).toHaveCount(0);
  const boxes = await page.locator("#main-content article").evaluateAll((els) =>
    els.map((el) => {
      const rect = el.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    }),
  );
  expect(boxes.length).toBeGreaterThanOrEqual(2);
  for (let i = 1; i < boxes.length; i += 1) {
    expect(boxes[i]?.top ?? 0).toBeGreaterThanOrEqual((boxes[i - 1]?.bottom ?? 0) - 0.5);
  }
});

test("HTTP 401 shows a red error instead of failing silently", async ({ page }) => {
  await createTask(page, "Auth 401 task");
  await expect(page.getByLabel("输入消息")).toBeEnabled({ timeout: 15_000 });
  await page.getByLabel("输入消息").fill("FAIL401");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /登录已失效|HTTP 401/ }).first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("还没有连接 AI")).toHaveCount(0);
});

test("reload during a run keeps the agent going", async ({ page }) => {
  await createTask(page, "Reload task");
  await expect(page.getByLabel("输入消息")).toBeEnabled({ timeout: 15_000 });
  await page
    .getByLabel("输入消息")
    .fill(`please stream this slowly ${"word ".repeat(80)}`);
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByRole("button", { name: "停止" })).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(page.getByRole("button", { name: "停止" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("please stream this slowly").first()).toBeVisible();
});

test("copy reply, rename session, and find in conversation", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await createTask(page, "Copy rename search");
  await expect(page.getByLabel("输入消息")).toBeEnabled({ timeout: 15_000 });

  await page.getByLabel("输入消息").fill("unique copy phrase 92af");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("Echo: unique copy phrase 92af").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "停止" })).toHaveCount(0);

  await page.getByRole("button", { name: "复制回复" }).click();
  await expect(page.getByRole("button", { name: "复制回复" })).toHaveText("已复制");
  await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText())).toContain(
    "Echo: unique copy phrase 92af",
  );

  await page.getByRole("banner").getByText("Copy rename search").dblclick();
  await page.getByLabel("会话标题").fill("Renamed search task");
  await page.getByLabel("会话标题").press("Enter");
  await expect(page.getByRole("banner").getByText("Renamed search task")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "会话" }).getByText("Renamed search task")).toBeVisible();

  await page.keyboard.press("ControlOrMeta+f");
  const search = page.getByTestId("conversation-search-input");
  await expect(search).toBeVisible();
  await search.fill("unique copy phrase");
  await expect(page.getByText("1 / 2")).toBeVisible();
  await expect(page.locator(".conversation-search-hit")).toHaveCount(1);
  await page.getByRole("button", { name: "下一个匹配" }).click();
  await expect(page.getByText("2 / 2")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(search).toHaveCount(0);

  await page.getByRole("button", { name: "详情" }).click();
  await page.getByRole("button", { name: "资源" }).click();
  await page.getByRole("button", { name: "技能" }).click();
  await expect(page.getByRole("complementary", { name: "详情" }).getByRole("button", { name: "检查更新" })).toBeVisible();
});

test("scrolling up during stream is not yanked back down", async ({ page }) => {
  await createTask(page, "Scroll task");
  await expect(page.getByLabel("输入消息")).toBeEnabled({ timeout: 15_000 });
  await page.setViewportSize({ width: 1280, height: 420 });
  await page
    .getByLabel("输入消息")
    .fill(`please stream this slowly\n${"padding line to force a tall transcript\n".repeat(18)}${"word ".repeat(40)}`);
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByRole("button", { name: "停止" })).toBeVisible({ timeout: 15_000 });
  const main = page.locator("#main-content");
  await expect.poll(async () => main.evaluate((el) => el.scrollHeight > el.clientHeight + 40)).toBe(true);
  await main.evaluate((el) => {
    el.dispatchEvent(new WheelEvent("wheel", { deltaY: -140, bubbles: true }));
    el.scrollTop = 0;
  });
  await page.waitForTimeout(700);
  const remaining = await main.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
  expect(remaining).toBeGreaterThan(80);
});

test("queue follow-up while running and retry after abort", async ({ page }) => {
  await createTask(page, "Follow abort task");
  await expect(page.getByLabel("输入消息")).toBeEnabled({ timeout: 15_000 });
  await page
    .getByLabel("输入消息")
    .fill(`please stream this slowly ${"word ".repeat(40)}`);
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByRole("button", { name: "停止" })).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("输入消息").fill("streaming draft");
  await expect(page.getByLabel("输入消息")).toBeFocused();
  await page.waitForTimeout(300);
  await expect(page.getByLabel("输入消息")).toHaveValue("streaming draft");
  await expect(page.getByLabel("输入消息")).toBeFocused();
  await page.getByLabel("输入消息").fill("");
  await expect(page.locator("header.titlebar")).not.toContainText("回车补充");
  await expect(page.getByLabel("输入消息")).toHaveAttribute(
    "placeholder",
      "回车补充，Shift+Enter 排队",
  );
  await expect(page.getByLabel("输入消息")).not.toHaveAttribute(
    "placeholder",
    /正在处理/,
  );
  await page.getByRole("button", { name: "排队" }).click();
  await expect(page.getByRole("button", { name: "排队" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("输入消息")).toHaveAttribute("placeholder", "回车排队，Shift+Enter 补充");
  await page.getByLabel("输入消息").fill("queued next");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByTitle("queued next")).toBeVisible();
  await page.getByRole("button", { name: "编辑队列消息 1" }).click();
  await page.getByRole("textbox", { name: "修改队列消息", exact: true }).fill("queued corrected");
  await page.getByRole("button", { name: "保存队列消息" }).click();
  await expect(page.getByText("Follow-up: queued corrected").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "停止" })).toHaveCount(0);

  await page
    .getByLabel("输入消息")
    .fill(`please stream this slowly retry-me ${"word ".repeat(40)}`);
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByRole("button", { name: "停止" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "停止" }).click();
  await expect(page.getByRole("button", { name: "重试上一条" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "重试上一条" }).click();
  await expect(page.getByText(/Echo: please stream this slowly retry-me/).first()).toBeVisible({
    timeout: 20_000,
  });
});

test("select dialog, undo a write, and logout then restore", async ({ page }) => {
  await createTask(page, "Select undo task");
  await expect(page.getByLabel("输入消息")).toBeEnabled({ timeout: 15_000 });

  await page.getByLabel("输入消息").fill("SELECT:alpha|beta");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByTestId("interaction-dialog")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("interaction-dialog").getByRole("button", { name: "alpha" }).click();
  await expect(page.getByText("Selected: alpha").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "停止" })).toHaveCount(0);

  await page.getByLabel("输入消息").fill("INPUT:your name");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByTestId("interaction-dialog")).toBeVisible({ timeout: 15_000 });
  await page.getByPlaceholder("your name").fill("Ada");
  await page.getByRole("button", { name: "确定" }).click();
  await expect(page.getByText("Input: Ada").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "停止" })).toHaveCount(0);

  await page.getByLabel("输入消息").fill("NOTIFY:heads-up");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("Notified: heads-up").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("interaction-dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "停止" })).toHaveCount(0);

  await page.getByLabel("输入消息").fill("WRITE:README.md:changed-by-e2e");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByRole("button", { name: "撤回这次" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "撤回这次" }).click();
  await expect.poll(() => readFileSync(path.join(project, "README.md"), "utf8")).toBe("e2e");

  const authPath = path.join(home, ".pi", "agent", "auth.json");
  const oauthAuth = JSON.stringify({ github: { type: "oauth" } });
  writeFileSync(authPath, oauthAuth);
  try {
    await page.goto("/settings");
    await page.getByRole("button", { name: "订阅登录", pressed: true }).click();
    await page.getByLabel("服务商").selectOption("github");
    await expect(page.getByRole("button", { name: "退出" }).first()).toBeVisible();
    await page.getByRole("button", { name: "退出" }).first().click();
    await expect(page.getByText("已退出登录。")).toBeVisible();
    await expect(page.getByText("未登录").first()).toBeVisible();
  } finally {
    writeFileSync(authPath, oauthAuth);
  }
  await page.getByRole("button", { name: "刷新状态" }).click();
  await expect(page.getByText("已刷新登录状态。")).toBeVisible();
  await expect(page.getByText("已登录").first()).toBeVisible();
});

async function expectPreviewAboveInput(page: import("@playwright/test").Page): Promise<void> {
  const preview = page.getByLabel(/^已添加 \d+ 张图$/);
  const input = page.getByLabel("输入消息");
  const well = page.locator(".composer-well");
  await expect(preview).toBeVisible();
  const previewBox = await preview.boundingBox();
  const inputBox = await input.boundingBox();
  const wellBox = await well.boundingBox();
  expect(previewBox).toBeTruthy();
  expect(inputBox).toBeTruthy();
  expect(wellBox).toBeTruthy();
  expect(previewBox!.y).toBeGreaterThanOrEqual(wellBox!.y);
  expect(previewBox!.y + previewBox!.height).toBeLessThanOrEqual(inputBox!.y + 2);
  expect(inputBox!.y + inputBox!.height).toBeLessThanOrEqual(wellBox!.y + wellBox!.height);
}

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("attached images show a thumbnail that can be removed", async ({ page }) => {
  await createTask(page, "Image preview task");
  await expect(page.getByLabel("输入消息")).toBeEnabled({ timeout: 15_000 });
  await page.getByLabel("添加图片").setInputFiles({
    name: "shot.png",
    mimeType: "image/png",
    buffer: TINY_PNG,
  });
  await expect(page.getByRole("img", { name: "shot.png" })).toBeVisible();
  await expect(page.getByRole("img", { name: "shot.png" })).toHaveCount(1);
  await page.getByLabel("输入消息").fill("see this screenshot");
  await expectPreviewAboveInput(page);
  await page.getByRole("button", { name: "移除 shot.png" }).click();
  await expect(page.getByRole("img", { name: "shot.png" })).toHaveCount(0);
});

test("pasting one image attaches a single preview", async ({ page }) => {
  await createTask(page, "Paste image task");
  await expect(page.getByLabel("输入消息")).toBeEnabled({ timeout: 15_000 });
  await page.getByLabel("输入消息").focus();
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (char) => char.charCodeAt(0));
    const fromFiles = new File([bytes], "pasted.png", { type: "image/png", lastModified: 1 });
    const fromItems = new File([bytes], "pasted.png", { type: "image/png", lastModified: 1 });
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        files: [fromFiles],
        items: [{ kind: "file", getAsFile: () => fromItems }],
      },
    });
    document.activeElement?.dispatchEvent(event);
  }, TINY_PNG.toString("base64"));
  await expect(page.getByRole("img", { name: "pasted.png" })).toHaveCount(1);
  await page.getByLabel("输入消息").fill("pasted above this line");
  await expectPreviewAboveInput(page);
});

test("sidebars can pin into the layout and the terminal tab embeds zsh", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await createTask(page, "Pin term task");

  const sessions = page.getByRole("complementary", { name: "会话" });
  await expect(sessions).toBeVisible();
  await sessions.getByRole("button", { name: "取消固定会话列表" }).click();
  await expect(page.getByRole("button", { name: "会话", exact: true })).toBeVisible();
  await expect(sessions).toHaveCount(0);

  await page.getByRole("button", { name: "会话", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "会话" })).toBeVisible();
  await page.getByRole("button", { name: "固定会话列表" }).click();
  await expect(page.getByRole("complementary", { name: "会话" })).toBeVisible();
  await expect(page.getByRole("button", { name: "关闭会话列表" })).toHaveCount(0);

  await page.getByRole("button", { name: "详情" }).click();
  await expect(page.getByRole("complementary", { name: "详情" })).toBeVisible();
  await expect(page.getByRole("button", { name: "关闭详情" })).toBeVisible();
  await page.getByRole("button", { name: "固定详情" }).click();
  await expect(page.getByRole("button", { name: "关闭详情" })).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "详情" })).toBeVisible();

  await page.getByRole("button", { name: "终端" }).click();
  await expect(page.getByLabel("终端")).toBeVisible();
});

test("work project picker is a centered titlebar button", async ({ page }) => {
  await page.goto("/board");
  const button = page.getByRole("button", { name: "项目", exact: true });
  await expect(button).toBeVisible();
  await expect(page.locator("header.titlebar select")).toHaveCount(0);
  const fontSize = await button.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
  expect(fontSize).toBeGreaterThanOrEqual(15);
});

test("work titlebar theme and settings stay clickable", async ({ page }) => {
  await page.goto("/board");
  const theme = page.getByRole("button", { name: /切换到(浅色|深色)/ });
  await expect(theme).toBeEnabled();
  const beforeDark = await page.locator("html").evaluate((el) => el.classList.contains("dark"));
  await theme.click();
  await expect
    .poll(async () => page.locator("html").evaluate((el) => el.classList.contains("dark")))
    .toBe(!beforeDark);
  await page.getByRole("link", { name: "设置" }).click();
  await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
});

test("work mode creates an objective and starts an agent run", async ({ page }) => {
  await page.goto("/board");
  await expect(page.getByRole("tab", { name: "工作" })).toBeVisible();
  await page.getByRole("button", { name: "启动项目" }).click();
  await page.getByRole("button", { name: "输入路径" }).click();
  await page.getByLabel("项目文件夹").fill(project);
  await page.getByLabel("项目名称").fill("E2E project");
  await page.getByRole("dialog", { name: "启动项目" }).getByRole("button", { name: "启动项目" }).click();
  await page.getByRole("button", { name: "新建任务" }).click();
  await page.getByLabel("标题").fill("Board e2e job");
  await page.getByLabel("目标说明").fill("echo from work mode");
  await page.getByLabel("验收标准").fill("the run finishes and reports a result");
  await page.getByRole("button", { name: "创建并开始" }).click();
  const working = page.getByRole("region", { name: "进行中" });
  await expect(working.getByText("Board e2e job", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole("button", { name: "查看执行" })).toBeVisible();
  await page.getByRole("tab", { name: "对话" }).click();
  const sessions = page.getByRole("complementary", { name: "会话" });
  await expect(sessions.getByText("Board e2e job", { exact: true })).toBeVisible();
  await sessions.getByRole("button", { name: "新对话" }).click();
  await page.getByRole("button", { name: "输入路径" }).click();
  await page.getByLabel("工作文件夹").fill(project);
  await page.getByLabel("标题").fill("Chat after work");
  await page.getByRole("button", { name: "创建对话" }).click();
  await expect(page.getByRole("banner").getByText("Chat after work")).toBeVisible();
  await expect(sessions.getByText("Board e2e job", { exact: true })).toBeVisible();
  await expect(sessions.getByText("任务", { exact: true })).toBeVisible();
});
