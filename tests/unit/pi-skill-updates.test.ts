import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applySystemSkillUpdates,
  checkSystemSkillUpdates,
  gitRemoteCommand,
  githubFolderHash,
  githubHttpsRemoteUrl,
  hashSkillFolder,
  isGithubPermissionError,
  isSkillSwapDir,
  parseGithubRepo,
  parseSkillFrontmatter,
  parseSkillLock,
  reclaimSkillSwapDirs,
  replaceSkillDir,
  shouldFetchSkillRemotes,
} from "../../apps/server/src/tasks/pi-skill-updates.ts";

describe("system skill updates", () => {
  it("skips remotes in tests and e2e", () => {
    expect(shouldFetchSkillRemotes({ VITEST: "true" })).toBe(false);
    expect(shouldFetchSkillRemotes({ QINGZHOU_E2E: "1" })).toBe(false);
    expect(shouldFetchSkillRemotes({ QINGZHOU_SKIP_SKILL_UPDATE: "1" })).toBe(false);
    expect(shouldFetchSkillRemotes({})).toBe(true);
  });

  it("parses GitHub repos, frontmatter, lock files, and folder hashes", () => {
    expect(parseGithubRepo("https://github.com/vercel-labs/agent-skills.git")).toEqual({
      owner: "vercel-labs",
      repo: "agent-skills",
    });
    expect(parseGithubRepo("git@github.com:owner/repo.git")).toEqual({ owner: "owner", repo: "repo" });
    expect(parseGithubRepo("owner/repo")).toEqual({ owner: "owner", repo: "repo" });
    expect(githubHttpsRemoteUrl("owner", "repo")).toBe("https://github.com/owner/repo.git");
    expect(gitRemoteCommand(["ls-remote", "origin", "HEAD"])).toEqual([
      "-c",
      "url.https://github.com/.insteadOf=git@github.com:",
      "-c",
      "url.https://github.com/.insteadOf=ssh://git@github.com/",
      "ls-remote",
      "origin",
      "HEAD",
    ]);
    expect(isGithubPermissionError(new Error("Permission denied (publickey)"))).toBe(true);
    expect(isGithubPermissionError(new Error("GitHub 拒绝访问（HTTP 403）。"))).toBe(true);
    expect(isGithubPermissionError(new Error("GitHub 限制了检查次数，请稍后再试。"))).toBe(true);
    expect(isGithubPermissionError(new Error("ENOENT"))).toBe(false);
    expect(parseSkillFrontmatter("---\nname: demo\nsource: https://github.com/acme/skills\n---\nbody")).toEqual({
      name: "demo",
      source: "https://github.com/acme/skills",
    });
    const entries = parseSkillLock({
      version: 3,
      skills: {
        design: {
          source: "vercel-labs/agent-skills",
          sourceUrl: "https://github.com/vercel-labs/agent-skills",
          skillPath: "skills/design",
          skillFolderHash: "aaa",
        },
      },
    });
    expect(entries).toEqual([
      {
        name: "design",
        source: "vercel-labs/agent-skills",
        sourceUrl: "https://github.com/vercel-labs/agent-skills",
        skillPath: "skills/design",
        skillFolderHash: "aaa",
        ref: undefined,
      },
    ]);
    expect(
      githubFolderHash(
        {
          sha: "root",
          tree: [
            { path: "skills/design", type: "tree", sha: "folder" },
            { path: "skills/design/SKILL.md", type: "blob", sha: "file" },
          ],
        },
        "skills/design/SKILL.md",
      ),
    ).toBe("folder");
  });

  it("marks local skills as not updatable and detects lockfile updates", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "qingzhou-skill-home-"));
    const skillDir = path.join(home, ".pi", "agent", "skills", "demo");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), "# demo\n");
    const local = await checkSystemSkillUpdates({
      skills: [{ name: "demo", path: path.join(skillDir, "SKILL.md"), scope: "user", enabled: true }],
      homeDir: home,
      cwd: home,
      fetchRemotes: true,
    });
    expect(local.items).toEqual([
      { name: "demo", path: path.join(skillDir, "SKILL.md"), source: "local", updateAvailable: false },
    ]);

    const trackedDir = path.join(home, ".agents", "skills", "design");
    await mkdir(trackedDir, { recursive: true });
    await writeFile(path.join(trackedDir, "SKILL.md"), "# design\n");
    await mkdir(path.join(home, ".agents"), { recursive: true });
    await writeFile(
      path.join(home, ".agents", ".skill-lock.json"),
      `${JSON.stringify({
        version: 3,
        skills: {
          design: {
            source: "acme/skills",
            skillPath: "skills/design",
            skillFolderHash: "old",
          },
        },
      })}\n`,
    );
    const checked = await checkSystemSkillUpdates({
      skills: [{ name: "design", path: path.join(trackedDir, "SKILL.md"), scope: "user", enabled: true }],
      homeDir: home,
      cwd: home,
      fetchRemotes: true,
      hooks: {
        fetchGithubTree: async () => ({
          sha: "root",
          tree: [{ path: "skills/design", type: "tree", sha: "new" }],
        }),
      },
    });
    expect(checked.items[0]).toMatchObject({
      name: "design",
      source: "github",
      current: "old",
      latest: "new",
      updateAvailable: true,
    });
  });

  it("applies a GitHub skill update and writes the new lock hash", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "qingzhou-skill-apply-"));
    const skillDir = path.join(home, ".agents", "skills", "design");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), "# old\n");
    await writeFile(
      path.join(home, ".agents", ".skill-lock.json"),
      `${JSON.stringify({
        version: 3,
        skills: {
          design: {
            source: "acme/skills",
            skillPath: "skills/design",
            skillFolderHash: "old",
          },
        },
      })}\n`,
    );
    const skillPath = path.join(skillDir, "SKILL.md");
    const result = await applySystemSkillUpdates({
      skills: [{ name: "design", path: skillPath, scope: "user", enabled: true }],
      homeDir: home,
      cwd: home,
      fetchRemotes: true,
      hooks: {
        fetchGithubTree: async () => ({
          sha: "root",
          tree: [{ path: "skills/design", type: "tree", sha: "new" }],
        }),
        applyGithub: async ({ dest }) => {
          await writeFile(path.join(dest, "SKILL.md"), "# new\n");
          return "new";
        },
      },
    });
    expect(result.updated).toEqual([skillPath]);
    expect(result.failed).toEqual([]);
    expect(result.items[0]?.updateAvailable).toBe(false);
    expect(result.items[0]?.current).toBe("new");
    expect(await readFile(path.join(skillDir, "SKILL.md"), "utf8")).toBe("# new\n");
    const lock = JSON.parse(await readFile(path.join(home, ".agents", ".skill-lock.json"), "utf8")) as {
      skills: { design: { skillFolderHash: string } };
    };
    expect(lock.skills.design.skillFolderHash).toBe("new");
  });

  it("pulls a git-backed skill when HEAD differs from origin", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "qingzhou-skill-git-"));
    const skillDir = path.join(home, ".pi", "agent", "skills", "review");
    await mkdir(path.join(skillDir, ".git"), { recursive: true });
    await writeFile(path.join(skillDir, ".git", "HEAD"), "ref: refs/heads/main\n");
    await writeFile(path.join(skillDir, "SKILL.md"), "# review\n");
    let pulled = false;
    const result = await applySystemSkillUpdates({
      skills: [{ name: "review", path: path.join(skillDir, "SKILL.md"), scope: "user", enabled: true }],
      homeDir: home,
      cwd: home,
      fetchRemotes: true,
      hooks: {
        gitHead: async () => "aaa",
        gitLsRemote: async () => "bbb",
        gitPull: async () => {
          pulled = true;
        },
      },
    });
    expect(pulled).toBe(true);
    expect(result.updated).toEqual([path.join(skillDir, "SKILL.md")]);
  });

  it("hashes a skill folder stably and falls back when GitHub API has no permission", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "qingzhou-skill-fallback-"));
    const skillDir = path.join(home, ".agents", "skills", "design");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), "# design\n");
    const localHash = await hashSkillFolder(skillDir);
    expect(localHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashSkillFolder(skillDir)).toBe(localHash);

    await mkdir(path.join(home, ".agents"), { recursive: true });
    await writeFile(
      path.join(home, ".agents", ".skill-lock.json"),
      `${JSON.stringify({
        version: 3,
        skills: {
          design: {
            source: "acme/skills",
            skillPath: "skills/design",
            skillFolderHash: "old-tree",
          },
        },
      })}\n`,
    );
    const skillPath = path.join(skillDir, "SKILL.md");
    const same = await checkSystemSkillUpdates({
      skills: [{ name: "design", path: skillPath, scope: "user", enabled: true }],
      homeDir: home,
      cwd: home,
      fetchRemotes: true,
      hooks: {
        fetchGithubTree: async () => {
          throw new Error("GitHub 限制了检查次数，请稍后再试。");
        },
        githubFolderContentHash: async () => localHash,
      },
    });
    expect(same.items[0]).toMatchObject({
      source: "github",
      updateAvailable: false,
      current: localHash,
      latest: localHash,
    });
    expect(same.items[0]?.error).toBeUndefined();

    const newer = await checkSystemSkillUpdates({
      skills: [{ name: "design", path: skillPath, scope: "user", enabled: true }],
      homeDir: home,
      cwd: home,
      fetchRemotes: true,
      hooks: {
        fetchGithubTree: async () => {
          throw new Error("Permission denied (publickey)");
        },
        githubFolderContentHash: async () => "remote-newer",
      },
    });
    expect(newer.items[0]).toMatchObject({
      source: "github",
      updateAvailable: true,
      latest: "remote-newer",
    });
  });

  it("replaces a skill folder without leaving .qingzhou-new siblings", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qingzhou-skill-swap-"));
    const dest = path.join(root, "check");
    const source = path.join(root, "incoming");
    await mkdir(dest, { recursive: true });
    await mkdir(source, { recursive: true });
    await writeFile(path.join(dest, "SKILL.md"), "# old\n");
    await writeFile(path.join(source, "SKILL.md"), "# new\n");
    await replaceSkillDir(source, dest);
    expect(await readFile(path.join(dest, "SKILL.md"), "utf8")).toBe("# new\n");
    const names = await readdir(root);
    expect(names).toContain("check");
    expect(names).not.toContain("check.qingzhou-new");
    expect(names).not.toContain("check.qingzhou-old");
  });

  it("reclaims leftover swap folders so they are not listed as skills", async () => {
    expect(isSkillSwapDir("check.qingzhou-new")).toBe(true);
    expect(isSkillSwapDir("check.qingzhou-old")).toBe(true);
    expect(isSkillSwapDir("check")).toBe(false);

    const both = await mkdtemp(path.join(os.tmpdir(), "qingzhou-skill-dup-"));
    await mkdir(path.join(both, "check"), { recursive: true });
    await mkdir(path.join(both, "check.qingzhou-new"), { recursive: true });
    await writeFile(path.join(both, "check", "SKILL.md"), "# current\n");
    await writeFile(path.join(both, "check.qingzhou-new", "SKILL.md"), "# leftover\n");
    await reclaimSkillSwapDirs(both);
    expect(await readdir(both)).toEqual(["check"]);
    expect(await readFile(path.join(both, "check", "SKILL.md"), "utf8")).toBe("# current\n");

    const orphan = await mkdtemp(path.join(os.tmpdir(), "qingzhou-skill-orphan-"));
    await mkdir(path.join(orphan, "health.qingzhou-new"), { recursive: true });
    await writeFile(path.join(orphan, "health.qingzhou-new", "SKILL.md"), "# recovered\n");
    await reclaimSkillSwapDirs(orphan);
    expect(await readdir(orphan)).toEqual(["health"]);
    expect(await readFile(path.join(orphan, "health", "SKILL.md"), "utf8")).toBe("# recovered\n");
  });
});
