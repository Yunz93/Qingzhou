import type { FastifyInstance } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import { clientCommandSchema, formatClientCommandError } from "@qingzhou/protocol";
import type { AppConfig } from "../config.js";
import { isAllowedOrigin } from "../config.js";
import { hasSession, readSessionToken } from "../security/session-cookie.js";
import { humanizeUserFacingError } from "../setup/pi-agent-dir.js";
import type { TaskService } from "../tasks/task-service.js";

export function registerWebsocket(app: FastifyInstance, config: AppConfig, service: TaskService): void {
  app.addHook("preHandler", async (request, reply) => {
    if (request.url.split("?")[0] !== "/ws") return;
    if (!isAllowedOrigin(request.headers.origin, config.allowedOrigins, config.host)) {
      return reply.code(403).send({ error: "origin denied" });
    }
    const token = readSessionToken(request.headers.cookie);
    if (!hasSession(token)) {
      return reply.code(401).send({ error: "session required" });
    }
  });
  app.get("/ws", { websocket: true }, (socket: WebSocket, request) => {
    const origin = request.headers.origin;
    if (!isAllowedOrigin(origin, config.allowedOrigins, config.host)) {
      socket.close(1008, "origin denied");
      return;
    }
    const token = readSessionToken(request.headers.cookie);
    if (!hasSession(token)) {
      socket.close(1008, "session required");
      return;
    }

    const wrapper = {
      closed: false,
      send: (data: string) => {
        if (socket.readyState === socket.OPEN) socket.send(data);
      },
    };
    // Liveness watch: mark dead sockets so the service stops broadcasting.
    const watch = setInterval(() => {
      if (socket.readyState !== socket.OPEN) {
        wrapper.closed = true;
        socket.terminate();
      }
    }, 15_000);
    service.addSocket(wrapper);
    const snapshot = service.buildSnapshot(null);
    service.sendTo(wrapper, "", "snapshot", snapshot);
    service.sendTo(wrapper, "", "connection.status", { status: "connected" });

    let chain = Promise.resolve();
    socket.on("message", (raw) => {
      chain = chain
        .then(async () => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(raw));
        } catch {
          service.emit("", "request.failed", { requestId: "", error: "请求格式无效。" });
          return;
        }
        const result = clientCommandSchema.safeParse(parsed);
        if (!result.success) {
          const requestId =
            parsed && typeof parsed === "object" && "id" in parsed
              ? String((parsed as { id: unknown }).id)
              : "";
          service.emit("", "request.failed", {
            requestId,
            error: formatClientCommandError(result.error),
          });
          return;
        }
        const command = result.data;
        const taskId = command.taskId ?? "";
        try {
          const data = await service.handleCommand(command);
          service.emit(taskId, "request.succeeded", { requestId: command.id, data });
          if (
            command.type === "snapshot.request" ||
            command.type === "task.activate" ||
            command.type === "task.create" ||
            command.type === "session.resume"
          ) {
            const snapshotTaskId =
              command.type === "task.create" || command.type === "session.resume"
                ? (data as { task: { id: string } }).task.id
                : command.taskId ?? null;
            // Warm activate already has the transcript client-side; skip bulky snapshot.
            if (command.type === "task.activate" && (data as { warm?: boolean } | null)?.warm) {
              // models.updated was emitted from activate with cached lists.
            } else {
              service.emit(
                taskId || snapshotTaskId || "",
                "snapshot",
                service.buildSnapshot(snapshotTaskId),
              );
            }
          }
        } catch (error) {
          service.emit(taskId, "request.failed", {
            requestId: command.id,
            error: humanizeUserFacingError(error),
          });
        }
        })
        .catch((error) => {
          service.emit("", "server.error", {
            code: "ws",
            message: error instanceof Error ? error.message : String(error),
          });
        });
    });

    socket.on("close", () => {
      clearInterval(watch);
      wrapper.closed = true;
      service.removeSocket(wrapper);
    });
  });
}
