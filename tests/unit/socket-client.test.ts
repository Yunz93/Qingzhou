import { afterEach, describe, expect, it, vi } from "vitest";
import { SocketClient, SOCKET_CONNECT_TIMEOUT_MS } from "../../apps/web/src/transport/socket-client.ts";
import { useAgentStore } from "../../apps/web/src/stores/agent-store.ts";

function mockSockets() {
  const sockets: MockSocket[] = [];
  class MockSocket extends EventTarget {
    static OPEN = 1;
    static CONNECTING = 0;
    readyState = 0;
    send = vi.fn();
    constructor() { super(); sockets.push(this); }
    open() { this.readyState = 1; this.dispatchEvent(new Event("open")); }
    close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
  }
  vi.stubGlobal("WebSocket", MockSocket);
  vi.stubGlobal("location", { protocol: "http:", host: "127.0.0.1:5173" });
  return sockets;
}

describe("socket client reconnect", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps retrying when the session bootstrap request fails", async () => {
    vi.useFakeTimers();
    const fetchSession = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchSession);
    const client = new SocketClient();

    await client.connect();
    expect(fetchSession).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchSession).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchSession).toHaveBeenCalledTimes(3);
    client.disconnect();
  });

  it("manual reconnect bypasses backoff and waits until the socket is open", async () => {
    vi.useFakeTimers();
    const sockets = mockSockets();
    const fetchSession = vi.fn().mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSession);
    const client = new SocketClient();
    await client.connect();
    const ready = client.reconnect();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSession).toHaveBeenCalledTimes(2);
    expect(sockets).toHaveLength(1);
    sockets[0].open();
    await ready;
    expect(useAgentStore.getState().connection).toBe("open");
    client.disconnect();
  });

  it("ignores a stale bootstrap completion after manual reconnect", async () => {
    vi.useFakeTimers();
    const sockets = mockSockets();
    let completeOld!: (value: { ok: boolean }) => void;
    vi.stubGlobal("fetch", vi.fn()
      .mockReturnValueOnce(new Promise((resolve) => { completeOld = resolve; }))
      .mockResolvedValue({ ok: true }));
    const client = new SocketClient();
    const oldConnect = client.connect();
    const ready = client.reconnect();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].open();
    await ready;
    completeOld({ ok: true });
    await oldConnect;
    expect(sockets).toHaveLength(1);
    expect(useAgentStore.getState().connection).toBe("open");
    client.disconnect();
  });

  it("retries a stalled WebSocket handshake", async () => {
    vi.useFakeTimers();
    const sockets = mockSockets();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const client = new SocketClient();
    await client.connect();
    await vi.advanceTimersByTimeAsync(SOCKET_CONNECT_TIMEOUT_MS + 1_000);
    expect(sockets).toHaveLength(2);
    sockets[1].open();
    client.disconnect();
  });

  it("rejects pending commands when explicitly reconnecting", async () => {
    vi.useFakeTimers();
    const sockets = mockSockets();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const client = new SocketClient();
    await client.connect();
    sockets[0].open();
    const request = client.send("sessions.list", {});
    const rejected = expect(request).rejects.toThrow("连接已断开");
    const ready = client.reconnect();
    await vi.advanceTimersByTimeAsync(0);
    sockets[1].open();
    await Promise.all([ready, rejected]);
    client.disconnect();
  });
});
