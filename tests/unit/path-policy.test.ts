import { mkdtemp, symlink, writeFile, mkdir, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertAllowedCwd,
  exportAllowedRoots,
  isProtectedWriteTarget,
  PathPolicyError,
  resolveAllowedPath,
  resolveExistingRoots,
  resolveReadableExportPath,
  userCwdRoots,
} from "../../apps/server/src/security/path-policy.ts";

describe("path policy", () => {
  it("rejects cwd outside allowed roots", async () => {
    const allowed = await mkdtemp(path.join(os.tmpdir(), "qingzhou-allowed-"));
    await expect(assertAllowedCwd(os.tmpdir(), [allowed])).rejects.toMatchObject({
      name: "PathPolicyError",
      message: "工作文件夹不在允许的范围内",
    });
  });

  it("skips missing roots and still accepts a live one", async () => {
    const allowed = await mkdtemp(path.join(os.tmpdir(), "qingzhou-allowed-"));
    const missing = path.join(os.tmpdir(), `qingzhou-missing-${Date.now()}`);
    await expect(assertAllowedCwd(allowed, [missing, allowed])).resolves.toBe(await realpath(allowed));
    expect(await resolveExistingRoots([missing, allowed])).toEqual([await realpath(allowed)]);
  });

  it("includes home with workspace roots for user-picked folders", () => {
    expect(userCwdRoots("/home/me", ["/work/app"])).toEqual([path.resolve("/work/app"), path.resolve("/home/me")]);
    expect(userCwdRoots("/work/app", ["/work/app"])).toEqual([path.resolve("/work/app")]);
  });

  it("blocks .env writes", () => {
    expect(isProtectedWriteTarget("/var/allowed-only/app/.env")).toBe(true);
  });

  it("blocks symlink escape", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qingzhou-root-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "qingzhou-out-"));
    const secret = path.join(outside, "secret.txt");
    await writeFile(secret, "nope");
    const link = path.join(root, "escape");
    await symlink(outside, link);
    await expect(resolveAllowedPath("escape/secret.txt", root, [root])).rejects.toBeInstanceOf(PathPolicyError);
  });

  it("allows writes inside cwd", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qingzhou-ok-"));
    await mkdir(path.join(root, "src"));
    const resolved = await resolveAllowedPath("src/app.ts", root, [root]);
    expect(resolved.endsWith(`${path.sep}src${path.sep}app.ts`)).toBe(true);
  });

  it("serves html exports only from allowed roots", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "qingzhou-home-"));
    const data = path.join(home, "data");
    await mkdir(data);
    const html = path.join(data, "chat.html");
    await writeFile(html, "<html><body>ok</body></html>");
    const roots = exportAllowedRoots({
      homeDir: home,
      dataDir: data,
      allowedRoots: [home],
      tmpDir: path.join(home, "tmp"),
    });
    await expect(resolveReadableExportPath(html, roots)).resolves.toBe(await realpath(html));

    const txt = path.join(data, "chat.txt");
    await writeFile(txt, "nope");
    await expect(resolveReadableExportPath(txt, roots)).rejects.toMatchObject({ status: 400 });

    const missing = path.join(data, "gone.html");
    await expect(resolveReadableExportPath(missing, roots)).rejects.toMatchObject({ status: 404 });

    const outsideDir = await mkdtemp(path.join(os.tmpdir(), "qingzhou-export-deny-"));
    const outside = path.join(outsideDir, "secret.html");
    await writeFile(outside, "<html>no</html>");
    await expect(resolveReadableExportPath(outside, roots)).rejects.toMatchObject({ status: 403 });
    await rm(outsideDir, { recursive: true, force: true });
  });
});
