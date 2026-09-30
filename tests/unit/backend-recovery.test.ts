import { afterEach, describe, expect, it, vi } from "vitest";
import { createBackendRecovery, isBackendListening } from "../../apps/desktop/src/main/backend-recovery.ts";

afterEach(() => vi.unstubAllGlobals());

describe("desktop backend recovery", () => {
  it("reuses a healthy backend without restarting its agents", async () => {
    const start = vi.fn();
    await createBackendRecovery(async () => true, start)();
    expect(start).not.toHaveBeenCalled();
  });

  it("starts a missing backend once for concurrent recovery clicks", async () => {
    const start = vi.fn().mockResolvedValue(undefined);
    const recover = createBackendRecovery(async () => false, start);
    await Promise.all([recover(), recover(), recover()]);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("allows retry after a startup failure", async () => {
    const start = vi.fn().mockRejectedValueOnce(new Error("boot failed")).mockResolvedValue(undefined);
    const recover = createBackendRecovery(async () => false, start);
    await expect(recover()).rejects.toThrow("boot failed");
    await recover();
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("recognizes a healthy service and a refused connection", async () => {
    const fetchHealth = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
      .mockRejectedValueOnce(new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }));
    vi.stubGlobal("fetch", fetchHealth);
    await expect(isBackendListening(4310)).resolves.toBe(true);
    await expect(isBackendListening(4310)).resolves.toBe(false);
    expect(fetchHealth).toHaveBeenCalledWith("http://127.0.0.1:4310/health", expect.any(Object));
  });

  it("does not restart a service on an ambiguous health timeout", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timed out")));
    const start = vi.fn();
    await expect(createBackendRecovery(() => isBackendListening(4310), start)()).rejects.toThrow("timed out");
    expect(start).not.toHaveBeenCalled();
  });
});
