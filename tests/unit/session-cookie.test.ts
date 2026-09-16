import { afterEach, describe, expect, it } from "vitest";
import {
  SESSION_TTL_MS,
  clearSessionsForTests,
  createSessionToken,
  expireSessionForTests,
  hasSession,
  readSessionToken,
} from "../../apps/server/src/security/session-cookie.ts";

afterEach(() => {
  clearSessionsForTests();
});

describe("session cookie TTL", () => {
  it("accepts fresh tokens and slides expiry on use", () => {
    const now = 1_000_000;
    const token = createSessionToken(now);
    expect(hasSession(token, now + 1_000)).toBe(true);
    // Still valid near the end of the refreshed window.
    expect(hasSession(token, now + 1_000 + SESSION_TTL_MS - 1)).toBe(true);
  });

  it("rejects expired tokens", () => {
    const token = createSessionToken(1_000);
    expireSessionForTests(token);
    expect(hasSession(token, 2_000)).toBe(false);
  });

  it("parses the session cookie from a header", () => {
    const token = createSessionToken();
    expect(readSessionToken(`a=1; qingzhou_session=${token}; b=2`)).toBe(token);
    expect(readSessionToken("a=1")).toBeUndefined();
  });
});
