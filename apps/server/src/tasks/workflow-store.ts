import { constants } from "node:fs";
import { copyFile, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { workflowStateSchema, type WorkflowState, type ScopeRevision, type WorkItem } from "@qingzhou/protocol";
import { CoalescedJsonFile } from "./coalesced-json-file.js";
import type { WorkItemStore } from "./work-item-store.js";
import { createHash } from "node:crypto";
import { readWorkspaceText } from "./workspace-files.js";

export class WorkflowStore {
  state: WorkflowState = {
    schemaVersion: 1, configs: [], scopes: [], workspaces: [], dependencies: {},
    tickets: [], deliveries: [], acceptances: [], verifications: [], integrations: [], events: [],
  };
  private readonly file: CoalescedJsonFile<unknown>;
  constructor(private readonly dataDir: string) {
    this.file = new CoalescedJsonFile(path.join(dataDir, "workflow.json"), () => {
      // Runtime content is hydrated from immutable Markdown; no second editable JSON body.
      const metadata = <T extends { content: string; document?: unknown; documentError?: string }>(record: T) => {
        if (!record.document) return record;
        const { content: _content, documentError: _error, ...fields } = record;
        return fields;
      };
      return {
        ...this.state,
        prds: this.state.prds?.map((prd) => ({ ...metadata(prd), moduleChanges: prd.moduleChanges.map(metadata) })),
        moduleRevisions: this.state.moduleRevisions?.map(metadata),
      };
    }, { debounceMs: 0, fsync: true });
  }
  async load(items: WorkItemStore): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(path.join(this.dataDir, "workflow.json"), "utf8"));
      const hydrate = async (record: { content?: string; document?: { revisionPath: string; hash: string }; documentError?: string }, repository?: string) => {
        if (!record.document) return;
        try {
          if (!repository) throw new Error("找不到文档所属项目");
          const content = await readWorkspaceText(repository, record.document.revisionPath);
          if (content === null || createHash("sha256").update(content).digest("hex") !== record.document.hash) throw new Error(`历史文档缺失或被修改：${record.document.revisionPath}`);
          record.content = content;
        } catch (error) { record.content = "[文档不可用，请恢复对应 Markdown 文件]"; record.documentError = error instanceof Error ? error.message : "读取文档失败"; }
      };
      for (const prd of raw.prds ?? []) {
        const repository = items.getProject(items.get(prd.itemId)?.projectId ?? "")?.cwd;
        await hydrate(prd, repository);
        for (const change of prd.moduleChanges ?? []) { await hydrate(change, repository); if (change.documentError) prd.documentError = change.documentError; }
      }
      for (const revision of raw.moduleRevisions ?? []) await hydrate(revision, items.getProject(raw.modules?.find((entry: { id: string }) => entry.id === revision.moduleId)?.projectId ?? "")?.cwd);
      this.state = workflowStateSchema.parse(raw);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      try {
        await copyFile(path.join(this.dataDir, "work-items.json"), path.join(this.dataDir, "work-items.pre-workflow.backup.json"), constants.COPYFILE_EXCL);
      } catch (backupError) {
        if (!["ENOENT", "EEXIST"].includes((backupError as NodeJS.ErrnoException).code ?? "")) throw backupError;
      }
    }
    for (const item of items.list()) {
      const hasHistory = this.state.events.some((event) => event.itemId === item.id);
      this.scope(item);
      if (!hasHistory) {
        this.event(item.projectId, item.id, "requirement.imported", null,
          item.runCount ? "保留原需求与对话；历史执行结束不代表验证通过，合入状态未知。" : "建立需求范围版本。");
      }
    }
    // Restart never reruns side effects. Queued work also requires an explicit restart.
    for (const cycle of this.state.cycles ?? []) if (["running", "verifying"].includes(cycle.status)) {
      cycle.status = "interrupted"; cycle.error = "应用重启，自动轮次已中断；检查现场后可重新启动。";
    }
    for (const ticket of this.state.tickets) {
      if (ticket.status === "running" || ticket.status === "queued") {
        ticket.status = "interrupted";
        ticket.error = "应用重启，执行已中断；请检查工作区后继续。";
        this.event(ticket.projectId, ticket.itemId, "run.interrupted", ticket.id, ticket.error);
      }
    }
    for (const verification of this.state.verifications) {
      if (!["running", "queued"].includes(verification.status)) continue;
      verification.status = "interrupted";
      verification.finishedAt = new Date().toISOString();
      verification.error = "验证中断，未自动重放命令。";
      for (const check of verification.checks) if (check.status === "running") check.status = "interrupted";
      this.event(verification.projectId, verification.itemId, "verification.interrupted", verification.id, verification.error);
    }
    await this.save();
  }
  scope(item: WorkItem): ScopeRevision {
    const previous = this.state.scopes.filter((scope) => scope.itemId === item.id).at(-1);
    if (previous && previous.title === item.title && previous.description === item.description && previous.acceptanceCriteria === item.acceptanceCriteria) return previous;
    const next: ScopeRevision = {
      id: randomUUID(), itemId: item.id, version: (previous?.version ?? 0) + 1,
      title: item.title, description: item.description, acceptanceCriteria: item.acceptanceCriteria,
      createdAt: new Date().toISOString(),
    };
    this.state.scopes.push(next);
    this.event(item.projectId, item.id, previous ? "scope.revised" : "requirement.created", next.id, `需求范围 v${next.version}`);
    return next;
  }
  event(projectId: string, itemId: string | null, type: string, subjectId: string | null, message: string): void {
    const integration = this.state.integrations.find((entry) => entry.id === subjectId);
    const ticket = this.state.tickets.find((entry) => entry.id === subjectId);
    this.state.events.push({ id: randomUUID(), sequence: (this.state.events.at(-1)?.sequence ?? 0) + 1,
      projectId, itemId, type, subjectId, message, createdAt: new Date().toISOString(),
      facts: { integration: integration ? structuredClone(integration) : undefined, ticket: ticket ? structuredClone(ticket) : undefined } });
  }
  async save(): Promise<void> { await this.file.flush(); }
  async flush(): Promise<void> { await this.file.flushNow({ fsync: true }); }
}
