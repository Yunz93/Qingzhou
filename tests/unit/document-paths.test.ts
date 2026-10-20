import { expect, it } from "vitest";
import { DEFAULT_DOCUMENT_PATHS, documentPathsSchema, projectStandardManifestSchema, requirementFiles } from "@qingzhou/protocol";
import { projectStandardFiles } from "../../apps/server/src/tasks/project-standard";
import { splitWorkflowPatch } from "../../apps/web/src/lib/workflow-history";

it("keeps v1 manifests compatible and accepts independent project-relative document directories", () => {
  const manifest = projectStandardFiles("项目").find((file) => file.path === "docs/qingzhou/project.json")!;
  expect(projectStandardManifestSchema.parse(JSON.parse(manifest.content)).documentPaths).toBeUndefined();
  expect(documentPathsSchema.parse(DEFAULT_DOCUMENT_PATHS)).toEqual(DEFAULT_DOCUMENT_PATHS);
  expect(documentPathsSchema.parse({ prds: "设计/需求", modules: "设计/模块" }).prds).toBe("设计/需求");
  expect(requirementFiles("id", "设计/需求/稳定目录/PRD.md").context).toBe("设计/需求/稳定目录/CONTEXT.md");
});
it.each(["/absolute", "../outside", "docs/../outside", "docs/.git/subdir", ".git", "C:/docs", "docs\\prd", "docs//prd", "docs/./prd", "docs/", ""])("rejects unsafe document directory %j", (prds) => {
  expect(documentPathsSchema.safeParse({ prds, modules: "modules" }).success).toBe(false);
});
it.each([{ prds: "docs", modules: "docs" }, { prds: "docs", modules: "docs/modules" }, { prds: "docs/prds", modules: "docs" }])("rejects overlapping directories %j", (paths) => {
  expect(documentPathsSchema.safeParse(paths).success).toBe(false);
});
it("splits replay diffs into independently selectable files including non-ASCII paths", () => {
  const a = "diff --git a/设计.md b/设计.md\n--- a/设计.md\n+++ b/设计.md\n@@ -1 +1 @@\n-旧\n+新\n";
  const b = "diff --git a/with space.txt b/with space.txt\nBinary files differ\n";
  expect(splitWorkflowPatch(a + b)).toEqual([{ path: "设计.md", patch: a }, { path: "with space.txt", patch: b }]);
  expect(splitWorkflowPatch("")).toEqual([]);
});
it("explains empty and overlong directory input in Chinese", () => {
  for (const [prds, message] of [["", "目录不能为空"], ["a".repeat(241), "目录不能超过 240 个字符"]]) {
    const result = documentPathsSchema.safeParse({ prds, modules: "modules" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]).toMatchObject({ path: ["prds"], message });
  }
});
