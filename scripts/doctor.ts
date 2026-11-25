import { loadDotEnv } from "../apps/server/src/env.ts";
import { loadConfig, readPiVersion } from "../apps/server/src/config.ts";
import { buildSetupStatus } from "../apps/server/src/routes/setup.ts";
import { SettingsStore } from "../apps/server/src/setup/settings-store.ts";
import { hasAnyAuth, listConfiguredProviders } from "../apps/server/src/setup/auth-status.ts";

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  const settings = new SettingsStore(config.dataDir);
  await settings.load();
  const merged = loadConfig(process.env, {
    workspaceRoot: settings.get().workspaceRoot,
    homeDir: config.homeDir,
  });
  const pi = await readPiVersion(merged);
  const setup = await buildSetupStatus(merged, settings, pi);
  const providers = await listConfiguredProviders(merged.homeDir);
  const auth = await hasAnyAuth(merged.homeDir);

  const lines = [
    `Pi binary: ${merged.piBin}`,
    `Pi version: ${pi.version ?? "unavailable"}`,
    pi.error ? `Pi error: ${pi.error}` : null,
    `Data dir: ${merged.dataDir}`,
    `Allowed roots: ${merged.allowedRoots.join(", ")}`,
    `Auth configured: ${auth ? "yes" : "no"}`,
    providers.length ? `Providers: ${providers.join(", ")}` : "Providers: (none)",
    `Setup ready: ${setup.ready ? "yes" : "no"}`,
    setup.needsSetup ? "Next: open Mowen in the browser and finish the setup wizard." : "Ready to use.",
  ].filter(Boolean);

  for (const line of lines) console.log(line);
  if (!setup.piAvailable || !auth) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
