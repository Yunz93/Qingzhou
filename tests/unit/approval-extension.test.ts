import { mkdir, mkdtemp, realpath, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import approvalExtension from "../../apps/server/extensions/approval.ts";

type ApprovalHook = (
  event: { toolName: string; toolCallId: string; input: { path: string; content: string } },
  ctx: { hasUI: boolean; ui: { confirm: () => Promise<boolean> } },
) => Promise<{ block: boolean; reason: string } | undefined>;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Pi approval extension write paths", () => {
  it("approves new nested files without allowing protected paths or symlink escapes", async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "qingzhou-approval-")));
    const project = path.join(root, "project");
    const outside = path.join(root, "outside");
    await mkdir(project);
    await mkdir(outside);
    const linkType = process.platform === "win32" ? "junction" : "dir";
    await symlink(outside, path.join(project, "link"), linkType);
    await symlink(path.join(outside, "missing"), path.join(project, "dangling"), linkType);
    vi.spyOn(process, "cwd").mockReturnValue(project);
    vi.stubEnv("QINGZHOU_ALLOWED_ROOTS", project);
    vi.stubEnv("QINGZHOU_MUTATIONS", "approval");
    let hook!: ApprovalHook;
    approvalExtension({ on: (_event: string, callback: ApprovalHook) => { hook = callback; } } as never);
    const confirm = vi.fn(async () => true);
    const write = (filePath: string) => hook(
      { toolName: "write", toolCallId: "test-write", input: { path: filePath, content: "new file" } },
      { hasUI: true, ui: { confirm } },
    );

    await expect(write("new/src/app.ts")).resolves.toBeUndefined();
    expect(confirm).toHaveBeenCalledOnce();
    for (const target of ["new/.env", "new/.ssh/key", "../outside/new/file.txt", "link/new/file.txt", "dangling/new/file.txt"]) {
      await expect(write(target)).resolves.toMatchObject({ block: true });
    }
    // Invalid targets are blocked before requesting user approval.
    expect(confirm).toHaveBeenCalledOnce();
  });
});
