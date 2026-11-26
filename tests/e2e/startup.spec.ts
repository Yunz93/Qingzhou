import { expect, test } from "@playwright/test";

test("a slow credential scan does not block the workbench socket", async ({ page }) => {
  let releaseScan!: () => void;
  const scan = new Promise<void>((resolve) => { releaseScan = resolve; });
  await page.route("**/api/setup", async (route) => {
    await scan;
    await route.continue();
  });
  const session = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/session" && response.request().method() === "HEAD",
  { timeout: 5000 });
  const connected = page.waitForEvent("websocket", { predicate: (socket) => socket.url().endsWith("/ws"), timeout: 5000 });
  try {
    const [, response] = await Promise.all([page.goto("/"), session, connected]);
    expect(response.status()).toBe(204);
  } finally {
    releaseScan();
  }
});
