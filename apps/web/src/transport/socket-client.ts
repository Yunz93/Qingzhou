import { serverFrameSchema, type ClientCommand, type ServerEvent } from "@qingzhou/protocol";
import { failPendingRequests } from "../lib/pending-rpc";
import { useAgentStore } from "../stores/agent-store";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};


function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

/** Skip full Zod for high-rate streaming frames from our own server. */
function isTrustedDeltaEvent(value: unknown): value is ServerEvent {
  if (!isRecord(value)) return false;
  if (value.type !== "message.delta" && value.type !== "term.chunk") return false;
  if (typeof value.taskId !== "string" || typeof value.sequence !== "number") return false;
  if (typeof value.eventId !== "string" || typeof value.serverInstanceId !== "string") return false;
  return isRecord(value.payload);
}

function isTrustedBatchFrame(value: unknown): value is { __batch: true; events: ServerEvent[] } {
  if (!isRecord(value) || value.__batch !== true || !Array.isArray(value.events)) return false;
  return value.events.every((event) => isTrustedDeltaEvent(event) || isRecord(event));
}

export class SocketClient {
  private socket: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private requestId = 0;
  private retries = 0;
  private closedByUser = false;
  private connecting = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  async connect(): Promise<void> {
    this.closedByUser = false;
    if (this.connecting || this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) {
      return;
    }
    this.connecting = true;
    useAgentStore.getState().setConnection("connecting");
    try {
      const response = await fetch("/api/session", { credentials: "same-origin" });
      if (!response.ok) throw new Error(`Session bootstrap failed (${response.status})`);
      if (!this.closedByUser) this.open();
    } catch {
      if (!this.closedByUser) this.scheduleReconnect();
    } finally {
      this.connecting = false;
    }
  }

  disconnect(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
  }

  send<T = unknown>(
    type: ClientCommand["type"],
    payload?: unknown,
    taskId?: string,
  ): Promise<T> {
    const id = `c${++this.requestId}`;
    const body: { id: string; type: ClientCommand["type"]; taskId?: string; payload?: unknown } = { id, type };
    if (taskId) body.taskId = taskId;
    if (payload !== undefined) body.payload = payload;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        this.pending.delete(id);
        reject(new Error("还没连上服务，请稍后再发。"));
        return;
      }
      this.socket.send(JSON.stringify(body));
    });
  }

  private handleEvent(serverEvent: ServerEvent): void {
    useAgentStore.getState().applyEvent(serverEvent);
    if (serverEvent.type === "request.succeeded") {
      const pending = this.pending.get(serverEvent.payload.requestId);
      pending?.resolve(serverEvent.payload.data);
      this.pending.delete(serverEvent.payload.requestId);
    }
    if (serverEvent.type === "request.failed") {
      const pending = this.pending.get(serverEvent.payload.requestId);
      pending?.reject(new Error(serverEvent.payload.error));
      this.pending.delete(serverEvent.payload.requestId);
    }
  }

  private open(): void {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${location.host}/ws`);
    this.socket = socket;

    socket.addEventListener("open", () => {
      if (socket !== this.socket) return;
      this.retries = 0;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      useAgentStore.getState().setConnection("open");
    });

    socket.addEventListener("message", (event) => {
      if (socket !== this.socket) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        return;
      }
      let events: ServerEvent[];
      if (isTrustedDeltaEvent(parsed)) {
        events = [parsed];
      } else if (isTrustedBatchFrame(parsed)) {
        // Batch frames are almost always streaming deltas; avoid full Zod fan-out.
        const trusted = parsed.events.every((item) => isTrustedDeltaEvent(item));
        if (trusted) {
          events = parsed.events;
        } else {
          const result = serverFrameSchema.safeParse(parsed);
          if (!result.success) {
            console.warn("[qingzhou] dropped event", result.error.issues[0]?.message);
            return;
          }
          events = "__batch" in result.data ? result.data.events : [result.data];
        }
      } else {
        const result = serverFrameSchema.safeParse(parsed);
        if (!result.success) {
          console.warn("[qingzhou] dropped event", result.error.issues[0]?.message);
          return;
        }
        const frame = result.data;
        events = "__batch" in frame ? frame.events : [frame];
      }
      if (events.length > 1 && events.every((item) => item.type === "message.delta" || item.type === "term.chunk")) {
        useAgentStore.getState().applyEvents(events);
        return;
      }
      for (const serverEvent of events) {
        this.handleEvent(serverEvent);
      }
    });

    socket.addEventListener("close", () => {
      if (socket !== this.socket) return;
      this.socket = null;
      useAgentStore.getState().setConnection("closed");
      failPendingRequests(this.pending, new Error("连接已断开，请稍后再发。"));
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.closedByUser || this.reconnectTimer) return;
    useAgentStore.getState().setConnection("connecting");
    const delay = Math.min(1000 * 2 ** this.retries, 8000);
    this.retries += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }
}

export const socketClient = new SocketClient();
