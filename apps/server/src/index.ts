import { pathToFileURL } from "node:url";
import { createApp } from "./app.js";
import { lockProfile } from "./setup/profile-lock.js";

export { createApp, applyEnvHttpProxy, normalizeProxyEnv, proxiedFetch, readProxyUrl } from "./app.js";

async function main(): Promise<void> {
  const releaseProfile = await lockProfile(process.env);
  const { app, config, service } = await createApp();
  await app.listen({ host: config.host, port: config.port });
  console.log(`[qingzhou] listening on http://${config.host}:${config.port}`);
  console.log(`[qingzhou] open that address in your browser to finish setup if needed`);

  const shutdown = async (signal: string) => {
    console.log(`[qingzhou] ${signal}: flushing stores…`);
    try {
      await service.flushPersist();
    } catch (error) {
      console.error("[qingzhou] flush failed", error);
    }
    try {
      await app.close();
    } finally {
      releaseProfile();
      process.exit(0);
    }
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
