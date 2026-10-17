import { expect, test } from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

test("HTML export scripts remain interactive but cannot use workbench cookies or APIs", async ({ page, baseURL }) => {
  const project = path.join(process.cwd(), ".qingzhou-test", "e2e-project");
  await mkdir(project, { recursive: true });
  const temporary = await mkdtemp(path.join(project, "export-isolation-"));
  const file = path.join(temporary, "untrusted.html");
  const wsUrl = baseURL!.replace(/^http/, "ws") + "/ws";
  await writeFile(file, `<!doctype html><body><button>展开</button><script>
    document.body.dataset.running = 'yes';
    document.querySelector('button').onclick = () => { document.body.dataset.expanded = 'yes'; };
    try { document.cookie; document.body.dataset.cookie = 'allowed'; }
    catch { document.body.dataset.cookie = 'blocked'; }
    fetch('/api/session').then(() => { document.body.dataset.api = 'allowed'; })
      .catch(() => { document.body.dataset.api = 'blocked'; });
    try {
      const ws = new WebSocket(${JSON.stringify(wsUrl)});
      ws.onopen = () => { document.body.dataset.ws = 'allowed'; ws.close(); };
      ws.onerror = () => { document.body.dataset.ws = 'blocked'; };
    } catch { document.body.dataset.ws = 'blocked'; }
  </script></body>`);
  try {
    await page.goto(`/api/exports?path=${encodeURIComponent(file)}`);
    const body = page.locator("body");
    await expect(body).toHaveAttribute("data-running", "yes");
    await expect(body).toHaveAttribute("data-cookie", "blocked");
    await expect(body).toHaveAttribute("data-api", "blocked");
    await expect(body).toHaveAttribute("data-ws", "blocked");
    await page.getByRole("button", { name: "展开", exact: true }).click();
    await expect(body).toHaveAttribute("data-expanded", "yes");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
