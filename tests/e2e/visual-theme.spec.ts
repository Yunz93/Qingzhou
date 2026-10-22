import { expect, test, type Locator, type Page } from "@playwright/test";

async function expectReadable(control: Locator) {
  await expect(control).toBeVisible();
  await expect(async () => {
    const colors = await control.evaluate((element) => {
      const style = getComputedStyle(element);
      const luminance = (color: string) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d")!;
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const data = context.getImageData(0, 0, 1, 1).data;
        return [0.2126, 0.7152, 0.0722].reduce((total, weight, index) => {
          const value = data[index]! / 255;
          return total + weight * (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
        }, 0);
      };
      let painted: Element | null = element;
      while (painted && getComputedStyle(painted).backgroundColor === "rgba(0, 0, 0, 0)") painted = painted.parentElement;
      const backgroundColor = getComputedStyle(painted ?? document.documentElement).backgroundColor;
      const foreground = luminance(style.color);
      const background = luminance(backgroundColor);
      return { ratio: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05), foreground: style.color, background: backgroundColor };
    });
    expect(colors.ratio, `normal-size control text contrast: ${JSON.stringify(colors)}`).toBeGreaterThanOrEqual(4.5);
  }).toPass({ timeout: 5000 });
}

async function expectThemeChrome(page: Page) {
  const colors = await page.evaluate(() => {
    const root = document.documentElement;
    const normalize = (value: string) => {
      const probe = document.createElement("span");
      probe.style.color = value;
      root.appendChild(probe);
      const result = getComputedStyle(probe).color;
      probe.remove();
      return result;
    };
    return {
      canvas: normalize(getComputedStyle(root).getPropertyValue("--color-canvas")),
      background: normalize(root.style.backgroundColor),
      meta: normalize(document.querySelector('meta[name="theme-color"]')!.getAttribute("content")!),
    };
  });
  expect(colors.background).toBe(colors.canvas);
  expect(colors.meta).toBe(colors.canvas);
}

test("theme preference, page chrome and control contrast survive switching and reload", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => {
    if (!localStorage.getItem("qingzhou.theme")) localStorage.setItem("qingzhou.theme", "dark");
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "切换到浅色", exact: true })).toBeVisible();
  await expectThemeChrome(page);

  for (const theme of ["dark", "light"] as const) {
    if (theme === "light") await page.getByRole("button", { name: "切换到浅色", exact: true }).click();
    await expectThemeChrome(page);
    await expectReadable(page.getByRole("navigation", { name: "模式", exact: true }).getByRole("link", { name: "对话", exact: true }));
    await expectReadable(page.getByRole("navigation", { name: "模式", exact: true }).getByRole("link", { name: "工作", exact: true }));
    await page.getByRole("button", { name: "新对话", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "新对话", exact: true });
    await expectReadable(dialog.getByRole("button", { name: "创建对话", exact: true }));
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`theme-${theme}.png`), fullPage: true, animations: "disabled" });
    await page.reload();
    await expect(page.getByRole("button", { name: theme === "dark" ? "切换到浅色" : "切换到深色", exact: true })).toBeVisible();
    await expectThemeChrome(page);
  }

  await page.getByRole("button", { name: "新对话", exact: true }).click();
  await page.getByLabel("标题", { exact: true }).fill("主题与焦点检查");
  await page.getByRole("button", { name: "创建对话", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "新对话", exact: true })).toHaveCount(0);
  await expect(page.getByRole("banner").getByText("主题与焦点检查", { exact: true })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "会话", exact: true }).getByRole("button").filter({ hasText: "主题与焦点检查" }).first()).toContainText("就绪");
  await expect(page.getByLabel("输入消息", { exact: true })).toBeEnabled();
  await page.getByLabel("输入消息", { exact: true }).focus();
  await page.keyboard.press("Tab");
  const mode = page.getByRole("button", { name: "模式", exact: true });
  await mode.focus();
  await expect(mode).toBeFocused();
  await expect(mode).toHaveCSS("outline-style", "solid");
  await expect(mode).toHaveCSS("outline-width", "2px");
  await page.screenshot({ path: testInfo.outputPath("composer-keyboard-focus.png"), fullPage: true, animations: "disabled" });
});
