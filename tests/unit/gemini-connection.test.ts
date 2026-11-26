import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerSetupRoutes } from "../../apps/server/src/routes/setup.ts";
import { loadConfig } from "../../apps/server/src/config.ts";
import { listAuthEntries, removeAuth, saveApiKey } from "../../apps/server/src/setup/auth-status.ts";
import { proxiedFetch } from "../../apps/server/src/setup/http-proxy.ts";
import { SettingsStore } from "../../apps/server/src/setup/settings-store.ts";

const requireFromServer = createRequire(new URL("../../apps/server/package.json", import.meta.url));
const Fastify = requireFromServer("fastify") as typeof import("fastify").default;

vi.mock("../../apps/server/src/setup/http-proxy.ts", async (original) => ({
  ...await original<typeof import("../../apps/server/src/setup/http-proxy.ts")>(), proxiedFetch: vi.fn(),
}));

describe("Gemini credential setup", () => {
  const request = vi.mocked(proxiedFetch);
  let directory: string;
  let agentDir: string;
  let app: ReturnType<typeof Fastify>;
  const savedKey = "fixture-saved-google-key";
  const draftKey = "fixture-pasted-google-key";

  beforeEach(async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    directory = await mkdtemp(path.join(os.tmpdir(), "mowen-credential-"));
    agentDir = path.join(directory, ".pi", "agent");
    await mkdir(agentDir, { recursive: true });
    const config = loadConfig({ QINGZHOU_HOME_DIR: directory, QINGZHOU_DATA_DIR: directory });
    app = Fastify();
    registerSetupRoutes(app, { getConfig: () => config, getPi: () => ({ version: null, error: null }),
      setAllowedRoots: () => undefined, settings: new SettingsStore(directory) });
  });
  afterEach(async () => {
    await app.close();
    request.mockReset();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  const probe = (payload: Record<string, string> = {}) =>
    app.inject({ method: "POST", url: "/api/setup/test-gemini", payload });
  const success = () => Response.json({ models: [{ name: "models/fixture" }] });
  const sentKey = () => new Headers(request.mock.lastCall?.[1]?.headers).get("x-goog-api-key");

  it("checks a draft without saving it or generating content and falls back to the effective saved or environment key", async () => {
    vi.stubEnv("GEMINI_API_KEY", "fixture-environment");
    await saveApiKey("google", savedKey, directory);
    request.mockImplementation(async () => success());
    expect((await probe({ apiKey: " " + draftKey + " " })).json()).toEqual({ ok: true });
    expect(sentKey()).toBe(draftKey);
    expect(request.mock.lastCall?.[0]).toBe("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1");
    expect(request.mock.lastCall?.[1]).toEqual(expect.objectContaining({ redirect: "error" }));
    expect((await probe()).statusCode).toBe(200);
    expect(sentKey()).toBe(savedKey);
    await removeAuth("google", directory);
    expect(await listAuthEntries(directory)).toContainEqual(expect.objectContaining({ id: "google", source: "env" }));
    expect((await probe()).statusCode).toBe(200);
    expect(sentKey()).toBe("fixture-environment");
  });

  it("reports failures without reflecting upstream secrets or accepting non-catalog responses", async () => {
    for (const [status, expected] of [[400, 400], [403, 400], [429, 429], [503, 502]]) {
      request.mockResolvedValueOnce(new Response(draftKey, { status }));
      const result = await probe({ apiKey: draftKey });
      expect(result.statusCode).toBe(expected);
      expect(result.json().error).toMatch(/Google|Gemini/);
      expect(result.body).not.toContain(draftKey);
    }
    request.mockRejectedValueOnce(new Error(draftKey));
    expect((await probe({ apiKey: draftKey })).body).not.toContain(draftKey);
    request.mockResolvedValueOnce(Response.json({ models: [] }));
    expect((await probe({ apiKey: draftKey })).statusCode).toBe(502);
    expect((await readFile(path.join(agentDir, "auth.json")).catch(() => ""))).toBe("");
  });

  it("keeps custom endpoint credentials and dynamic values local and limits probes to the official host", async () => {
    await saveApiKey("google", savedKey, directory);
    await writeFile(path.join(agentDir, "models.json"), JSON.stringify({ providers: { google: { baseUrl: "https://custom.invalid" } } }));
    expect((await probe()).statusCode).toBe(409);
    expect((await probe({ apiKey: draftKey })).statusCode).toBe(409);
    await writeFile(path.join(agentDir, "models.json"), JSON.stringify({ providers: { google: { models: [{ id: "fixture", baseUrl: "https://custom.invalid" }] } } }));
    expect((await probe()).statusCode).toBe(409);
    expect((await probe({ apiKey: draftKey })).statusCode).toBe(409);
    await writeFile(path.join(agentDir, "models.json"), "{}");
    await writeFile(path.join(agentDir, "auth.json"), JSON.stringify({ google: { type: "api_key", key: "$CUSTOM_PROVIDER" } }));
    expect((await probe()).statusCode).toBe(400);
    expect((await probe({ apiKey: draftKey, url: "https://custom.invalid" })).statusCode).toBe(400);
    expect(request).not.toHaveBeenCalled();
  });

  it("requires fresh consent for custom recipients, including same-host address changes, and exposes only origins", async () => {
    const modelsFile = path.join(agentDir, "models.json");
    const writeProfile = (segment: string) => writeFile(modelsFile, JSON.stringify({ providers: { google: {
      baseUrl: `https://login:private@relay.invalid/${segment}?secret=fixture-secret`,
      models: [{ id: "local", baseUrl: "http://localhost:6854/path" }],
    } } }));
    const save = (confirmedGeminiTarget?: string) => app.inject({ method: "POST", url: "/api/setup/api-key",
      payload: { provider: "google", apiKey: draftKey, confirmedGeminiTarget } });
    await writeProfile("private-path-one");
    const setup = await app.inject({ url: "/api/setup" });
    const original = setup.json().geminiTarget;
    expect(original).toMatchObject({ kind: "custom", origins: ["http://localhost:6854", "https://relay.invalid"] });
    expect(setup.body).not.toMatch(/private-path|fixture-secret|login:private|private@relay/);
    expect((await save()).statusCode).toBe(409);
    await writeProfile("private-path-two");
    const stale = await save(original.revision);
    expect(stale.statusCode).toBe(409);
    expect(stale.json().geminiTarget.revision).not.toBe(original.revision);
    expect(stale.body).not.toMatch(/private-path|fixture-secret|login:private|private@relay/);
    expect(await readFile(path.join(agentDir, "auth.json")).catch(() => "")).toBe("");
    expect((await save(stale.json().geminiTarget.revision)).statusCode).toBe(200);
    await writeFile(modelsFile, "{}");
    expect((await save(stale.json().geminiTarget.revision)).json().geminiTarget).toEqual({ kind: "official" });
    await writeFile(modelsFile, "{invalid");
    expect((await save()).json().geminiTarget).toEqual({ kind: "unavailable" });
    expect((await probe({ apiKey: draftKey })).statusCode).toBe(409);
    expect(request).not.toHaveBeenCalled();
  });

  it("keeps other credentials on concurrent saves and preserves a damaged auth file", async () => {
    await Promise.all([saveApiKey("google", savedKey, directory), saveApiKey("openai", "fixture-other-key", directory)]);
    expect(JSON.parse(await readFile(path.join(agentDir, "auth.json"), "utf8"))).toEqual({
      google: { type: "api_key", key: savedKey }, openai: { type: "api_key", key: "fixture-other-key" },
    });
    const damaged = '{"google":{"key":"fixture-existing"';
    await writeFile(path.join(agentDir, "auth.json"), damaged);
    const setup = await app.inject({ url: "/api/setup" });
    expect(setup.statusCode).toBe(200);
    expect(setup.json().configuredProviders).not.toContain("google");
    await expect(saveApiKey("google", draftKey, directory)).rejects.toThrow("原文件已保留");
    expect(await readFile(path.join(agentDir, "auth.json"), "utf8")).toBe(damaged);
  });
});
