import type { ServerEvent } from "@qingzhou/protocol";

export type SocketLike = { send: (data: string) => void; closed: boolean };

type EventMeta = Pick<ServerEvent, "eventId" | "serverInstanceId" | "timestamp" | "sequence">;

export class EventDispatcher {
  private readonly sockets = new Set<SocketLike>();
  private readonly deltaBuffer: ServerEvent[] = [];
  private deltaFlushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly nextMeta: (taskId: string) => EventMeta,
    private readonly deltaFlushMs = 16,
  ) {}

  get connectionCount(): number {
    return this.sockets.size;
  }

  addSocket(socket: SocketLike): void {
    // Existing clients must receive pending deltas before a newcomer gets a
    // snapshot that already contains those deltas.
    this.flushDeltas();
    this.sockets.add(socket);
  }

  removeSocket(socket: SocketLike): void {
    this.sockets.delete(socket);
  }

  emit(taskId: string, type: ServerEvent["type"], payload: unknown): void {
    this.dispatch({ ...this.nextMeta(taskId), taskId, type, payload } as ServerEvent);
  }

  sendTo(socket: SocketLike, taskId: string, type: ServerEvent["type"], payload: unknown): void {
    const event = { ...this.nextMeta(taskId), taskId, type, payload } as ServerEvent;
    socket.send(JSON.stringify(event));
  }

  dispatch(event: ServerEvent): void {
    if (event.type === "message.delta" || event.type === "term.chunk") {
      this.deltaBuffer.push(event);
      if (this.deltaFlushTimer === null) {
        this.deltaFlushTimer = setTimeout(() => this.flushDeltas(), this.deltaFlushMs);
      }
      return;
    }
    this.flushDeltas();
    this.broadcast(JSON.stringify(event));
  }

  private flushDeltas(): void {
    if (this.deltaFlushTimer !== null) {
      clearTimeout(this.deltaFlushTimer);
      this.deltaFlushTimer = null;
    }
    if (this.deltaBuffer.length === 0) return;
    const events = this.deltaBuffer.splice(0);
    this.broadcast(JSON.stringify({ __batch: true, events }));
  }

  private broadcast(data: string): void {
    for (const socket of this.sockets) {
      if (!socket.closed) socket.send(data);
    }
  }
}
