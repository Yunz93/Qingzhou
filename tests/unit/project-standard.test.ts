import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { PROJECT_STANDARD_PATHS, projectStandardManifestSchema } from "@qingzhou/protocol";
import { initializeProjectStandard, inspectProjectStandard } from "../../apps/server/src/tasks/project-standard";

it("previews exact missing files, preserves project-owned instructions and is idempotent", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "qingzhou-standard-"));
  await writeFile(path.join(root, "AGENTS.md"), "用户自己的协作规则\n");
  await writeFile(path.join(root, "README.md"), "已有项目入口\n");
  const inspection = await inspectProjectStandard(root, "已有项目");
  expect(inspection.ready).toBe(false);
  expect(inspection.files.find((file) => file.path === "AGENTS.md")).toMatchObject({ status: "present", preview: undefined });
  const preview = inspection.files.find((file) => file.path === PROJECT_STANDARD_PATHS.overview)!;
  const initialized = await initializeProjectStandard(root, "已有项目");
  expect(await readFile(path.join(root, preview.path), "utf8")).toBe(preview.preview);
  expect(await readFile(path.join(root, "AGENTS.md"), "utf8")).toBe("用户自己的协作规则\n");
  expect(await readFile(path.join(root, "README.md"), "utf8")).toBe("已有项目入口\n");
  expect(initialized.inspection.ready).toBe(true);
  expect(projectStandardManifestSchema.parse(JSON.parse(await readFile(path.join(root, PROJECT_STANDARD_PATHS.manifest), "utf8"))).standard).toBe("qingzhou-project");
  const second = await initializeProjectStandard(root, "其他显示名"); expect(second.created).toEqual([]);
  expect(second.preserved).toHaveLength(initialized.inspection.files.length);
});

it.each(["", "{broken"])("preserves an invalid manifest %j without partially initializing the project", async (invalid) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "qingzhou-standard-invalid-")); await mkdir(path.join(root, "docs/qingzhou"), { recursive: true });
  const file = path.join(root, PROJECT_STANDARD_PATHS.manifest); await writeFile(file, invalid);
  await expect(initializeProjectStandard(root, "项目")).rejects.toThrow("清单无效");
  expect(await readFile(file, "utf8")).toBe(invalid);
  await expect(readFile(path.join(root, "AGENTS.md"))).rejects.toMatchObject({ code: "ENOENT" });
});

it.skipIf(process.platform === "win32")("rejects linked documentation before writing any scaffold file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "qingzhou-standard-link-")); const repository = path.join(root, "repo"); const outside = path.join(root, "outside");
  await mkdir(repository); await mkdir(outside); await symlink(outside, path.join(repository, "docs"));
  await expect(initializeProjectStandard(repository, "项目")).rejects.toThrow("包含链接");
  await expect(readFile(path.join(repository, "AGENTS.md"))).rejects.toMatchObject({ code: "ENOENT" });
});
