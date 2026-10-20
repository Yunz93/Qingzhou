import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, open, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_DOCUMENT_PATHS, documentPathsSchema, documentSourceSchema, projectStandardManifestSchema, requirementFiles, type DocumentInspection, type DocumentPaths, type DocumentSource, type RequirementPrd, type DesignModule, type ModuleRevision } from "@qingzhou/protocol";
import type { WorkflowStore } from "./workflow-store.js";
import type { WorkItemStore } from "./work-item-store.js";
import { readWorkspaceText, writeWorkspaceText } from "./workspace-files.js";
import { workflowGit as git } from "./workflow-git.js";
import { moduleDocument } from "./workflow-module-docs.js";

export const documentHash = (text: string) => createHash("sha256").update(text).digest("hex");
const manifestPath = "docs/qingzhou/project.json";
const namePart = (name: string, id: string) => `${Array.from(name, (character) => character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character) ? "-" : character).join("").replace(/^\.+|\.+$/g, "").trim().slice(0, 48) || "document"}-${id}`;
type Write = { path: string; content: string; immutable?: boolean; allowChanged?: boolean };
type Journal = { projectId: string; repository: string; files: Array<Write & { previous: string | null }> };

/** Editable Markdown lives in the project; application state holds immutable revision bindings. */
export class ProjectDocuments {
  constructor(private readonly store: WorkflowStore, private readonly items: WorkItemStore, private readonly dataDir: string) {}
  repository(projectId: string) {
    const repository = this.items.getProject(projectId)?.cwd;
    if (!repository) throw new Error("找不到文档所属项目");
    return repository;
  }
  async paths(projectId: string): Promise<DocumentPaths> {
    const text = await readWorkspaceText(this.repository(projectId), manifestPath);
    if (text === null) return { ...DEFAULT_DOCUMENT_PATHS };
    let manifest: unknown;
    try { manifest = JSON.parse(text); } catch { throw new Error("项目文档配置不是有效 JSON，请检查 docs/qingzhou/project.json"); }
    const result = projectStandardManifestSchema.safeParse(manifest);
    if (!result.success) throw new Error("项目文档配置无效，请检查 docs/qingzhou/project.json");
    return result.data.documentPaths ?? { ...DEFAULT_DOCUMENT_PATHS };
  }
  prdPath(prd: RequirementPrd, title: string, paths: DocumentPaths): string {
    return this.store.state.prds?.find((entry) => entry.itemId === prd.itemId && entry.document)?.document?.path
      ?? `${paths.prds}/${namePart(title, prd.itemId)}/PRD.md`;
  }
  private source(file: string, revisionPath: string, content: string): DocumentSource { return documentSourceSchema.parse({ path: file, revisionPath, hash: documentHash(content) }); }
  async persistPrd(prd: RequirementPrd, allowChanged = false, current = true): Promise<string> {
    const item = this.items.get(prd.itemId)!; const paths = await this.paths(item.projectId);
    const file = this.prdPath(prd, item.title, paths); const directory = path.posix.dirname(file);
    const document = this.source(file, `${directory}/.versions/${prd.id}.md`, prd.content);
    const proposals = prd.moduleChanges.map((change) => {
      const proposal = `${directory}/modules/${change.moduleId}.md`;
      return { change, document: this.source(proposal, `${directory}/.versions/${prd.id}-${change.moduleId}.md`, change.content) };
    });
    const writes: Write[] = [...(current ? [{ path: file, content: prd.content, allowChanged }] : []), { path: document.revisionPath, content: prd.content, immutable: true }];
    for (const { change, document } of proposals) {
      writes.push(...(current ? [{ path: document.path, content: change.content, allowChanged }] : []), { path: document.revisionPath, content: change.content, immutable: true });
    }
    const journal = await this.write(item.projectId, writes);
    prd.document = document;
    for (const proposal of proposals) proposal.change.document = proposal.document;
    return journal;
  }
  async persistModule(module: DesignModule, revision: ModuleRevision, current = true): Promise<string> {
    const paths = await this.paths(module.projectId);
    const initial = !this.store.state.moduleRevisions?.some((entry) => entry.moduleId === module.id);
    const file = initial ? `${paths.modules}/${namePart(module.name, module.id)}.md` : module.documentPath ?? `${paths.modules}/${namePart(module.name, module.id)}.md`;
    const format = initial ? "markdown" : module.documentFormat;
    const document = this.source(file, `${path.posix.dirname(file)}/.versions/${module.id}/${revision.id}.md`, revision.content);
    const prd = this.store.state.prds?.find((entry) => entry.id === revision.sourcePrdId);
    const content = format !== "markdown" && prd ? moduleDocument(module, prd, revision.content) : revision.content;
    const journal = await this.write(module.projectId, [
      ...(current ? [{ path: file, content }] : []),
      { path: document.revisionPath, content: revision.content, immutable: true },
    ]);
    module.documentPath = file;
    if (initial) module.documentFormat = "markdown";
    revision.document = document;
    return journal;
  }
  async write(projectId: string, writes: Write[]): Promise<string> {
    const repository = this.repository(projectId);
    const files: Journal["files"] = [];
    for (const entry of writes) {
      const previous = await readWorkspaceText(repository, entry.path);
      const owned = this.store.state.documentFiles?.find((file) => file.projectId === projectId && file.path === entry.path);
      if (previous !== null && previous !== entry.content && (entry.immutable || (!entry.allowChanged && (!owned || documentHash(previous) !== owned.hash)))) throw new Error(`文档有外部修改或目标已占用，请先合并：${entry.path}`);
      files.push({ ...entry, previous });
    }
    const journal = `document-journals/${randomUUID()}.json`;
    await writeWorkspaceText(this.dataDir, journal, JSON.stringify({ projectId, repository, files } satisfies Journal));
    try {
      for (const entry of files) if (entry.previous !== entry.content) await writeWorkspaceText(repository, entry.path, entry.content, true);
    } catch (error) { await this.rollback({ projectId, repository, files }); await this.complete(journal); throw error; }
    for (const entry of files) this.record(projectId, entry.path, entry.content);
    return journal;
  }
  record(projectId: string, file: string, content: string) {
    const files = this.store.state.documentFiles ??= [];
    const existing = files.find((entry) => entry.projectId === projectId && entry.path === file);
    if (existing) existing.hash = documentHash(content); else files.push({ projectId, path: file, hash: documentHash(content) });
  }
  async complete(journal: string) { await unlink(path.join(this.dataDir, journal)).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; }); }
  private async rollback(journal: Journal) {
    for (const entry of journal.files.slice().reverse()) {
      const current = await readWorkspaceText(journal.repository, entry.path);
      if (current !== entry.content || entry.previous === current) continue;
      if (entry.previous === null) await unlink(path.join(journal.repository, entry.path));
      else await writeWorkspaceText(journal.repository, entry.path, entry.previous, true);
    }
  }
  async recover() {
    await mkdir(path.join(this.dataDir, "document-journals"), { recursive: true });
    for (const name of await readdir(path.join(this.dataDir, "document-journals"))) {
      if (!name.endsWith(".json")) continue;
      const file = `document-journals/${name}`;
      const journal = JSON.parse((await readWorkspaceText(this.dataDir, file, 8 * 1024 * 1024))!) as Journal;
      if (journal.repository !== this.repository(journal.projectId)) throw new Error("文档恢复记录的项目路径已变化，请检查现场");
      const committed = journal.files.every((entry) => this.store.state.documentFiles?.some((record) => record.projectId === journal.projectId && record.path === entry.path && record.hash === documentHash(entry.content)));
      if (!committed) await this.rollback(journal);
      await this.complete(file);
    }
  }
  async configure(projectId: string, input: DocumentPaths): Promise<string> {
    const paths = documentPathsSchema.parse(input); const repository = this.repository(projectId);
    // Validate directory components using the same no-link boundary as document writes.
    for (const directory of [paths.prds, paths.modules]) await readWorkspaceText(repository, `${directory}/.qingzhou-path-check`);
    const old = await readWorkspaceText(repository, manifestPath);
    const { projectStandardFiles } = await import("./project-standard.js");
    const initial = projectStandardFiles(this.items.getProject(projectId)!.name).find((file) => file.path === manifestPath)!.content;
    const manifest = JSON.parse(old ?? initial);
    projectStandardManifestSchema.parse({ ...manifest, documentPaths: undefined });
    return this.write(projectId, [{ path: manifestPath, content: `${JSON.stringify({ ...manifest, documentPaths: paths }, null, 2)}\n`, allowChanged: true }]);
  }
  async inspect(projectId: string): Promise<DocumentInspection> {
    const paths = await this.paths(projectId); const files: DocumentInspection["files"] = [];
    const repository = this.repository(projectId);
    const inspect = async (file: string, content: string, source: string) => {
      const existing = await readWorkspaceText(repository, file);
      files.push({ source, path: file, status: existing === null ? "ready" : existing === content ? "present" : "conflict" });
    };
    for (const prd of this.store.state.prds ?? []) {
      const item = this.items.get(prd.itemId); if (item?.projectId !== projectId || prd.document) continue;
      const file = this.prdPath(prd, item.title, paths);
      await inspect(`${path.posix.dirname(file)}/.versions/${prd.id}.md`, prd.content, `${item.title} · PRD v${prd.version}`);
      const current = this.store.state.plans?.find((entry) => entry.itemId === item.id)?.currentPrdId === prd.id;
      if (current) {
        await inspect(file, prd.content, `${item.title} · 当前 PRD`);
        const oldPath = requirementFiles(item.id).prd;
        const old = await readWorkspaceText(repository, oldPath);
        if (old !== null && !this.store.state.prds?.some((entry) => entry.itemId === item.id && entry.content === old)) files.push({ source: `${item.title} · 原 Markdown 有未同步修改`, path: oldPath, status: "conflict" });
      }
      for (const change of prd.moduleChanges) {
        await inspect(`${path.posix.dirname(file)}/.versions/${prd.id}-${change.moduleId}.md`, change.content, `${item.title} · 模块提案 v${prd.version}`);
        if (current) await inspect(`${path.posix.dirname(file)}/modules/${change.moduleId}.md`, change.content, `${item.title} · 当前模块提案`);
      }
    }
    for (const revision of this.store.state.moduleRevisions ?? []) {
      const module = this.store.state.modules?.find((entry) => entry.id === revision.moduleId);
      if (module?.projectId !== projectId || revision.document) continue;
      const file = module.documentPath ?? `${paths.modules}/${namePart(module.name, module.id)}.md`;
      await inspect(`${path.posix.dirname(file)}/.versions/${module.id}/${revision.id}.md`, revision.content, `${module.name} · v${revision.version}`);
      const latestMain = this.store.state.moduleRevisions?.filter((entry) => entry.moduleId === module.id && (!entry.sourcePrdId || entry.integrationId)).at(-1);
      const prd = this.store.state.prds?.find((entry) => entry.id === revision.sourcePrdId);
      if (latestMain?.id === revision.id) await inspect(file, module.documentFormat !== "markdown" && prd ? moduleDocument(module, prd, revision.content) : revision.content, `${module.name} · 当前主线设计`);
    }
    return { paths, files };
  }
  async importLegacy(projectId: string): Promise<void> {
    const inspection = await this.inspect(projectId);
    if (inspection.files.some((file) => file.status === "conflict")) throw new Error("目标文档有不同内容，请先合并冲突后导入");
    await copyFile(path.join(this.dataDir, "workflow.json"), path.join(this.dataDir, `workflow.pre-documents-${randomUUID()}.json`));
    // Import old immutable versions without changing their IDs or confirmation facts.
    for (const prd of this.store.state.prds ?? []) {
      const item = this.items.get(prd.itemId); if (item?.projectId !== projectId || prd.document) continue;
      const current = this.store.state.plans?.find((entry) => entry.itemId === item.id)?.currentPrdId === prd.id;
      const journal = await this.persistPrd(prd, false, current);
      prd.document!.workspacePath = requirementFiles(item.id).prd;
      await this.store.save(); await this.complete(journal);
    }
    for (const revision of this.store.state.moduleRevisions ?? []) {
      const module = this.store.state.modules?.find((entry) => entry.id === revision.moduleId);
      if (module?.projectId !== projectId || revision.document) continue;
      const latestMain = this.store.state.moduleRevisions?.filter((entry) => entry.moduleId === module.id && (!entry.sourcePrdId || entry.integrationId)).at(-1);
      const journal = await this.persistModule(module, revision, latestMain?.id === revision.id);
      await this.store.save(); await this.complete(journal);
    }
  }
  async copyPrd(cwd: string, prd: RequirementPrd) {
    if (!prd.document) return;
    const projectId = this.items.get(prd.itemId)!.projectId; const repository = this.repository(projectId);
    for (const version of this.store.state.prds?.filter((entry) => entry.itemId === prd.itemId) ?? []) {
      for (const source of [version.document, ...version.moduleChanges.map((change) => change.document)]) if (source) {
        const content = await readWorkspaceText(repository, source.revisionPath);
        if (content === null || documentHash(content) !== source.hash) throw new Error(`历史文档缺失或被修改：${source.revisionPath}`);
        await writeWorkspaceText(cwd, source.revisionPath, content, true);
      }
    }
    const manifest = await readWorkspaceText(repository, manifestPath);
    if (manifest) await writeWorkspaceText(cwd, manifestPath, manifest, true);
    for (const module of this.store.state.modules?.filter((entry) => entry.projectId === projectId) ?? []) {
      for (const revision of this.store.state.moduleRevisions?.filter((entry) => entry.moduleId === module.id) ?? []) if (revision.document) {
        const content = await readWorkspaceText(repository, revision.document.revisionPath);
        if (content === null || documentHash(content) !== revision.document.hash) throw new Error("模块历史文档缺失或被修改");
        await writeWorkspaceText(cwd, revision.document.revisionPath, content, true);
      }
    }
  }
  async ownedChanges(projectId: string, files: string[]): Promise<string[]> {
    const repository = this.repository(projectId); const owned: string[] = [];
    for (const file of files) {
      const record = this.store.state.documentFiles?.find((entry) => entry.projectId === projectId && entry.path === file);
      const content = record && await readWorkspaceText(repository, file);
      if (record && content !== null && content !== undefined && documentHash(content) === record.hash) owned.push(file);
    }
    return owned;
  }
  async hydrateCurrent(prd: RequirementPrd): Promise<string> {
    if (!prd.document) return prd.content;
    const content = await readWorkspaceText(this.repository(this.items.get(prd.itemId)!.projectId), prd.document.path);
    if (content === null) throw new Error(`PRD 文件缺失：${prd.document.path}`);
    return content;
  }
  async assertOtherSnapshots(projectId: string, itemId: string, cwd: string, baseline: string, commit?: string) {
    const directories = new Set((this.store.state.prds ?? []).filter((prd) => prd.itemId !== itemId && this.items.get(prd.itemId)?.projectId === projectId)
      .map((prd) => requirementFiles(prd.itemId, prd.document?.workspacePath ?? prd.document?.path).directory));
    if (!directories.size) return;
    const changed = (await git(cwd, ["diff", "--name-only", "-z", baseline, ...(commit ? [commit] : []), "--", ...directories])).split("\0").filter(Boolean);
    const added = commit ? [] : (await git(cwd, ["ls-files", "--others", "--exclude-standard", "-z", "--", ...directories])).split("\0").filter(Boolean);
    if (changed.length || added.length) throw new Error("交付或候选修改了其他需求的设计快照，请恢复原始设计");
  }
  async assertImmutable(projectId: string, cwd: string, baseline: string, commit?: string) {
    const sources: Array<{ document: DocumentSource; content: string }> = [];
    for (const prd of this.store.state.prds ?? []) if (this.items.get(prd.itemId)?.projectId === projectId) {
      if (prd.document) sources.push({ document: prd.document, content: prd.content });
      for (const change of prd.moduleChanges) if (change.document) sources.push({ document: change.document, content: change.content });
    }
    for (const revision of this.store.state.moduleRevisions ?? []) {
      if (revision.document && this.store.state.modules?.some((module) => module.id === revision.moduleId && module.projectId === projectId)) sources.push({ document: revision.document, content: revision.content });
    }
    for (const { document, content } of sources) {
      const file = document.revisionPath;
      const before = await git(cwd, ["ls-tree", baseline, "--", file]);
      if (commit) {
        const entry = await git(cwd, ["ls-tree", commit, "--", file]);
        if (!entry && !before) continue; // A newer revision may have been saved after this workspace started.
        const expected = await git(cwd, ["hash-object", "--stdin"], content);
        if (!/^(100644|100755) blob /.test(entry) || entry.split("\t")[0]?.split(" ")[2] !== expected || documentHash(content) !== document.hash) throw new Error(`历史文档不可变：${file}`);
      } else {
        const actual = await readWorkspaceText(cwd, file);
        if (actual === null && !before) continue;
        if (actual === null || documentHash(actual) !== document.hash) throw new Error(`历史文档缺失或被修改：${file}`);
      }
    }
  }
  async assertCurrent(prd?: RequirementPrd) {
    if (!prd) throw new Error("请先建立 PRD");
    if (prd.documentError) throw new Error(prd.documentError);
    const repository = this.repository(this.items.get(prd.itemId)!.projectId);
    for (const source of [prd.document, ...prd.moduleChanges.map((change) => change.document)]) {
      if (!source) continue;
      const content = await readWorkspaceText(repository, source.path);
      if (content === null || documentHash(content) !== source.hash) throw new Error(`文档有外部修改或已缺失，请先同步文件修改：${source.path}`);
    }
  }
  /** Prepare in a private index, then publish only if the real index is byte-for-byte unchanged. */
  private async updateIndex<T>(repository: string, operation: (index: string) => Promise<T>): Promise<T> {
    const index = await git(repository, ["rev-parse", "--path-format=absolute", "--git-path", "index"]);
    const previous = await readFile(index);
    const temporary = path.join(this.dataDir, `merge-index-${randomUUID()}.index`);
    await writeFile(temporary, previous, { flag: "wx" });
    let locked = false;
    try {
      const result = await operation(temporary);
      const lock = await open(`${index}.lock`, "wx").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "EEXIST") throw new Error("Git 索引正被其他操作使用，保留暂存内容，请稍后重试");
        throw error;
      });
      locked = true;
      try {
        if (!(await readFile(index)).equals(previous)) throw new Error("索引被外部修改，保留暂存内容，请先核对后重试");
        await lock.writeFile(await readFile(temporary));
        await lock.sync();
      } finally { await lock.close(); }
      await rename(`${index}.lock`, index);
      locked = false;
      return result;
    } finally {
      if (locked) await unlink(`${index}.lock`);
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
    }
  }
  async stageOwnedForMerge(projectId: string, candidate: string, files: string[], id: string, baseline: string, transitions: Record<string, { from: string; to: string }> = {}) {
    const repository = this.repository(projectId);
    return this.updateIndex(repository, async (index) => {
      const staged = await git(repository, ["diff", "--cached", "--name-only", baseline], undefined, index);
      if (staged) throw new Error("原项目有人工暂存内容，未更改索引；请先处理后合入");
      const owned = await this.ownedChanges(projectId, files);
      if (owned.length !== files.length) throw new Error(`原项目有未提交改动或外部修改：${files.filter((file) => !owned.includes(file)).join("、")}`);
      const included: string[] = [];
      const blobs: Record<string, string> = {};
      const entries: Record<string, string> = {};
      for (const file of owned) {
        const candidateEntry = await git(repository, ["ls-tree", candidate, "--", file]);
        if (candidateEntry === await git(repository, ["ls-tree", baseline, "--", file])) continue;
        const inCandidate = await git(repository, ["show", `${candidate}:${file}`]).catch(() => null);
        if (inCandidate === null) continue;
        const actual = await git(repository, ["hash-object", "--", file]);
        const expected = await git(repository, ["rev-parse", `${candidate}:${file}`]);
        if (actual !== expected) {
          const transition = transitions[file];
          const content = await readWorkspaceText(repository, file);
          if (!transition || content !== transition.from || expected !== await git(repository, ["hash-object", "--stdin"], transition.to)) throw new Error(`候选与项目文档有不同修改，请先同步：${file}`);
        }
        included.push(file); blobs[file] = actual;
        const mode = candidateEntry.split(" ")[0];
        if (mode !== "100644" && mode !== "100755") throw new Error(`文档必须是普通文件：${file}`);
        entries[file] = `${mode} blob ${actual}`;
      }
      await writeWorkspaceText(this.dataDir, `merge-documents/${id}.json`, JSON.stringify({ projectId, candidate, baseline, included, blobs, entries }), true);
      if (included.length) await git(repository, ["add", "--", ...included], undefined, index);
      const tree = await git(repository, ["write-tree"], undefined, index);
      const changed = (await git(repository, ["diff-tree", "-r", "--name-only", "-z", baseline, tree])).split("\0").filter(Boolean);
      for (const file of changed) {
        if (!included.includes(file) || await git(repository, ["ls-tree", tree, "--", file]).then((entry) => entry.split("\t")[0]) !== entries[file]) throw new Error("索引被外部修改，保留暂存内容，请先核对后重试");
      }
      return { included, tree };
    });
  }
  async reconcileMerge(id: string, projectId: string, candidate: string, baseline: string, committed: boolean): Promise<string | undefined> {
    const text = await readWorkspaceText(this.dataDir, `merge-documents/${id}.json`);
    if (!text) return;
    const journal = JSON.parse(text) as { projectId: string; candidate: string; baseline: string; included: string[]; blobs?: Record<string, string>; entries?: Record<string, string> };
    if (journal.projectId !== projectId || journal.candidate !== candidate || journal.baseline !== baseline) throw new Error("合入文档恢复记录与候选不一致，未修改索引");
    const repository = this.repository(projectId);
    const tree = await this.updateIndex(repository, async (index) => {
      const staged = (await git(repository, ["diff", "--cached", "--name-only", "-z", baseline], undefined, index)).split("\0").filter(Boolean);
      // Recovery validates the private snapshot and CAS-publishes it under Git's index lock too.
      for (const file of staged) {
        const expected = journal.blobs?.[file] ?? await git(repository, ["rev-parse", `${candidate}:${file}`]).catch(() => "");
        const actual = await git(repository, ["rev-parse", `:${file}`], undefined, index);
        const entry = await git(repository, ["ls-files", "--stage", "--", file], undefined, index);
        if (!journal.included.includes(file) || actual !== expected || (journal.entries?.[file] && entry.split("\t")[0] !== `${journal.entries[file].replace(" blob ", " ")} 0`)) throw new Error("合入中断后索引被外部修改，保留现场，请先核对暂存内容");
      }
      if (!committed && staged.length) await git(repository, ["restore", "--staged", `--source=${baseline}`, "--", ...staged], undefined, index);
      return git(repository, ["write-tree"], undefined, index);
    });
    if (!committed) await this.complete(`merge-documents/${id}.json`);
    return committed ? tree : undefined;
  }
  async completeMerge(id: string) { await this.complete(`merge-documents/${id}.json`); }
}
