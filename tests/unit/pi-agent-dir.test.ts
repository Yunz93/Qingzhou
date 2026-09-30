import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveApiKey } from "../../apps/server/src/setup/auth-status.ts";
import { loadConfig } from "../../apps/server/src/config.ts";
import {
  extractErrorText,
  humanizeAuthAccessError,
  humanizeAuthHttpError,
  humanizeNpmCacheAccessError,
  humanizeUserFacingError,
  isAuthHttpError,
  isMissingCredentialError,
  isNpmCacheAccessError,
  isProviderRequestError,
  applyPiAgentDir,
  resolvePiAgentDir,
  shouldSurfacePiStderr,
  stripPiSourceDump,
} from "../../apps/server/src/setup/pi-agent-dir.ts";

describe("Pi agent dir and auth errors", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("humanizes EACCES on auth.json and does not treat it as a missing API key", () => {
    const error = Object.assign(new Error("EACCES: permission denied, open '/Users/yunz/.pi/agent/auth.json'"), {
      code: "EACCES",
    });
    const message = humanizeAuthAccessError(error);
    expect(message).toMatch(/登录文件/);
    expect(message).toMatch(/chown/);
    expect(isMissingCredentialError(error.message)).toBe(false);
    expect(isMissingCredentialError("No API key configured")).toBe(true);
    expect(isMissingCredentialError("missing key")).toBe(true);
  });

  it("humanizes HTTP 401/403 and does not treat them as a missing API key", () => {
    expect(isAuthHttpError("HTTP 401 Unauthorized")).toBe(true);
    expect(isAuthHttpError('{"type":"authentication_error","message":"invalid x-api-key"}')).toBe(true);
    expect(isAuthHttpError("Invalid API key")).toBe(true);
    expect(isAuthHttpError("403 Forbidden")).toBe(true);
    expect(isMissingCredentialError("HTTP 401 Unauthorized")).toBe(false);
    expect(isMissingCredentialError("Invalid API key")).toBe(false);
    expect(isMissingCredentialError("403 Forbidden")).toBe(false);
    expect(humanizeAuthHttpError("HTTP 401 Unauthorized")).toMatch(/登录已失效/);
    expect(humanizeUserFacingError(new Error("HTTP 401 Unauthorized"))).toMatch(/HTTP 401/);
    expect(humanizeUserFacingError(new Error("403 Forbidden"))).toMatch(/HTTP 403/);
    expect(humanizeUserFacingError(new Error("Fast mode is unavailable for the current model."))).toBe(
      "当前模型不支持 Fast 模式。",
    );
    expect(humanizeUserFacingError(new Error("Working directory is outside allowed roots"))).toBe(
      "工作文件夹不在允许的范围内",
    );
    expect(shouldSurfacePiStderr("HTTP 401: authentication_error")).toBe(true);
    expect(shouldSurfacePiStderr("EACCES: permission denied, open '/Users/yunz/.pi/agent/auth.json'")).toBe(true);
    expect(shouldSurfacePiStderr("fd not found. Downloading...")).toBe(false);
  });

  it("extracts provider API error objects instead of [object Object]", () => {
    expect(
      extractErrorText({
        type: "rate_limit_error",
        message: "Request would exceed rate limit",
      }),
    ).toBe("rate_limit_error: Request would exceed rate limit");
    expect(
      extractErrorText({
        error: { type: "overloaded_error", message: "Anthropic is overloaded" },
      }),
    ).toMatch(/overloaded_error: Anthropic is overloaded/);
    expect(isProviderRequestError("HTTP 429 Too Many Requests")).toBe(true);
    expect(isProviderRequestError("insufficient_quota")).toBe(true);
    expect(shouldSurfacePiStderr("HTTP 429 Too Many Requests: rate_limit_error")).toBe(true);
    expect(shouldSurfacePiStderr("额度不足")).toBe(true);
    expect(humanizeUserFacingError(new Error("insufficient_quota"))).toMatch(/额度不足/);
    expect(humanizeUserFacingError(new Error("额度不足，请充值"))).toMatch(/额度不足/);
    expect(humanizeUserFacingError({ type: "rate_limit_error", message: "Request would exceed rate limit" })).toMatch(
      /API 请求失败：[\s\S]*rate_limit_error[\s\S]*Request would exceed rate limit/,
    );
    expect(humanizeUserFacingError(new Error("HTTP 529 Overloaded"))).toMatch(/API 请求失败：[\s\S]*529/);
  });

  it("humanizes a root-owned npm cache and strips Pi source dumps", () => {
    const dump = [
      "npm error code EACCES",
      "npm error syscall open",
      "npm error path /Users/yunz/.npm/_cacache/index-v5/55/8c/deadbeef",
      "npm error errno EACCES",
      "npm error Your cache folder contains root-owned files, due to a bug in",
      "npm error previous versions of npm which has since been addressed.",
      "npm error To permanently fix this problem, please run:",
      'npm error   sudo chown -R 501:20 "/Users/yunz/.npm"',
      "file:///Users/yunz/.npm-global/lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/chunks/chunk-JVUZSMYM.js:1247",
      `getNpmInstallRoot(scope,temporary){${"x".repeat(500)}`,
    ].join("\n");
    expect(isNpmCacheAccessError(dump)).toBe(true);
    expect(shouldSurfacePiStderr(dump)).toBe(true);
    const human = humanizeNpmCacheAccessError(new Error(dump));
    expect(human).toMatch(/npm 缓存/);
    expect(human).toMatch(/chown/);
    expect(human).not.toMatch(/getNpmInstallRoot/);
    expect(humanizeUserFacingError(new Error(dump))).toMatch(/npm 缓存/);
    expect(stripPiSourceDump(dump)).not.toMatch(/getNpmInstallRoot/);
    expect(stripPiSourceDump(dump)).toMatch(/EACCES/);
  });

  it("points Pi at a writable npm cache under the agent dir", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "qingzhou-npm-cache-"));
    dirs.push(home);
    const agentDir = path.join(home, ".pi", "agent");
    const config = applyPiAgentDir(loadConfig({}, { homeDir: home }), agentDir);
    expect(config.piExtraEnv.npm_config_cache).toBe(path.join(agentDir, "npm-cache"));
    const info = await stat(path.join(agentDir, "npm-cache"));
    expect(info.isDirectory()).toBe(true);
  });

  it("keeps ~/.pi/agent when it is writable", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "qingzhou-agent-ok-"));
    const data = await mkdtemp(path.join(os.tmpdir(), "qingzhou-data-ok-"));
    dirs.push(home, data);
    const resolved = await resolvePiAgentDir(home, data);
    expect(resolved).toBe(path.join(home, ".pi", "agent"));
  });

  it("falls back when ~/.pi/agent cannot be used as a directory", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "qingzhou-agent-bad-"));
    const data = await mkdtemp(path.join(os.tmpdir(), "qingzhou-data-bad-"));
    dirs.push(home, data);
    await mkdir(path.join(home, ".pi"), { recursive: true });
    await writeFile(path.join(home, ".pi", "agent"), "not a directory");
    const resolved = await resolvePiAgentDir(home, data);
    expect(resolved).toBe(path.join(data, "pi-agent"));
  });

  it("repairs an owner-locked auth.json then writes the key", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "qingzhou-auth-fix-"));
    dirs.push(home);
    const agentDir = path.join(home, ".pi", "agent");
    const authPath = path.join(agentDir, "auth.json");
    await mkdir(agentDir, { recursive: true });
    await writeFile(authPath, "{}\n", { mode: 0o600 });
    if (process.platform !== "win32") await chmod(authPath, 0);
    await saveApiKey("anthropic", "sk-ant-repaired-key-123456", home, agentDir);
    const info = await stat(authPath);
    if (process.platform !== "win32") expect(info.mode & 0o777).toBe(0o600);
    const raw = await (await import("node:fs/promises")).readFile(authPath, "utf8");
    expect(raw).toContain("sk-ant-repaired-key-123456");
  });
});
