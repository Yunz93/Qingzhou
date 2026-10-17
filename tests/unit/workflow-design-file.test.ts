import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { requirementDesignPath } from "@qingzhou/protocol";
import { readWorkspaceDesign, writeWorkspaceDesign } from "../../apps/server/src/tasks/workflow-design-file";

it("roundtrips an exact bounded design document and rejects corrupt or oversized input", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "qingzhou-design-file-")); const id = randomUUID();
  expect(await readWorkspaceDesign(root, id)).toBeNull();
  const document = { schemaVersion: 1 as const, prdId: randomUUID(), content: "目标与方案", moduleChanges: [] };
  await writeWorkspaceDesign(root, id, document);
  expect(await readWorkspaceDesign(root, id)).toEqual(document);
  expect(await readdir(path.join(root, "docs/qingzhou/requirements"))).toEqual([`${id}.json`]);
  const file = path.join(root, requirementDesignPath(id));
  await writeFile(file, "{broken"); await expect(readWorkspaceDesign(root, id)).rejects.toThrow("不是有效 JSON");
  await writeFile(file, JSON.stringify({ ...document, content: "a".repeat(16001) })); await expect(readWorkspaceDesign(root, id)).rejects.toThrow("字段无效");
  await writeFile(file, " ".repeat(512 * 1024 + 1)); await expect(readWorkspaceDesign(root, id)).rejects.toThrow("超过 512 KiB");
});

it.skipIf(process.platform === "win32")("refuses directory and document symlinks without overwriting their targets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "qingzhou-design-links-")); const external = path.join(root, "external"); const repository = path.join(root, "repo");
  await mkdir(external); await mkdir(repository); await symlink(external, path.join(repository, "docs"));
  const id = randomUUID(); const document = { schemaVersion: 1 as const, prdId: randomUUID(), content: "设计", moduleChanges: [] };
  await expect(writeWorkspaceDesign(repository, id, document)).rejects.toThrow("包含链接");
  expect(await readdir(external)).toEqual([]);
  const other = path.join(root, "safe"); await mkdir(other); await writeWorkspaceDesign(other, id, document);
  const target = path.join(external, "document.json"); await writeFile(target, JSON.stringify(document));
  const linkId = randomUUID(); await symlink(target, path.join(other, requirementDesignPath(linkId)));
  await expect(readWorkspaceDesign(other, linkId)).rejects.toThrow("不能是符号链接");
  expect(JSON.parse(await readFile(target, "utf8"))).toEqual(document);
});
