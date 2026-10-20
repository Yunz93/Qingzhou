import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const root = path.dirname(fileURLToPath(import.meta.url));
const e2eHome = path.resolve(root, ".qingzhou-test/e2e-home");
const e2eData = path.resolve(root, `.qingzhou-test/e2e-${randomUUID()}`);
const port = Number(process.env.QINGZHOU_E2E_PORT ?? 4310);
const e2eProject = path.resolve(root, ".qingzhou-test/e2e-project");
const fakePi = path.resolve(root, "tests/fixtures/fake-pi.mjs");

export default defineConfig({
  testDir: "tests/e2e",
  metadata: { e2eData },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "on-first-retry",
  },
  webServer: {
    command: [
      `mkdir -p ${e2eProject} ${e2eHome} ${e2eData}`,
      `QINGZHOU_E2E=1 HOST=127.0.0.1 PORT=${port} NODE_ENV=production pnpm build`,
      [
        `QINGZHOU_E2E=1 HOST=127.0.0.1 PORT=${port} NODE_ENV=production`,
        `QINGZHOU_DATA_DIR=${e2eData}`,
        `QINGZHOU_HOME_DIR=${e2eHome}`,
        `PI_BIN=${fakePi}`,
        `QINGZHOU_ALLOWED_ROOTS=${e2eProject}`,
        "QINGZHOU_MAX_PROCESSES=8 QINGZHOU_MUTATIONS=approval pnpm start",
      ].join(" "),
    ].join(" && "),
    url: `http://127.0.0.1:${port}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

