import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listAuthEntries, removeAuth } from "../../apps/server/src/setup/auth-status.ts";
import { scanPiResources, createProjectAgentsFile, setSkillEnabled, setExtensionEnabled, PROJECT_AGENTS_TEMPLATE } from "../../apps/server/src/tasks/pi-resources.ts";
import { listPiSessions } from "../../apps/server/src/tasks/pi-sessions.ts";
import { flattenSessionTree } from "../../apps/server/src/tasks/session-tree.ts";

describe("pi mvp helpers", () => {
  it("lists oauth and api key entries without exposing secrets", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "qingzhou-auth-entries-"));
    await mkdir(path.join(home, ".pi", "agent"), { recursive: true });
    await writeFile(
      path.join(home, ".pi", "agent", "auth.json"),
      JSON.stringify({
        anthropic: { type: "api_key", key: "sk-secret-should-not-leak" },
        github: { type: "oauth" },
      }),
    );
    const entries = await listAuthEntries(home);
    expect(entries).toEqual(
      expect.arrayContaining([
        { id: "anthropic", label: "Anthropic (Claude)", kind: "api_key", source: "auth_file" },
        { id: "github", label: "GitHub Copilot", kind: "oauth", source: "auth_file" },
      ]),
    );
    expect(JSON.stringify(entries)).not.toContain("sk-secret");
  });

  it("marks shell env credentials with their env var", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "qingzhou-auth-env-"));
    const previous = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = "sk-deepseek-test";
    try {
      const entries = await listAuthEntries(home);
      expect(entries).toEqual(
        expect.arrayContaining([
          { id: "deepseek", label: "DeepSeek", kind: "api_key", source: "env", envVar: "DEEPSEEK_API_KEY" },
        ]),
      );
      expect(JSON.stringify(entries)).not.toContain("sk-deepseek-test");
    } finally {
      if (previous === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = previous;
    }
  });

  it("removes a provider from auth.json", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "qingzhou-auth-logout-"));
    await mkdir(path.join(home, ".pi", "agent"), { recursive: true });
    await writeFile(
      path.join(home, ".pi", "agent", "auth.json"),
      JSON.stringify({ github: { type: "oauth" }, anthropic: { type: "api_key", key: "sk-keep" } }),
    );
    await removeAuth("github", home);
    const remaining = await listAuthEntries(home);
    expect(remaining.some((entry) => entry.id === "github" || entry.id === "github-copilot")).toBe(false);
    expect(remaining.some((entry) => entry.id === "anthropic" && entry.kind === "api_key")).toBe(true);
    const raw = await readFile(path.join(home, ".pi", "agent", "auth.json"), "utf8");
    expect(JSON.parse(raw)).toEqual({ anthropic: { type: "api_key", key: "sk-keep" } });
  });

  it("scans AGENTS.md and only project skills when trusted", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "qingzhou-resources-"));
    const cwd = path.join(home, "project");
    await mkdir(path.join(cwd, ".agents", "skills", "review"), { recursive: true });
    await mkdir(path.join(home, ".pi", "agent", "skills", "user-skill"), { recursive: true });
    await writeFile(path.join(cwd, "AGENTS.md"), "# agents");
    await writeFile(path.join(cwd, ".agents", "skills", "review", "SKILL.md"), "# review");
    await writeFile(path.join(home, ".pi", "agent", "skills", "user-skill", "SKILL.md"), "# user");
    await mkdir(path.join(home, ".pi", "agent", "skills", "user-skill.qingzhou-new"), { recursive: true });
    await writeFile(path.join(home, ".pi", "agent", "skills", "user-skill.qingzhou-new", "SKILL.md"), "# leftover");

    const untrusted = await scanPiResources(cwd, home, false);
    expect(untrusted.agentsFiles.some((item) => item.kind === "agents")).toBe(true);
    expect(untrusted.skills.map((item) => item.name)).toEqual(["user-skill"]);

    const trusted = await scanPiResources(cwd, home, true);
    expect(trusted.skills.map((item) => item.name).sort()).toEqual(["review", "user-skill"]);
    expect(trusted.skills.every((item) => item.enabled !== false)).toBe(true);
  });

  it("marks skills disabled from settings.json exclusions", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "qingzhou-skill-off-"));
    const cwd = path.join(home, "project");
    const agentDir = path.join(home, ".pi", "agent");
    await mkdir(path.join(agentDir, "skills", "demo"), { recursive: true });
    await writeFile(path.join(agentDir, "skills", "demo", "SKILL.md"), "# demo");
    await writeFile(path.join(agentDir, "settings.json"), JSON.stringify({ skills: ["-skills/demo"] }));
    const scanned = await scanPiResources(cwd, home, false, agentDir);
    expect(scanned.skills).toEqual([
      expect.objectContaining({ name: "demo", enabled: false, scope: "user" }),
    ]);
    await setSkillEnabled({
      skillMdPath: path.join(agentDir, "skills", "demo", "SKILL.md"),
      enabled: true,
      cwd,
      homeDir: home,
      agentDir,
      scope: "user",
    });
    const enabled = await scanPiResources(cwd, home, false, agentDir);
    expect(enabled.skills[0]?.enabled).toBe(true);
  });

  it("scans user and project extensions, packages, and extra settings paths", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "qingzhou-ext-"));
    const cwd = path.join(home, "project");
    const agentDir = path.join(home, ".pi", "agent");
    await mkdir(path.join(agentDir, "extensions", "pack"), { recursive: true });
    await mkdir(path.join(cwd, ".pi", "extensions"), { recursive: true });
    await mkdir(path.join(home, "extra-dir"), { recursive: true });
    await writeFile(path.join(agentDir, "extensions", "user-ext.ts"), "export default function() {}");
    await writeFile(path.join(agentDir, "extensions", "pack", "index.ts"), "export default function() {}");
    await writeFile(path.join(cwd, ".pi", "extensions", "project-ext.ts"), "export default function() {}");
    await writeFile(path.join(home, "extra-dir", "index.ts"), "export default function() {}");
    await writeFile(
      path.join(agentDir, "settings.json"),
      JSON.stringify({
        extensions: ["~/extra-dir"],
        packages: ["git:https://example.com/pkg.git"],
      }),
    );
    await writeFile(
      path.join(cwd, ".pi", "settings.json"),
      JSON.stringify({ packages: [{ source: "@scope/pi-plugin" }] }),
    );

    const untrusted = await scanPiResources(cwd, home, false, agentDir);
    expect(untrusted.extensions.map((item) => item.name).sort()).toEqual(["extra-dir", "pack", "user-ext"]);
    expect(untrusted.extensions.every((item) => item.scope === "user")).toBe(true);
    expect(untrusted.packages).toEqual([{ source: "git:https://example.com/pkg.git", scope: "user" }]);

    const trusted = await scanPiResources(cwd, home, true, agentDir);
    expect(trusted.extensions.map((item) => item.name).sort()).toEqual(["extra-dir", "pack", "project-ext", "user-ext"]);
    expect(trusted.packages.map((item) => item.source).sort()).toEqual([
      "@scope/pi-plugin",
      "git:https://example.com/pkg.git",
    ]);
  });

  it("marks extensions disabled from settings.json exclusions and can re-enable them", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "qingzhou-ext-off-"));
    const cwd = path.join(home, "project");
    const agentDir = path.join(home, ".pi", "agent");
    await mkdir(path.join(agentDir, "extensions", "pack"), { recursive: true });
    await writeFile(path.join(agentDir, "extensions", "demo.ts"), "export default function() {}");
    await writeFile(path.join(agentDir, "extensions", "pack", "index.ts"), "export default function() {}");
    await writeFile(
      path.join(agentDir, "settings.json"),
      JSON.stringify({ extensions: ["-extensions/demo.ts", "-extensions/pack"] }),
    );
    const scanned = await scanPiResources(cwd, home, false, agentDir);
    expect(scanned.extensions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "demo", enabled: false, scope: "user" }),
        expect.objectContaining({ name: "pack", enabled: false, scope: "user" }),
      ]),
    );
    await setExtensionEnabled({
      extensionPath: path.join(agentDir, "extensions", "demo.ts"),
      enabled: true,
      cwd,
      homeDir: home,
      agentDir,
      scope: "user",
    });
    await setExtensionEnabled({
      extensionPath: path.join(agentDir, "extensions", "pack", "index.ts"),
      enabled: false,
      cwd,
      homeDir: home,
      agentDir,
      scope: "user",
    });
    const next = await scanPiResources(cwd, home, false, agentDir);
    expect(next.extensions.find((item) => item.name === "demo")?.enabled).toBe(true);
    expect(next.extensions.find((item) => item.name === "pack")?.enabled).toBe(false);
    const settings = JSON.parse(await readFile(path.join(agentDir, "settings.json"), "utf8")) as {
      extensions: string[];
    };
    expect(settings.extensions).toContain("-extensions/pack");
    expect(settings.extensions.some((item) => item.includes("demo"))).toBe(false);
  });

  it("creates project AGENTS.md once and refuses to overwrite", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "qingzhou-create-agents-"));
    const relative = await createProjectAgentsFile(cwd);
    expect(relative).toBe("AGENTS.md");
    const content = await readFile(path.join(cwd, "AGENTS.md"), "utf8");
    expect(content).toBe(PROJECT_AGENTS_TEMPLATE);
    await expect(createProjectAgentsFile(cwd)).rejects.toThrow("AGENTS.md 已存在");
  });

  it("lists Pi session files and can filter by cwd", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "qingzhou-sessions-"));
    const cwd = path.join(home, "repo");
    const dir = path.join(home, ".pi", "agent", "sessions", "--repo--");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "2026-01-01_abc.jsonl"),
      [
        JSON.stringify({ type: "session", id: "abc", cwd }),
        JSON.stringify({
          type: "message",
          message: { role: "user", content: [{ type: "text", text: "hello from pi session" }] },
        }),
      ].join("\n"),
    );
    await writeFile(
      path.join(dir, "other.jsonl"),
      JSON.stringify({ type: "session", id: "other", cwd: path.join(home, "elsewhere") }),
    );
    const all = await listPiSessions(home);
    expect(all.some((item) => item.preview === "hello from pi session")).toBe(true);
    const filtered = await listPiSessions(home, cwd);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe("abc");
  });

  it("flattens a Pi session tree", () => {
    const nodes = flattenSessionTree(
      [
        {
          entry: {
            type: "message",
            id: "user-0",
            parentId: null,
            message: { role: "user", content: [{ type: "text", text: "hi" }] },
          },
          children: [
            {
              entry: {
                type: "message",
                id: "asst-1",
                parentId: "user-0",
                message: { role: "assistant", content: [{ type: "text", text: "hello" }] },
              },
              children: [],
            },
          ],
        },
      ],
      "asst-1",
    );
    expect(nodes).toEqual([
      { id: "user-0", parentId: null, role: "user", text: "hi", leaf: false },
      { id: "asst-1", parentId: "user-0", role: "assistant", text: "hello", leaf: true },
    ]);
  });
});
