import { constants } from "node:fs";
import { copyFile, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { workflowStateSchema, type WorkflowState, type ScopeRevision, type WorkItem } from "@qingzhou/protocol";
import { CoalescedJsonFile } from "./coalesced-json-file.js";
import type { WorkItemStore } from "./work-item-store.js";

export class WorkflowStore {
  state: WorkflowState = {
    schemaVersion: 1, configs: [], scopes: [], workspaces: [], dependencies: {},
    tickets: [], deliveries: [], acceptances: [], verifications: [], integrations: [], events: [],
  };
  private readonly file: CoalescedJsonFile<WorkflowState>;
  constructor(private readonly dataDir: string) {
    this.file = new CoalescedJsonFile(path.join(dataDir, "workflow.json"), () => this.state, { debounceMs: 0, fsync: true });
  }
  async load(items: WorkItemStore): Promise<void> {
    try {
      this.state = workflowStateSchema.parse(JSON.parse(await readFile(path.join(this.dataDir, "workflow.json"), "utf8")));
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
