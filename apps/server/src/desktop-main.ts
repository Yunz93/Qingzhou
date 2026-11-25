import { createInterface } from "node:readline";
import { createApp } from "./app.js";
import { createDesktopSession } from "./security/desktop-session.js";
import { registerDesktopUiState } from "./routes/desktop-ui.js";
import { lockProfile, ProfileBusyError } from "./setup/profile-lock.js";

const TICKET = /^[a-f0-9]{32}$/;

async function main(): Promise<void> {
  const ticket = process.env.QINGZHOU_DESKTOP_TICKET ?? "";
  delete process.env.QINGZHOU_DESKTOP_TICKET;
  if (!TICKET.test(ticket)) throw new Error("桌面服务缺少启动凭据。");

  const releaseProfile = await lockProfile(process.env, true);
  try {
    await serve(ticket, releaseProfile);
  } catch (error) {
    releaseProfile();
    throw error;
  }
}

async function serve(ticket: string, releaseProfile: () => void) {
  const desktopSession = createDesktopSession(ticket);
  const { app, config, service } = await createApp(process.env, { desktopSession });
  const restoreUi = registerDesktopUiState(app, config.dataDir);
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  desktopSession.bind(origin);
  config.allowedOrigins.splice(0, config.allowedOrigins.length, origin);

  const input = createInterface({ input: process.stdin });
  let shuttingDown = false;
  const shutdown = async (parentGone = false) => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await service.flushPersist();
    } catch (error) {
      console.error("[qingzhou] desktop flush failed", error);
      console.log("QINGZHOU_FLUSH_FAILED");
      if (!parentGone) {
        shuttingDown = false;
        return;
      }
    }
    try {
      // The desktop waits for shutdown before closing its WebView, so the peer may not answer a closing frame.
      for (const socket of app.websocketServer.clients) socket.terminate();
      await app.close();
      console.log("QINGZHOU_STOPPED");
    } finally {
      releaseProfile();
      input.close();
      process.stdin.pause();
    }
  };
  input.on("line", (line) => {
    if (line === "shutdown") void shutdown().catch(reportFailure);
    const restore = /^restore-ui ([a-f0-9]{32}) (.+)$/s.exec(line);
    if (restore) {
      const id = restore[1]!;
      const data = restore[2]!;
      void Promise.resolve().then(() => restoreUi(JSON.parse(data))).then(
        () => console.log(`QINGZHOU_UI_SAVED ${id}`),
        () => console.log(`QINGZHOU_UI_FAILED ${id}`),
      );
      return;
    }
    const next = line.startsWith("ticket ") ? line.slice(7) : "";
    if (TICKET.test(next)) {
      desktopSession.rotateTicket(next);
      console.log("QINGZHOU_TICKET_READY");
    }
  });
  input.once("close", () => void shutdown(true).catch(reportFailure));
  process.once("SIGTERM", () => void shutdown(true).catch(reportFailure));
  console.log(`QINGZHOU_READY ${origin}`);
}

function reportFailure(error: unknown): void {
  if (error instanceof ProfileBusyError) console.log("QINGZHOU_PROFILE_BUSY");
  console.error("[qingzhou] desktop service failed", error);
  process.exitCode = 1;
}

void main().catch(reportFailure);
