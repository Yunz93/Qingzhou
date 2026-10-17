import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { requirementFiles, type RequirementPrd } from "@qingzhou/protocol";
import { readDesignMarkdown } from "../../apps/server/src/tasks/workflow-design-docs";

async function fixture() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "qingzhou-markdown-")), itemId = randomUUID(), moduleId = randomUUID();
  const base: RequirementPrd = { id: randomUUID(), itemId, scopeId: randomUUID(), version: 1, previousId: null, content: "初始方案", reason: "首次", moduleChanges: [{ moduleId, baseRevisionId: randomUUID(), content: "初始模块设计" }], createdAt: new Date().toISOString(), confirmedAt: null, frozenAt: null, deliveryId: null };
  const files = requirementFiles(itemId); await mkdir(path.join(cwd, files.directory, "modules"), { recursive: true });
  const document = { schemaVersion: 1 as const, prdId: base.id, content: base.content, moduleChanges: structuredClone(base.moduleChanges) };
  return { cwd, itemId, moduleId, base, files, document };
}
it("reads Markdown-only PRD and module changes without changing confirmation metadata", async () => {
  const f = await fixture();
  await writeFile(path.join(f.cwd, f.files.prd), "Markdown 调整方案"); await writeFile(path.join(f.cwd, f.files.module(f.moduleId)), "Markdown 模块新设计");
  const result = await readDesignMarkdown(f.cwd, f.itemId, f.document, f.base);
  expect(result).toMatchObject({ prdId: f.base.id, content: "Markdown 调整方案", moduleChanges: [{ moduleId: f.moduleId, baseRevisionId: f.base.moduleChanges[0]!.baseRevisionId, content: "Markdown 模块新设计" }] });
  expect(f.base.content).toBe("初始方案");
});
it("allows legacy JSON-only edits and identical dual edits but rejects divergent edits", async () => {
  const f = await fixture(); f.document.content = "JSON 新方案";
  expect((await readDesignMarkdown(f.cwd, f.itemId, f.document, f.base)).content).toBe("JSON 新方案");
  await writeFile(path.join(f.cwd, f.files.prd), "JSON 新方案");
  expect((await readDesignMarkdown(f.cwd, f.itemId, f.document, f.base)).content).toBe("JSON 新方案");
  await writeFile(path.join(f.cwd, f.files.prd), "另一个 Markdown 方案");
  await expect(readDesignMarkdown(f.cwd, f.itemId, f.document, f.base)).rejects.toThrow("JSON 与 Markdown 有不同修改");
});
it("does not discard a Markdown proposal when JSON removes that module", async () => {
  const f = await fixture(); f.document.moduleChanges = [];
  await writeFile(path.join(f.cwd, f.files.module(f.moduleId)), "未同步的模块变更");
  await expect(readDesignMarkdown(f.cwd, f.itemId, f.document, f.base)).rejects.toThrow("已移除的模块仍有 Markdown 修改");
});
it("does not silently reuse an old Markdown file when JSON introduces a module without a shared base", async () => {
  const f = await fixture(); f.base.moduleChanges = [];
  f.document.moduleChanges[0]!.content = "新关联的模块设计";
  await writeFile(path.join(f.cwd, f.files.module(f.moduleId)), "历史残留提案");
  await expect(readDesignMarkdown(f.cwd, f.itemId, f.document, f.base)).rejects.toThrow("无共同依据");
});
