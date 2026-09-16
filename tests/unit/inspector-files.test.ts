import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ancestorDirs,
  buildFileTree,
  fileKindBadge,
  gitMarksByPath,
  gitPatchesForEntry,
  parentDir,
  previewableFileEntries,
} from "../../apps/web/src/lib/inspector-files";

const entries = [
  { path: "apps", name: "apps", kind: "dir" as const },
  { path: "apps/desktop", name: "desktop", kind: "dir" as const },
  { path: "apps/desktop/scripts", name: "scripts", kind: "dir" as const },
  { path: "apps/desktop/src", name: "src", kind: "dir" as const },
  { path: "apps/desktop/src/main", name: "main", kind: "dir" as const },
  { path: "apps/desktop/src/preload", name: "preload", kind: "dir" as const },
  { path: "apps/desktop/package.json", name: "package.json", kind: "file" as const },
  { path: "apps/desktop/afterPack.mjs", name: "afterPack.mjs", kind: "file" as const },
  { path: "README.md", name: "README.md", kind: "file" as const },
];

describe("previewableFileEntries", () => {
  it("lists only files so the Files tab is not buried under non-clickable dirs", () => {
    const visible = previewableFileEntries(entries);

    expect(visible.every((entry) => entry.kind === "file")).toBe(true);
    expect(visible.some((entry) => entry.kind === "dir")).toBe(false);
    expect(visible.map((entry) => entry.path)).toEqual(
      ["README.md", "apps/desktop/afterPack.mjs", "apps/desktop/package.json"].sort((a, b) =>
        a.localeCompare(b),
      ),
    );
  });
});

describe("buildFileTree", () => {
  it("nests dirs above files and keeps root files at the top level", () => {
    const tree = buildFileTree(entries);
    expect(tree.map((node) => node.name)).toEqual(["apps", "README.md"]);
    const desktop = tree[0]?.children.find((node) => node.name === "desktop");
    expect(desktop?.kind).toBe("dir");
    expect(desktop?.children.map((node) => node.name)).toEqual(["scripts", "src", "afterPack.mjs", "package.json"]);
  });

  it("resolves parent folders of a previewed file", () => {
    expect(parentDir("apps/desktop/afterPack.mjs")).toBe("apps/desktop");
    expect(ancestorDirs("apps/desktop/afterPack.mjs")).toEqual(["apps", "apps/desktop"]);
  });
});

describe("gitMarksByPath", () => {
  it("maps porcelain status to explorer letters", () => {
    const marks = gitMarksByPath([
      { path: "README.md", status: " M" },
      { path: "AGENTS.md", status: "??" },
      { path: '"apps/web/package.json"', status: "M " },
    ]);
    expect(marks.get("README.md")).toEqual({ letter: "M", tone: "warn" });
    expect(marks.get("AGENTS.md")).toEqual({ letter: "U", tone: "accent" });
    expect(marks.get("apps/web/package.json")).toEqual({ letter: "M", tone: "warn" });
  });
});

describe("fileKindBadge", () => {
  it("labels common extensions for the explorer row", () => {
    expect(fileKindBadge("note.ts").label).toBe("TS");
    expect(fileKindBadge(".env.example").label).toBe("ENV");
    expect(fileKindBadge("package.json").label).toBe("{}");
  });
});

describe("InspectorPanel tabs", () => {
  it("keeps 文件 Git 终端 浏览器 资源 and does not offer 动态 or 分支", () => {
    const src = readFileSync(path.resolve("apps/web/src/components/inspector/InspectorPanel.tsx"), "utf8");
    expect(src).toMatch(/\(\["files", "git", "term", "browser", "resources"\] as const\)/);
    expect(src).not.toMatch(/"activity"/);
    expect(src).not.toMatch(/"changes"/);
    expect(src).not.toMatch(/\? "改动"/);
    expect(src).not.toMatch(/tab === "changes"/);
    expect(src).not.toMatch(/\? "动态"/);
    expect(src).not.toMatch(/\? "分支"/);
    expect(src).not.toMatch(/flex-\[2\]/);
    expect(src).toMatch(/aria-label=\{treeOpen \? "隐藏文件树" : "显示文件树"\}/);
    expect(src).toMatch(/aria-label="文件树"/);
    expect(src).not.toMatch(/刷新技能/);
    expect(src).toMatch(/skillBusy/);
    expect(src).toMatch(/pluginBusy/);
    expect(src).toMatch(/setSkillUpdates/);
    expect(src).toMatch(/全部撤销/);
    expect(src).toMatch(/onGitRestore/);
    expect(src).toMatch(/撤销 \$\{entry\.path\}/);
    const layout = readFileSync(path.resolve("apps/web/src/layouts/WorkbenchLayout.tsx"), "utf8");
    expect(layout).toMatch(/git\.restore/);
    const skills = readFileSync(path.resolve("apps/web/src/components/inspector/InspectorSkills.tsx"), "utf8");
    const plugins = readFileSync(path.resolve("apps/web/src/components/inspector/InspectorExtensions.tsx"), "utf8");
    const preview = readFileSync(path.resolve("apps/web/src/components/inspector/FilePreview.tsx"), "utf8");
    expect(skills).not.toMatch(/useState/);
    expect(plugins).not.toMatch(/useState/);
    expect(skills).not.toMatch(/刷新技能/);
    expect(plugins).not.toMatch(/刷新插件/);
    expect(skills).not.toMatch(/>系统技能</);
    expect(plugins).toMatch(/插件中心/);
    expect(plugins).toMatch(/已安装/);
    expect(plugins).not.toMatch(/推荐安装/);
    expect(plugins).not.toMatch(/安装推荐/);
    expect(plugins).not.toMatch(/PRESET_PI_PACKAGES/);
    expect(src).toMatch(/InspectorPackageCenter/);
    expect(layout).toMatch(/resources\.package\.catalog/);
    expect(layout).toMatch(/resources\.package\.install/);
    expect(skills).toMatch(/检查更新/);
    expect(skills).not.toMatch(/导出 HTML/);
    expect(preview).toMatch(/whitespace-pre-wrap/);
    expect(preview).toMatch(/break-words/);
    const header = src.slice(src.indexOf("tab === \"files\""), src.indexOf("tab === \"git\""));
    expect(header.indexOf("preview?.path")).toBeGreaterThan(-1);
    expect(header.indexOf("隐藏文件树")).toBeGreaterThan(header.indexOf("preview?.path"));
  });
});

describe("gitPatchesForEntry", () => {
  it("matches a file and files under an untracked folder", () => {
    const patches = [
      { path: "playwright.altconfig.ts", lines: 3 },
      { path: "tmp/a.ts", lines: 1 },
      { path: "tmp/b.ts", lines: 2 },
    ];
    expect(gitPatchesForEntry(patches, "playwright.altconfig.ts")).toEqual([patches[0]]);
    expect(gitPatchesForEntry(patches, "tmp/")).toEqual([patches[1], patches[2]]);
  });
});

describe("FileTree expand control", () => {
  it("places the directory chevron after the name, not before the folder icon", () => {
    const src = readFileSync(path.resolve("apps/web/src/components/inspector/FileTree.tsx"), "utf8");
    const name = src.indexOf("{node.name}");
    const chevron = src.lastIndexOf("ChevronRight");
    const folder = src.indexOf("<Folder");
    expect(name).toBeGreaterThan(folder);
    expect(chevron).toBeGreaterThan(name);
  });
});
