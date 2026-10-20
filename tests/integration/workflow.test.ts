import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as gitModule from "../../apps/server/src/tasks/workflow-git.ts";
import * as workspaceFiles from "../../apps/server/src/tasks/workspace-files.ts";
import { clientCommandSchema, requirementDesignPath, requirementFiles, verificationIsValid, type WorkItem, type WorkflowCheck } from "@qingzhou/protocol";
import { WorkItemStore } from "../../apps/server/src/tasks/work-item-store.ts";
import { WorkflowService } from "../../apps/server/src/tasks/workflow-service.ts";
import { workflowGit as git } from "../../apps/server/src/tasks/workflow-git.ts";
import { moduleDocument } from "../../apps/server/src/tasks/workflow-module-docs.ts";

const services: WorkflowService[] = [];
afterEach(async () => { for (const service of services.splice(0)) { service.dispose(); await service.idle(); await service.flush(); } });
const base = Array.from({ length: 24 }, (_, index) => `line ${index}`).join("\n") + "\n";
const defaultChecks: WorkflowCheck[] = [{ id: "regression", name: "回归", command: `node -e "process.exit(0)"`, required: true, timeoutMs: 10000, resource: "" }];

async function fixture(concurrency = 2, checks = defaultChecks) {
  const root = await mkdtemp(path.join(os.tmpdir(), "qingzhou-workflow-"));
  const repository = path.join(root, "repo"); const dataDir = path.join(root, "data");
  await mkdir(repository); await mkdir(dataDir);
  await git(repository, ["init", "-b", "develop"]);
  await writeFile(path.join(repository, "shared.txt"), base);
  await git(repository, ["add", "."]); await git(repository, ["commit", "-m", "initial"]);
  const baseline = await git(repository, ["rev-parse", "HEAD"]);
  const items = new WorkItemStore(dataDir); await items.load();
  const project = await items.createProject({ name: "project", cwd: repository });
  const launched: Array<{ id: string; cwd: string; taskId: string; runId: string }> = [];
  const createService = () => {
    const service = new WorkflowService({ dataDir, items, emit: () => {}, launch: async (id, cwd, kind, instruction) => {
      const item = items.get(id)!;
      const taskId = item.taskId ?? randomUUID();
      const run = await items.createRun({ objectiveId: id, taskId, kind, instruction });
      await items.updateRun(run.id, { status: "running" });
      launched.push({ id, cwd, taskId, runId: run.id });
    } });
    services.push(service); return service;
  };
  const service = createService(); await service.ready;
  const command = async (type: string, payload: object, id = randomUUID()) => service.handle(clientCommandSchema.parse({ id, operationId: randomUUID(), type, payload }));
  await command("workflow.configure", { projectId: project.id, targetBranch: "develop", concurrency, checks });
  const create = async (title: string) => items.create({ title, description: `implement ${title}`, acceptanceCriteria: "结果可用", cwd: repository, projectId: project.id });
  const start = async (item: WorkItem) => { await service.enqueue(item.id, "initial"); await service.idle(); return launched.findLast((entry) => entry.id === item.id)!; };
  const finish = async (item: WorkItem) => {
    const launch = launched.findLast((entry) => entry.id === item.id)!;
    await items.updateRun(launch.runId, { status: "succeeded", resultSummary: "implemented" });
    await service.settled(item.id, true); await service.idle();
  };
  const deliver = async (item: WorkItem) => {
    const changes = await service.changes(item.id);
    const { delivery } = await service.seal(item.id, changes.paths, "交付", randomUUID()); await service.idle();
    return delivery;
  };
  const integrate = async (deliveryId: string) => {
    await service.accept(deliveryId, "accepted");
    const result = await service.integrate(deliveryId, randomUUID()); await service.idle();
    const attempt = service.store.state.integrations.find((entry) => entry.id === result.attempt.id)!;
    if (attempt.status === "ready") await review(attempt.id);
    return attempt;
  };
  const review = async (id: string) => service.reviewCandidate({ id, candidate: service.store.state.integrations.find((entry) => entry.id === id)!.candidate!, decision: "compatible", note: "逐项核对源交付、组合差异与回归，行为保持一致" });
  return { root, repository, dataDir, baseline, items, project, service, launched, createService, command, create, start, finish, deliver, integrate, review };
}

async function planned(f: Awaited<ReturnType<typeof fixture>>, item: WorkItem, moduleChanges: Array<{ moduleId: string; baseRevisionId: string | null; content: string }> = []) {
  await f.service.beginPlanning(item.id); const scope = f.service.store.scope(item);
  await f.command("workflow.scope.confirm", { id: item.id, scopeId: scope.id });
  const prd = f.service.design.save({ id: item.id, scopeId: scope.id, expectedPrdId: f.service.design.prd(item.id)?.id ?? null,
    content: `设计 ${item.title}`, reason: "设计确认", moduleChanges }).prd;
  await f.command("workflow.prd.confirm", { id: item.id, prdId: prd.id }); return prd;
}

describe("project requirement workflow with real Git", () => {
  it("isolates parallel requirements and supports B merging before A on a non-default branch", async () => {
    const f = await fixture();
    const a = await f.create("A"); const b = await f.create("B");
    const [wa, wb] = await Promise.all([f.start(a), f.start(b)]);
    expect(wa.cwd).not.toBe(wb.cwd);
    await writeFile(path.join(wa.cwd, "shared.txt"), base.replace("line 2\n", "A 2\n"));
    await writeFile(path.join(wb.cwd, "shared.txt"), base.replace("line 20\n", "B 20\n"));
    await f.finish(a); const da = await f.deliver(a);
    await f.finish(b); const db = await f.deliver(b);
    expect(await git(f.repository, ["rev-parse", "HEAD"])).toBe(f.baseline);
    const ib = await f.integrate(db.id); expect(ib.status).toBe("ready");
    await f.service.merge(ib.id);
    const ia = await f.integrate(da.id); expect(ia.baseline).toBe(ib.mergedCommit); expect(ia.status).toBe("ready");
    await f.service.merge(ia.id);
    const content = await readFile(path.join(f.repository, "shared.txt"), "utf8");
    expect(content).toContain("A 2"); expect(content).toContain("B 20");
    expect(await git(f.repository, ["status", "--porcelain"])).toBe("");
    expect((await f.service.state(f.project.id)).mainVerification?.status).toBe("passed");
    expect(f.service.store.state.events.filter((entry) => entry.type === "main.merged").map((entry) => entry.itemId)).toEqual([b.id, a.id]);
    expect(new Set(ia.includedItemIds)).toEqual(new Set([a.id, b.id]));
  });

  it("keeps conflicts in an integration workspace and freezes event-time history", async () => {
    const f = await fixture(); const a = await f.create("A"); const b = await f.create("B");
    const wa = await f.start(a); const wb = await f.start(b);
    await writeFile(path.join(wa.cwd, "shared.txt"), "A\n"); await writeFile(path.join(wb.cwd, "shared.txt"), "B\n");
    await f.finish(a); const da = await f.deliver(a); await f.finish(b); const db = await f.deliver(b);
    const ib = await f.integrate(db.id); await f.service.merge(ib.id);
    const ia = await f.integrate(da.id); expect(ia.status).toBe("conflicts"); expect(ia.conflicts).toEqual(["shared.txt"]);
    const event = f.service.store.state.events.find((entry) => entry.type === "integration.conflicts")!;
    await expect(f.service.enqueue(a.id, "feedback")).rejects.toThrow(/正在集成/);
    expect(await readFile(path.join(f.repository, "shared.txt"), "utf8")).toBe("B\n");
    await writeFile(path.join(ia.workspace!, "shared.txt"), "A and B\n"); await git(ia.workspace!, ["add", "shared.txt"]);
    await f.service.recheck(ia.id); await f.service.idle(); expect(ia.status).toBe("ready");
    await f.review(ia.id);
    expect(await git(wa.cwd, ["rev-parse", "HEAD"])).toBe(da.commit);
    await f.service.merge(ia.id);
    expect(await readFile(path.join(f.repository, "shared.txt"), "utf8")).toBe("A and B\n");
    expect(event.facts?.integration?.status).toBe("conflicts");
    expect(event.facts?.integration?.mergedCommit).toBeNull();
  });

  it("rejects behavioral conflicts even without textual conflicts", async () => {
    const check = `node -e "const f=require('fs');process.exit(f.existsSync('a.txt')&&f.existsSync('b.txt')?1:0)"`;
    const f = await fixture(2, [{ ...defaultChecks[0]!, command: check }]);
    const a = await f.create("A"); const b = await f.create("B");
    const wa = await f.start(a); const wb = await f.start(b);
    await writeFile(path.join(wa.cwd, "a.txt"), "A"); await writeFile(path.join(wb.cwd, "b.txt"), "B");
    await f.finish(a); const da = await f.deliver(a); await f.finish(b); const db = await f.deliver(b);
    const ib = await f.integrate(db.id); await f.service.merge(ib.id);
    const ia = await f.integrate(da.id); expect(ia.conflicts).toEqual([]); expect(ia.status).toBe("failed");
    expect(await git(f.repository, ["rev-parse", "HEAD"])).toBe(ib.mergedCommit);
    await expect(f.service.merge(ia.id)).rejects.toThrow(/尚未/);
  });

  it("blocks a verified candidate after an external main update", async () => {
    const f = await fixture(); const a = await f.create("A"); const wa = await f.start(a);
    await writeFile(path.join(wa.cwd, "a.txt"), "A"); await f.finish(a); const da = await f.deliver(a);
    const ia = await f.integrate(da.id);
    await writeFile(path.join(f.repository, "external.txt"), "external"); await git(f.repository, ["add", "."]); await git(f.repository, ["commit", "-m", "external"]);
    const external = await git(f.repository, ["rev-parse", "HEAD"]);
    await expect(f.service.merge(ia.id)).rejects.toThrow(/主线已变化/);
    expect(ia.status).toBe("stale"); expect(await git(f.repository, ["rev-parse", "HEAD"])).toBe(external);
    const replacement = await f.service.integrate(da.id, randomUUID()); await f.service.idle();
    expect(f.service.store.state.integrations.find((entry) => entry.id === replacement.attempt.id)?.baseline).toBe(external);
  });

  it("never copies, stages or clears changes in the original directory", async () => {
    const f = await fixture(); await writeFile(path.join(f.repository, "shared.txt"), "private local work\n");
    await writeFile(path.join(f.repository, ".env"), "TOKEN=private");
    const a = await f.create("A"); const wa = await f.start(a);
    expect(await readFile(path.join(wa.cwd, "shared.txt"), "utf8")).toBe(base);
    await expect(readFile(path.join(wa.cwd, ".env"))).rejects.toThrow();
    await writeFile(path.join(wa.cwd, "a.txt"), "A"); await f.finish(a); const da = await f.deliver(a);
    const ia = await f.integrate(da.id); await expect(f.service.merge(ia.id)).rejects.toThrow(/未提交改动/);
    expect(await readFile(path.join(f.repository, "shared.txt"), "utf8")).toBe("private local work\n");
    expect(await git(f.repository, ["rev-parse", "HEAD"])).toBe(f.baseline);
  });

  it("uses stable priority, project slots and merged prerequisites", async () => {
    const f = await fixture(1); const a = await f.create("A"); const b = await f.create("B"); const c = await f.create("C");
    await f.service.dependencies(b.id, [a.id]);
    await expect(f.service.dependencies(a.id, [b.id])).rejects.toThrow(/循环/);
    await f.service.enqueue(b.id, "initial"); await f.service.enqueue(a.id, "initial"); await f.service.enqueue(c.id, "initial"); await f.service.idle();
    expect(f.launched.map((entry) => entry.id)).toEqual([a.id]);
    await f.finish(a); expect(f.launched.map((entry) => entry.id)).toEqual([a.id, c.id]);
    expect(f.service.store.state.tickets.find((entry) => entry.itemId === b.id)?.status).toBe("queued");
    // Stop C to release the slot before A verification, without losing C's files.
    await f.items.updateRun(f.launched.at(-1)!.runId, { status: "aborted" }); await f.service.stop(c.id); await f.service.idle();
    const da = await f.deliver(a); const ia = await f.integrate(da.id); await f.service.merge(ia.id); await f.service.idle();
    expect(f.launched.at(-1)?.id).toBe(b.id);
    expect(f.items.list().map((entry) => entry.id)).toEqual([a.id, b.id, c.id]);
  });

  it("does not count an agent success or absent checks as proof", async () => {
    const f = await fixture(1, []); const a = await f.create("A"); await f.start(a); await f.finish(a);
    expect(f.service.store.state.deliveries).toHaveLength(0);
    const da = await f.deliver(a);
    expect(f.service.store.state.verifications.find((entry) => entry.id === da.verificationId)?.status).toBe("unverified");
    await expect(f.service.accept(da.id, "accepted")).rejects.toThrow(/必需检查/);
  });

  it("retains old acceptance but requires acceptance for a new delivery and scope", async () => {
    const f = await fixture(); const a = await f.create("A"); await f.start(a); await f.finish(a);
    const d1 = await f.deliver(a); await f.service.accept(d1.id, "accepted");
    await f.start(a); await f.finish(a); const d2 = await f.deliver(a);
    expect(f.service.store.state.acceptances[0]?.deliveryId).toBe(d1.id);
    await expect(f.service.integrate(d2.id, randomUUID())).rejects.toThrow(/先验收/);
    await f.service.accept(d2.id, "accepted");
    await f.items.update(a.id, { acceptanceCriteria: "new standard" }); await f.service.syncScope(f.items.get(a.id)!);
    await expect(f.service.integrate(d2.id, randomUUID())).rejects.toThrow(/范围已变化/);
    expect(f.service.store.state.scopes.filter((entry) => entry.itemId === a.id)).toHaveLength(2);
  });

  it("invalidates evidence when checks modify tracked code", async () => {
    const f = await fixture(1, [{ ...defaultChecks[0]!, command: `node -e "require('fs').writeFileSync('shared.txt','changed by check')"` }]);
    const a = await f.create("A"); await f.start(a); await f.finish(a); const da = await f.deliver(a);
    const result = f.service.store.state.verifications.find((entry) => entry.id === da.verificationId)!;
    expect(result.status).toBe("failed"); expect(result.error).toContain("检查期间");
    await expect(f.service.accept(da.id, "accepted")).rejects.toThrow();
  });

  it("records optional failures without concealing them and invalidates changed configuration", async () => {
    const f = await fixture(1, [...defaultChecks, { ...defaultChecks[0]!, id: "optional", required: false, command: `node -e "process.exit(1)"` }]);
    const a = await f.create("A"); await f.start(a); await f.finish(a); const da = await f.deliver(a);
    const result = f.service.store.state.verifications.find((entry) => entry.id === da.verificationId)!;
    expect(verificationIsValid(result, f.service.store.state.configs[0]!, da.tree)).toBe(true);
    expect(result.checks[1]?.status).toBe("failed");
    await f.command("workflow.configure", { projectId: f.project.id, targetBranch: "develop", concurrency: 1, checks: [{ ...defaultChecks[0]!, command: `node -e "console.log('new check')"` }] });
    await expect(f.service.accept(da.id, "accepted")).rejects.toThrow(/必需检查/);
  });

  it("shares the integration channel across duplicate project entries", async () => {
    const f = await fixture(); const p2 = await f.items.createProject({ name: "same repo", cwd: f.repository });
    await f.command("workflow.configure", { projectId: p2.id, targetBranch: "develop", concurrency: 1, checks: defaultChecks });
    const a = await f.create("A"); const b = await f.items.create({ title: "B", description: "implement B", acceptanceCriteria: "结果可用", cwd: f.repository, projectId: p2.id });
    await f.start(a); await f.start(b); await f.finish(a); await f.finish(b);
    const da = await f.deliver(a); const db = await f.deliver(b);
    const ia = await f.integrate(da.id); const ib = await f.integrate(db.id);
    expect(ia.status).toBe("ready"); expect(ib.status).toBe("queued"); expect(ia.repositoryKey).toBe(ib.repositoryKey);
    await f.service.merge(ia.id); await f.service.idle(); expect(ib.status).toBe("ready"); expect(ib.baseline).toBe(ia.mergedCommit);
  });

  it("keeps one logical task when integration repair continues the conversation", async () => {
    const f = await fixture(); const a = await f.create("A"); const wa = await f.start(a); await f.finish(a); const da = await f.deliver(a);
    const ia = await f.integrate(da.id); await f.service.repair(ia.id, "keep behavior"); await f.service.idle();
    const repair = f.launched.at(-1)!; expect(repair.taskId).toBe(wa.taskId); expect(repair.cwd).toBe(ia.workspace);
    expect(f.service.store.state.tickets.at(-1)?.phase).toBe("integration");
    await f.finish(a); expect(ia.status).toBe("ready");
  });

  it("reconciles a crash after CAS without replaying a merge", async () => {
    const f = await fixture(); const a = await f.create("A"); const wa = await f.start(a);
    await writeFile(path.join(wa.cwd, "new.txt"), "new"); await f.finish(a); const da = await f.deliver(a); const ia = await f.integrate(da.id);
    ia.status = "merging"; await f.service.store.save();
    await git(f.repository, ["update-ref", "refs/heads/develop", ia.candidate!, ia.baseline!]);
    const restored = f.createService(); await restored.ready;
    expect(restored.store.state.integrations[0]?.status).toBe("merged");
    expect(await readFile(path.join(f.repository, "new.txt"), "utf8")).toBe("new");
    const head = await git(f.repository, ["rev-parse", "HEAD"]); await restored.merge(ia.id);
    expect(await git(f.repository, ["rev-parse", "HEAD"])).toBe(head);
  });

  it("deduplicates requests, preserves archive history, and protects unmerged workspaces", async () => {
    const f = await fixture(); const a = await f.create("A"); const wa = await f.start(a); await f.finish(a);
    await writeFile(path.join(wa.cwd, "a.txt"), "A");
    const requestId = randomUUID(); const changes = await f.service.changes(a.id);
    const d1 = await f.service.seal(a.id, changes.paths, "A", requestId); await f.service.idle();
    const d2 = await f.service.seal(a.id, changes.paths, "A", requestId); expect(d1.delivery.id).toBe(d2.delivery.id);
    await expect(f.service.cleanup(a.id)).rejects.toThrow(/未合入/);
    await f.items.setState(a.id, "archived"); expect(f.service.store.state.deliveries).toHaveLength(1);
    await f.items.setState(a.id, "open"); const ia = await f.integrate(d1.delivery.id); await f.service.merge(ia.id);
    await f.service.cleanup(a.id); expect(f.service.store.state.workspaces[0]?.removedAt).toBeTruthy();
    expect(f.service.store.state.deliveries[0]?.patch).toContain("+A");
  });

  it("recovers interrupted runs without automatically executing them", async () => {
    const f = await fixture(); const a = await f.create("A"); await f.start(a);
    const launched = f.launched.length; const restored = f.createService(); await restored.ready;
    expect(restored.store.state.tickets[0]?.status).toBe("interrupted"); expect(f.launched).toHaveLength(launched);
    expect(restored.store.state.scopes[0]?.itemId).toBe(a.id);
  });

  it("records a verification interrupted on restart exactly once without rerunning checks", async () => {
    const f = await fixture(); const item = await f.create("中断检查历史"); await f.start(item);
    await writeFile(path.join(f.launched[0]!.cwd, "result.txt"), "done"); await f.finish(item);
    const delivery = await f.deliver(item);
    const verification = f.service.store.state.verifications.find((entry) => entry.id === delivery.verificationId)!;
    verification.status = "running"; verification.finishedAt = null;
    verification.checks[0]!.status = "running";
    const launchCount = f.launched.length; await f.service.store.save(); await f.service.flush(); f.service.dispose();
    const restored = f.createService(); await restored.ready;
    const recovered = restored.store.state.verifications.find((entry) => entry.id === verification.id)!;
    expect(recovered.status).toBe("interrupted"); expect(recovered.checks[0]!.status).toBe("interrupted");
    expect(restored.store.state.events.filter((event) => event.type === "verification.interrupted" && event.subjectId === verification.id)).toHaveLength(1);
    expect(f.launched).toHaveLength(launchCount);
    await restored.flush(); restored.dispose();
    const again = f.createService(); await again.ready;
    expect(again.store.state.events.filter((event) => event.type === "verification.interrupted" && event.subjectId === verification.id)).toHaveLength(1);
    expect(f.launched).toHaveLength(launchCount);
  });

  it("recovers workspace creation interrupted before Git creates the worktree", async () => {
    const f = await fixture(); const item = await f.create("interrupted workspace"); await planned(f, item);
    const original = gitModule.workflowGit;
    const spy = vi.spyOn(gitModule, "workflowGit").mockImplementation(async (cwd, args, input) => {
      if (args[0] === "worktree" && args[1] === "add") throw new Error("simulated interruption before worktree creation");
      return original(cwd, args, input);
    });
    try { await f.start(item); } finally { spy.mockRestore(); }
    expect(f.launched).toHaveLength(0);
    expect(f.service.store.state.workspaces).toHaveLength(1);
    f.service.dispose();
    const restored = f.createService(); await restored.ready;
    expect(f.launched).toHaveLength(0);
    await restored.enqueue(item.id, "initial"); await restored.idle();
    expect(f.launched).toHaveLength(1);
    expect(await git(f.launched[0]!.cwd, ["branch", "--show-current"])).toBe(`qingzhou/requirement/${item.id}`);
    expect(await readFile(path.join(f.launched[0]!.cwd, requirementFiles(item.id).prd), "utf8")).toContain("设计 interrupted workspace");
  });

  it("does not recreate a completed workspace moved outside the application", async () => {
    const f = await fixture(); const item = await f.create("moved workspace");
    const workspace = await f.start(item); await f.finish(item);
    await rename(workspace.cwd, `${workspace.cwd}-moved`);
    await f.service.enqueue(item.id, "initial"); await f.service.idle();
    expect(f.launched).toHaveLength(1);
    expect(f.service.store.state.tickets.at(-1)?.status).toBe("failed");
    expect(await readFile(path.join(`${workspace.cwd}-moved`, "shared.txt"), "utf8")).toBe(base);
    await expect(readFile(path.join(workspace.cwd, "shared.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves unrelated files at the path of an interrupted workspace creation", async () => {
    const f = await fixture(); const item = await f.create("occupied workspace");
    const cwd = path.join(f.dataDir, "worktrees", item.id);
    f.service.store.state.workspaces.push({ itemId: item.id, path: cwd, branch: `qingzhou/requirement/${item.id}`,
      baseline: f.baseline, originalPath: f.repository, createdAt: new Date().toISOString(), removedAt: null });
    await mkdir(cwd, { recursive: true }); await writeFile(path.join(cwd, "keep.txt"), "unrelated work\n");
    await f.service.enqueue(item.id, "initial"); await f.service.idle();
    expect(f.launched).toHaveLength(0);
    expect(f.service.store.state.tickets.at(-1)?.status).toBe("failed");
    expect(await readFile(path.join(cwd, "keep.txt"), "utf8")).toBe("unrelated work\n");
    expect(await git(f.repository, ["branch", "--list", `qingzhou/requirement/${item.id}`])).toBe("");
  });

  it("queues verification behind active implementation slots", async () => {
    const f = await fixture(1); const a = await f.create("A"); await f.start(a);
    const { verification } = await f.service.verifyMain(f.project.id);
    expect(f.service.store.state.verifications.find((entry) => entry.id === verification.id)?.status).toBe("queued");
    await f.finish(a);
    expect(f.service.store.state.verifications.find((entry) => entry.id === verification.id)?.status).toBe("passed");
  });

  it("exposes a failed latest main regression without erasing merged requirements", async () => {
    const f = await fixture(); const a = await f.create("A"); await f.start(a); await f.finish(a);
    const da = await f.deliver(a); const ia = await f.integrate(da.id); await f.service.merge(ia.id);
    await f.command("workflow.configure", { projectId: f.project.id, targetBranch: "develop", concurrency: 2, checks: [{ ...defaultChecks[0]!, command: `node -e "process.exit(1)"` }] });
    await f.service.verifyMain(f.project.id); await f.service.idle();
    expect((await f.service.state(f.project.id)).mainVerification?.status).toBe("failed");
    expect(ia.status).toBe("merged"); expect(f.service.store.state.acceptances[0]?.decision).toBe("accepted");
  });

  it("creates a reversible new requirement without resetting subsequent main history", async () => {
    const f = await fixture(); const a = await f.create("A"); const wa = await f.start(a);
    await writeFile(path.join(wa.cwd, "a.txt"), "A"); await f.finish(a); const da = await f.deliver(a); const ia = await f.integrate(da.id); await f.service.merge(ia.id);
    await writeFile(path.join(f.repository, "later.txt"), "later"); await git(f.repository, ["add", "."]); await git(f.repository, ["commit", "-m", "later main"]);
    const head = await git(f.repository, ["rev-parse", "HEAD"]);
    const { item } = await f.service.revert(ia.id, "revert-request");
    expect((await f.service.revert(ia.id, "revert-request")).item.id).toBe(item.id);
    const wr = f.service.store.state.workspaces.find((entry) => entry.itemId === item.id)!;
    await expect(readFile(path.join(wr.path, "a.txt"))).rejects.toThrow();
    expect(await readFile(path.join(wr.path, "later.txt"), "utf8")).toBe("later");
    expect(await git(f.repository, ["rev-parse", "HEAD"])).toBe(head);
    await f.start(item); await f.finish(item); const dr = await f.deliver(item); const ir = await f.integrate(dr.id); await f.service.merge(ir.id);
    expect(await readFile(path.join(f.repository, "later.txt"), "utf8")).toBe("later");
    await expect(readFile(path.join(f.repository, "a.txt"))).rejects.toThrow();
    await git(f.repository, ["merge-base", "--is-ancestor", head, "HEAD"]);
  });

  it("saves conversation snapshots for read-only replay after workspace cleanup", async () => {
    const f = await fixture(); const a = await f.create("A"); const wa = await f.start(a); await f.finish(a);
    await f.service.captureTranscript(a.id, wa.runId, [{ id: "message", role: "assistant", text: "token=private-value", createdAt: new Date().toISOString() }], []);
    const launched = f.launched.length;
    const replay = await f.command("workflow.transcript", { runId: wa.runId }) as { messages: Array<{ text: string }> };
    expect(replay.messages[0]?.text).toBe("token=[已隐藏]"); expect(f.launched).toHaveLength(launched);
    const da = await f.deliver(a); const ia = await f.integrate(da.id); await f.service.merge(ia.id); await f.service.cleanup(a.id);
    expect(await f.command("workflow.transcript", { runId: wa.runId })).toEqual(replay);
  });

  it("uses Git CAS when an external writer moves main after preflight", async () => {
    const f = await fixture(); const a = await f.create("A"); await f.start(a); await f.finish(a); const da = await f.deliver(a); const ia = await f.integrate(da.id);
    const originalGit = gitModule.workflowGit;
    let external = "";
    const spy = vi.spyOn(gitModule, "workflowGit").mockImplementation(async (cwd, args, input) => {
      if (!external && args[0] === "update-ref" && args.includes("--stdin")) {
        await writeFile(path.join(f.repository, "external.txt"), "external"); await originalGit(f.repository, ["add", "."]); await originalGit(f.repository, ["commit", "-m", "external during merge"]);
        external = await originalGit(f.repository, ["rev-parse", "HEAD"]);
      }
      return originalGit(cwd, args, input);
    });
    try { await expect(f.service.merge(ia.id)).rejects.toThrow(); }
    finally { spy.mockRestore(); }
    expect(external).not.toBe(""); expect(await git(f.repository, ["rev-parse", "HEAD"])).toBe(external); expect(ia.status).toBe("stale");
  });

  it("serializes checks sharing an exclusive environment resource", async () => {
    const f = await fixture(2); const lockPath = path.join(f.root, "exclusive.lock");
    const script = `const f=require('fs');const p=${JSON.stringify(lockPath)};const fd=f.openSync(p,'wx');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,120);f.closeSync(fd);f.unlinkSync(p)`;
    const command = `node -e "eval(Buffer.from('${Buffer.from(script).toString("base64")}','base64').toString())"`;
    await f.command("workflow.configure", { projectId: f.project.id, targetBranch: "develop", concurrency: 2, checks: [{ ...defaultChecks[0]!, command, resource: "shared-database" }] });
    const a = await f.create("A"); const b = await f.create("B"); await f.start(a); await f.start(b); await f.finish(a); await f.finish(b);
    const [da, db] = await Promise.all([f.deliver(a), f.deliver(b)]);
    expect(f.service.store.state.verifications.filter((entry) => [da.verificationId, db.verificationId].includes(entry.id)).map((entry) => entry.status)).toEqual(["passed", "passed"]);
  });

  it("terminates timed-out checks and never records them as passed", async () => {
    const f = await fixture(1, [{ ...defaultChecks[0]!, command: `node -e "setTimeout(()=>{},60000)"`, timeoutMs: 100 }]);
    const a = await f.create("A"); await f.start(a); await f.finish(a); const da = await f.deliver(a);
    const result = f.service.store.state.verifications.find((entry) => entry.id === da.verificationId)!;
    expect(result.status).toBe("failed"); expect(result.checks[0]?.exitCode).toBeNull(); expect(result.checks[0]?.output).toContain("超时");
  });

  it("backs up legacy records and does not promote historical success to verification or merge", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qingzhou-workflow-migration-"));
    const items = new WorkItemStore(root); await items.load();
    const item = await items.create({ title: "legacy", cwd: root });
    const run = await items.createRun({ objectiveId: item.id, taskId: randomUUID(), kind: "initial", instruction: "old instruction" });
    await items.updateRun(run.id, { status: "succeeded", resultSummary: "done" }); await items.setState(item.id, "completed");
    const service = new WorkflowService({ dataDir: root, items, emit: () => {}, launch: async () => { throw new Error("migration must not launch"); } }); services.push(service); await service.ready;
    expect(JSON.parse(await readFile(path.join(root, "work-items.pre-workflow.backup.json"), "utf8")).items[0].id).toBe(item.id);
    expect(service.store.state.scopes[0]?.itemId).toBe(item.id); expect(items.getDetails(item.id)?.runs[0]?.status).toBe("succeeded");
    expect(service.store.state.events.some((entry) => entry.type === "requirement.imported" && entry.itemId === item.id)).toBe(true);
    expect(service.store.state.verifications).toEqual([]); expect(service.store.state.integrations).toEqual([]); expect(service.store.state.acceptances).toEqual([]);
  });

  it("does not start dependents when an external Git rewrite removed the prerequisite", async () => {
    const f = await fixture(1); const a = await f.create("A"); const b = await f.create("B");
    await f.service.dependencies(b.id, [a.id]); await f.start(a); await f.finish(a); const da = await f.deliver(a); const ia = await f.integrate(da.id); await f.service.merge(ia.id);
    await git(f.repository, ["switch", "--detach", f.baseline]); await git(f.repository, ["branch", "-f", "develop", f.baseline]); await git(f.repository, ["switch", "develop"]);
    await f.service.enqueue(b.id, "initial"); await f.service.idle();
    const ticket = f.service.store.state.tickets.find((entry) => entry.itemId === b.id)!;
    expect(ticket.status).toBe("queued"); expect(ticket.error).toContain("不包含前置需求"); expect(f.launched.some((entry) => entry.id === b.id)).toBe(false);
  });

  it("does not restore stale scope contents when concurrent saves finish", async () => {
    const f = await fixture(); const a = await f.create("A");
    const stale = await f.items.update(a.id, { description: "earlier save" });
    await f.items.update(a.id, { description: "latest save" });
    await f.service.syncScope(stale);
    expect(f.service.store.state.scopes.filter((entry) => entry.itemId === a.id).at(-1)?.description).toBe("latest save");
  });

  it("pins feedback instructions to the current scope when a brief changes before queuing", async () => {
    const f = await fixture(); const a = await f.create("A");
    let entered!: () => void; let release!: () => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const original = f.items.addFeedback.bind(f.items);
    const spy = vi.spyOn(f.items, "addFeedback").mockImplementation(async (id, text) => {
      const feedback = await original(id, text); entered(); await gate; return feedback;
    });
    const queued = f.service.feedback(a.id, "additional requirement", randomUUID());
    await enteredPromise;
    await f.items.update(a.id, { description: "latest brief" }); await f.service.syncScope(f.items.get(a.id)!);
    release(); await queued; spy.mockRestore(); await f.service.idle();
    const ticket = f.service.store.state.tickets.at(-1)!;
    expect(ticket.instruction).toContain("latest brief"); expect(ticket.instruction).toContain("additional requirement");
    expect(f.service.store.state.scopes.find((entry) => entry.id === ticket.scopeId)?.description).toBe("latest brief");
  });
});

it("binds acceptance evidence and artifact previews to the sealed delivery, including after live edits", async () => {
  const f = await fixture(); const a = await f.create("产物审阅"); const workspace = await f.start(a);
  await writeFile(path.join(workspace.cwd, "report.txt"), "sealed evidence\n"); await f.finish(a);
  const changes = await f.service.changes(a.id);
  const { delivery } = await f.service.seal(a.id, changes.paths, "报告可用", randomUUID(), { behaviors: "提供审阅报告", unresolved: "人工核对文案", artifactPaths: ["report.txt"] });
  await f.service.idle();
  const evidence = [{ criterion: "结果可用", note: "人工已核对报告内容", checkIds: ["regression"], artifactPaths: ["report.txt"] }];
  await expect(f.service.accept(delivery.id, "accepted", "逐条验收", [{ ...evidence[0]!, checkIds: ["foreign-check"] }])).rejects.toThrow("本交付之外");
  await f.service.accept(delivery.id, "accepted", "逐条验收", evidence);
  expect(f.service.store.state.acceptances.at(-1)?.evidence).toEqual(evidence);
  expect(await f.command("workflow.artifact", { deliveryId: delivery.id, path: "report.txt" })).toEqual({ mimeType: "text/plain", text: "sealed evidence\n" });
  await writeFile(path.join(workspace.cwd, "report.txt"), "live change");
  expect(await f.command("workflow.artifact", { deliveryId: delivery.id, path: "report.txt" })).toMatchObject({ text: "sealed evidence\n" });
  await expect(f.command("workflow.artifact", { deliveryId: delivery.id, path: "../report.txt" })).rejects.toThrow("未登记");
  await expect(f.service.feedback(a.id, "按旧版本返工", randomUUID(), [], randomUUID())).rejects.toThrow("交付已变化");
  expect(f.items.listFeedback(a.id)).toHaveLength(0);
});

it("compares recorded main versions and retains the link from a withdrawal to its original integration", async () => {
  const f = await fixture(); const a = await f.create("版本 A"); const workspace = await f.start(a);
  await writeFile(path.join(workspace.cwd, "a.txt"), "version A"); await f.finish(a); const delivery = await f.deliver(a);
  const attempt = await f.integrate(delivery.id); await f.service.merge(attempt.id);
  const comparison = await f.command("workflow.compare", { projectId: f.project.id, from: f.baseline, to: attempt.mergedCommit }) as { files: string[]; patch: string };
  expect(comparison.files).toContain("a.txt"); expect(comparison.patch).toContain("+version A");
  await expect(f.command("workflow.compare", { projectId: f.project.id, from: "--help", to: attempt.mergedCommit })).rejects.toThrow("只能比较");
  const { item } = await f.service.revert(attempt.id, randomUUID());
  expect(item.source?.integrationId).toBe(attempt.id);
});

it("explains waits on archived dependencies and lets users stop, remove the dependency and resume", async () => {
  const f = await fixture(1); const a = await f.create("等待者"); const b = await f.create("已归档的前置");
  await f.service.dependencies(a.id, [b.id]); await f.items.setState(b.id, "archived");
  await f.service.enqueue(a.id, "initial"); await f.service.idle();
  const state = await f.service.state(f.project.id);
  expect(state.queue).toMatchObject({ used: 0, limit: 1 });
  expect(state.queue?.reasons[a.id]).toContain("已归档的前置"); expect(state.dependencies[a.id]).toEqual([b.id]);
  await f.service.stop(a.id, true); await f.service.dependencies(a.id, []); await f.service.enqueue(a.id, "initial"); await f.service.idle();
  expect(f.launched.some((entry) => entry.id === a.id)).toBe(true);
});


it("requires an explicit goal and acceptance criteria before any implementation entry, while allowing preparation discussion", async () => {
  const f = await fixture();
  const draft = await f.items.create({ projectId: f.project.id, cwd: f.repository, title: "尚待讨论" });
  await expect(f.service.enqueue(draft.id, "initial")).rejects.toThrow("完善目标说明与验收标准");
  const complete = await f.items.create({ projectId: f.project.id, cwd: f.repository, title: "可实施需求", description: "完成目标", acceptanceCriteria: "结果正确", source: { excerpt: "用户已确认保留现有逻辑" } });
  await expect(f.command("workflow.enqueue", { ids: [complete.id, draft.id] })).rejects.toThrow("完善目标说明与验收标准");
  expect(f.service.store.state.tickets).toHaveLength(0);
  await f.service.enqueue(draft.id, "discussion", "先讨论验收标准"); await f.service.idle();
  expect(f.service.store.state.tickets[0]?.phase).toBe("discussion");
  await f.service.enqueue(complete.id, "initial"); await f.service.idle();
  expect(f.service.store.state.tickets.find((ticket) => ticket.itemId === complete.id)?.instruction).toContain("用户已确认保留现有逻辑");
});

it("binds implementation and delivery to the confirmed PRD, then freezes it and publishes module design on final acceptance", async () => {
  const f = await fixture(); const item = await f.create("PRD 生命周期");
  const { module, revision } = f.service.design.createModule(f.project.id, "会话模块", "当前会话设计");
  await f.command("workflow.plan.begin", { id: item.id });
  await expect(f.start(item)).rejects.toThrow("确认当前需求范围");
  const scope = f.service.store.scope(item);
  await expect(f.command("workflow.scope.confirm", { id: item.id, scopeId: randomUUID() })).rejects.toThrow("范围已变化");
  await f.command("workflow.scope.confirm", { id: item.id, scopeId: scope.id });
  await expect(f.start(item)).rejects.toThrow("确认当前 PRD");
  const save = async (content: string, expectedPrdId: string | null, reason: string) => f.service.design.save({ id: item.id, scopeId: scope.id, expectedPrdId, content, reason,
    moduleChanges: [{ moduleId: module.id, baseRevisionId: revision.id, content: "新的会话完整设计" }] }).prd;
  const first = await save("第一版方案", null, "初始设计");
  await expect(f.start(item)).rejects.toThrow("确认当前 PRD");
  await f.command("workflow.prd.confirm", { id: item.id, prdId: first.id });
  const launch = await f.start(item);
  expect(f.service.store.state.tickets.at(-1)?.instruction).toContain("第一版方案");
  expect(f.service.store.state.tickets.at(-1)?.instruction).toContain("新的会话完整设计");
  expect(f.service.store.state.tickets.at(-1)?.prdId).toBe(first.id);
  await writeFile(path.join(launch.cwd, "prd-result.txt"), "implementation"); await f.finish(item);
  const oldDelivery = await f.deliver(item); expect(oldDelivery.prdId).toBe(first.id);
  const next = await save("调整后的方案", first.id, "实施后调整交互");
  await expect(f.service.accept(oldDelivery.id, "accepted")).rejects.toThrow("PRD 已变化");
  await expect(f.service.seal(item.id, [], "不能封存未确认设计", randomUUID())).rejects.toThrow("确认当前 PRD");
  await f.command("workflow.prd.confirm", { id: item.id, prdId: next.id });
  await expect(f.service.seal(item.id, [], "不能沿用上一轮实现", randomUUID())).rejects.toThrow("PRD 已调整");
  await f.start(item); await f.finish(item); const delivery = await f.deliver(item);
  await f.service.accept(delivery.id, "accepted");
  expect(f.service.design.prd(item.id)).toMatchObject({ id: next.id, deliveryId: delivery.id, content: "调整后的方案", frozenAt: expect.any(String) });
  expect(first).toMatchObject({ content: "第一版方案", frozenAt: null });
  expect(f.service.store.state.moduleRevisions?.at(-1)).toMatchObject({ moduleId: module.id, version: 2, previousId: revision.id, sourcePrdId: next.id, deliveryId: delivery.id, content: "新的会话完整设计" });
  await f.service.accept(delivery.id, "accepted"); // Idempotent retry does not create a module version.
  expect(f.service.store.state.moduleRevisions).toHaveLength(2);
  await expect(f.command("workflow.prd.save", { id: item.id, scopeId: scope.id, expectedPrdId: next.id, content: "篡改", reason: "不应允许", moduleChanges: [] })).rejects.toThrow("已固化");
  await expect(f.service.feedback(item.id, "继续改设计")).rejects.toThrow("已固化");
  expect(() => f.service.assertDesignEditable(item.id)).toThrow("已固化");
  await f.service.flush(); const restored = f.createService(); await restored.ready;
  expect(restored.design.prd(item.id)?.frozenAt).toBe(next.frozenAt);
  expect(restored.store.state.moduleRevisions?.at(-1)?.sourcePrdId).toBe(next.id);
  const attempt = await f.service.integrate(delivery.id, randomUUID()); await f.service.idle();
  expect(f.service.store.state.integrations.find((entry) => entry.id === attempt.attempt.id)?.status).toBe("ready");
});

it("keeps independent same-module proposals pinned to code while accepted unmerged designs remain separate", async () => {
  const f = await fixture(); const a = await f.create("设计 A"); const b = await f.create("设计 B");
  const shared = f.service.design.createModule(f.project.id, "共享模块", "基线");
  const pa = await planned(f, a, [{ moduleId: shared.module.id, baseRevisionId: shared.revision.id, content: "共享 A" }]);
  const pb = await planned(f, b, [{ moduleId: shared.module.id, baseRevisionId: shared.revision.id, content: "共享 B" }]);
  const wa = await f.start(a); const wb = await f.start(b);
  await writeFile(path.join(wa.cwd, "a.txt"), "A"); await writeFile(path.join(wb.cwd, "b.txt"), "B");
  await f.finish(a); await f.finish(b); const da = await f.deliver(a); const db = await f.deliver(b);
  await f.service.accept(db.id, "accepted"); await f.service.accept(da.id, "accepted");
  expect(pa.frozenAt).toBeTruthy(); expect(pb.frozenAt).toBeTruthy();
  expect(pa.codeBaseline?.commit).toBe(f.baseline);
  const child = await f.create("不依赖未合入设计");
  const state = await f.service.state(f.project.id);
  expect(state.designBaselines?.[child.id]?.moduleRevisionIds[shared.module.id]).toBe(shared.revision.id);
  const latest = f.service.store.state.moduleRevisions!.at(-1)!;
  await expect(planned(f, child, [{ moduleId: shared.module.id, baseRevisionId: latest.id, content: "错误采用未合入设计" }])).rejects.toThrow("代码基线不一致");
});

it("uses optimistic PRD revision checks, isolates projects, and invalidates confirmation when scope changes", async () => {
  const f = await fixture(); const item = await f.create("版本确认"); await f.service.beginPlanning(item.id);
  let scope = f.service.store.scope(item); await f.command("workflow.scope.confirm", { id: item.id, scopeId: scope.id });
  const payload = { id: item.id, scopeId: scope.id, expectedPrdId: null, content: "方案", reason: "初稿", moduleChanges: [] };
  await f.command("workflow.prd.save", payload); const first = f.service.design.prd(item.id)!;
  await expect(f.command("workflow.prd.save", payload)).rejects.toThrow("已有新版本");
  await expect(f.command("workflow.prd.confirm", { id: item.id, prdId: randomUUID() })).rejects.toThrow("版本已变化");
  const foreign = await f.items.createProject({ name: "其他项目", cwd: f.repository });
  const module = f.service.design.createModule(foreign.id, "不应泄露", "私有设计");
  await expect(f.command("workflow.prd.save", { ...payload, expectedPrdId: first.id, moduleChanges: [{ moduleId: module.module.id, baseRevisionId: module.revision.id, content: "越界关联" }] })).rejects.toThrow("不属于当前项目");
  const state = await f.service.state(f.project.id);
  expect(state.modules?.some((entry) => entry.id === module.module.id)).toBe(false);
  expect(state.moduleRevisions?.some((entry) => entry.id === module.revision.id)).toBe(false);
  await f.command("workflow.prd.confirm", { id: item.id, prdId: first.id });
  const updated = await f.items.update(item.id, { description: "新边界" }); await f.service.syncScope(updated); scope = f.service.store.scope(updated);
  await expect(f.start(updated)).rejects.toThrow("确认当前需求范围");
  await f.command("workflow.scope.confirm", { id: item.id, scopeId: scope.id });
  await expect(f.start(updated)).rejects.toThrow("确认当前 PRD");
  await expect(f.command("workflow.prd.confirm", { id: item.id, prdId: first.id })).rejects.toThrow("更新 PRD");
  expect(first.content).toBe("方案");
});

it("reads Agent design-file edits back into a new unconfirmed PRD and seals the exact reconfirmed design with code", async () => {
  const f = await fixture(); const item = await f.create("设计文件同步"); await f.service.beginPlanning(item.id);
  const scope = f.service.store.scope(item); await f.command("workflow.scope.confirm", { id: item.id, scopeId: scope.id });
  const original = f.service.design.save({ id: item.id, scopeId: scope.id, expectedPrdId: null, content: "初始设计", reason: "初稿", moduleChanges: [] }).prd;
  await f.command("workflow.prd.confirm", { id: item.id, prdId: original.id });
  const launch = await f.start(item);
  const relative = `docs/qingzhou/requirements/${item.id}.json`; const file = path.join(launch.cwd, relative);
  const document = JSON.parse(await readFile(file, "utf8"));
  expect(document).toMatchObject({ prdId: original.id, content: "初始设计" });
  await writeFile(file, JSON.stringify({ ...document, content: "Agent 调整后的交互设计" }));
  await writeFile(path.join(launch.cwd, "result.txt"), "实现同步调整");
  await f.finish(item);
  const updated = f.service.design.prd(item.id)!;
  expect(updated).toMatchObject({ version: 2, previousId: original.id, content: "Agent 调整后的交互设计", confirmedAt: null, reason: "从实施工作区同步设计调整" });
  expect(original.content).toBe("初始设计");
  await expect(f.deliver(item)).rejects.toThrow("确认当前 PRD");
  await f.command("workflow.prd.confirm", { id: item.id, prdId: updated.id });
  await expect(f.deliver(item)).rejects.toThrow("PRD 已调整");
  await f.start(item); await f.finish(item);
  expect(JSON.parse(await readFile(file, "utf8")).prdId).toBe(updated.id);
  await writeFile(file, "{invalid json");
  await expect(f.deliver(item)).rejects.toThrow("不是有效 JSON");
  await writeFile(file, JSON.stringify({ ...document, prdId: updated.id, content: updated.content }));
  const delivery = await f.deliver(item);
  expect(delivery.files).toContain(relative);
  expect(JSON.parse(await git(launch.cwd, ["show", `${delivery.commit}:${relative}`]))).toMatchObject({ prdId: updated.id, content: updated.content });
  await f.service.accept(delivery.id, "accepted"); expect(updated.frozenAt).toBeTruthy();
});

it("retains the confirmed code and module baseline while unrelated designs change during queue wait", async () => {
  const f = await fixture(); const item = await f.create("排队设计");
  const { module, revision } = f.service.design.createModule(f.project.id, "并行模块", "初始设计");
  await f.service.beginPlanning(item.id); const scope = f.service.store.scope(item);
  await f.command("workflow.scope.confirm", { id: item.id, scopeId: scope.id });
  const prd = f.service.design.save({ id: item.id, scopeId: scope.id, expectedPrdId: null, content: "旧基线方案", reason: "初稿", moduleChanges: [{ moduleId: module.id, baseRevisionId: revision.id, content: "模块调整" }] }).prd;
  await f.command("workflow.prd.confirm", { id: item.id, prdId: prd.id });
  await f.command("workflow.pause", { projectId: f.project.id, paused: true }); await f.service.enqueue(item.id, "initial"); await f.service.idle();
  expect(f.service.store.state.tickets.at(-1)?.status).toBe("queued");
  f.service.store.state.moduleRevisions!.push({ ...revision, id: randomUUID(), version: 2, previousId: revision.id, content: "其他需求已经发布的新设计" });
  await f.command("workflow.pause", { projectId: f.project.id, paused: false }); await f.service.idle();
  expect(f.launched).toHaveLength(1);
  expect(prd.codeBaseline?.moduleRevisionIds[module.id]).toBe(revision.id);
  expect(await git(f.launched[0]!.cwd, ["rev-parse", "HEAD"])).toBe(prd.codeBaseline?.commit);
});

it("previews and initializes project standards without overwriting instructions or committing mainline changes", async () => {
  const f = await fixture(); const custom = "项目既有 Agent 约定\n"; await writeFile(path.join(f.repository, "AGENTS.md"), custom);
  const before = await f.command("workflow.standard.inspect", { projectId: f.project.id }) as { ready: boolean; files: Array<{ path: string; status: string; preview?: string }> };
  expect(before.ready).toBe(false); expect(before.files.find((entry) => entry.path === "AGENTS.md")?.status).toBe("present");
  expect(before.files.find((entry) => entry.path === "docs/agents/workflow.md")?.preview).toContain("由用户确认具体版本");
  const result = await f.command("workflow.standard.initialize", { projectId: f.project.id }) as { created: string[]; preserved: string[] };
  expect(result.preserved).toContain("AGENTS.md"); expect(result.created).toContain("docs/qingzhou/project.json");
  expect(await readFile(path.join(f.repository, "AGENTS.md"), "utf8")).toBe(custom);
  expect(await git(f.repository, ["rev-parse", "HEAD"])).toBe(f.baseline);
  expect((await f.command("workflow.standard.initialize", { projectId: f.project.id }) as { created: string[] }).created).toEqual([]);
  const item = await f.create("正在运行"); await f.start(item);
  await expect(f.command("workflow.standard.initialize", { projectId: f.project.id })).rejects.toThrow("先结束项目执行");
});

it("roundtrips Markdown design edits with exact scope and module snapshots, and seals them alongside code", async () => {
  const f = await fixture(); const item = await f.create("标准化实施");
  const { module, revision } = f.service.design.createModule(f.project.id, "测试模块", "当前确认设计");
  await f.service.beginPlanning(item.id); const scope = f.service.store.scope(item);
  await f.command("workflow.scope.confirm", { id: item.id, scopeId: scope.id });
  const first = f.service.design.save({ id: item.id, scopeId: scope.id, expectedPrdId: null, content: "首次实施方案", reason: "确认方案", moduleChanges: [{ moduleId: module.id, baseRevisionId: revision.id, content: "模块首次提案" }] }).prd;
  await f.command("workflow.prd.confirm", { id: item.id, prdId: first.id });
  const launch = await f.start(item); const files = requirementFiles(item.id);
  const context = await readFile(path.join(launch.cwd, files.context), "utf8");
  expect(f.service.store.state.tickets.at(-1)?.instruction).toContain(files.context);
  expect(f.service.store.state.tickets.at(-1)?.instruction).not.toContain("本轮以本说明为准");
  expect(context).toContain(scope.id); expect(context).toContain(first.id); expect(context).toContain(revision.id);
  expect(await readFile(path.join(launch.cwd, files.agents), "utf8")).toContain("人工验收");
  expect(await readFile(path.join(launch.cwd, files.verification), "utf8")).toContain("待验证");
  await writeFile(path.join(launch.cwd, files.prd), "Markdown 实施后调整");
  await writeFile(path.join(launch.cwd, files.module(module.id)), "Markdown 模块完整新设计");
  await writeFile(path.join(launch.cwd, "result.txt"), "实现结果"); await f.finish(item);
  const revised = f.service.design.prd(item.id)!;
  expect(revised).toMatchObject({ version: 2, confirmedAt: null, content: "Markdown 实施后调整", moduleChanges: [{ content: "Markdown 模块完整新设计" }] });
  await expect(f.deliver(item)).rejects.toThrow("确认当前 PRD");
  await f.command("workflow.prd.confirm", { id: item.id, prdId: revised.id }); await f.start(item); await f.finish(item);
  const currentContext = await readFile(path.join(launch.cwd, files.context), "utf8");
  await unlink(path.join(launch.cwd, files.context)); await expect(f.deliver(item)).rejects.toThrow("文档快照与确认设计不一致");
  await writeFile(path.join(launch.cwd, files.context), currentContext);
  const baselineFile = path.join(launch.cwd, files.baseline(module.id, revision.id)); const baseline = await readFile(baselineFile, "utf8");
  await writeFile(baselineFile, "伪造模块已合入"); await expect(f.deliver(item)).rejects.toThrow("文档快照与确认设计不一致"); await writeFile(baselineFile, baseline);
  const jsonFile = path.join(launch.cwd, requirementDesignPath(item.id)); const json = await readFile(jsonFile, "utf8");
  await writeFile(jsonFile, JSON.stringify({ ...JSON.parse(json), documentationVersion: undefined })); await expect(f.deliver(item)).rejects.toThrow("文档版本标记缺失"); await writeFile(jsonFile, json);
  const delivery = await f.deliver(item);
  expect(delivery.files).toContain(files.prd); expect(delivery.files).toContain(files.context);
  expect(await git(launch.cwd, ["show", `${delivery.commit}:${files.prd}`])).toBe(revised.content);
  await f.service.accept(delivery.id, "accepted"); expect(revised.frozenAt).toBeTruthy();
  expect(f.service.store.state.moduleRevisions?.at(-1)?.content).toBe("Markdown 模块完整新设计");
});

it("requires a candidate-bound behavior review and invalidates it after a repair", async () => {
  const f = await fixture(); const item = await f.create("复审"); await f.start(item); await f.finish(item); const delivery = await f.deliver(item);
  await f.service.accept(delivery.id, "accepted");
  const { attempt: created } = await f.service.integrate(delivery.id, randomUUID()); await f.service.idle();
  const attempt = f.service.store.state.integrations.find((entry) => entry.id === created.id)!;
  await expect(f.service.merge(attempt.id)).rejects.toThrow("行为复审");
  await f.service.reviewCandidate({ id: attempt.id, candidate: attempt.candidate!, decision: "design_changed", note: "修复需要改变用户流程" });
  await expect(f.service.merge(attempt.id)).rejects.toThrow("行为复审");
  await f.review(attempt.id); const old = attempt.candidate!;
  await writeFile(path.join(attempt.workspace!, "repair.txt"), "repair");
  await f.service.recheck(attempt.id); await f.service.idle();
  expect(attempt.review).toBeUndefined();
  await expect(f.service.reviewCandidate({ id: attempt.id, candidate: old, decision: "compatible", note: "旧候选复审" })).rejects.toThrow("候选已变化");
  await expect(f.service.merge(attempt.id)).rejects.toThrow("行为复审");
  await f.review(attempt.id); await f.service.merge(attempt.id);
  expect(await readFile(path.join(f.repository, "repair.txt"), "utf8")).toBe("repair");
});

it("rejects frozen PRD changes inside an otherwise passing integration candidate", async () => {
  const f = await fixture(); const item = await f.create("保护固化设计"); await planned(f, item);
  await f.start(item); await f.finish(item); const delivery = await f.deliver(item); const attempt = await f.integrate(delivery.id);
  await writeFile(path.join(attempt.workspace!, requirementFiles(item.id).prd), "偷偷改变产品语义");
  await f.service.recheck(attempt.id); await f.service.idle();
  expect(attempt.status).toBe("failed"); expect(attempt.error).toContain("快照");
  expect(attempt.review).toBeUndefined(); expect(await git(f.repository, ["rev-parse", "HEAD"])).toBe(f.baseline);
});

it("ships module documents with code, guards mismatches, and exposes the merged design baseline", async () => {
  const f = await fixture(); const item = await f.create("模块同步");
  const { module, revision } = f.service.design.createModule(f.project.id, "文档模块", "原设计");
  const prd = await planned(f, item, [{ moduleId: module.id, baseRevisionId: revision.id, content: "实际实现的新设计" }]);
  const launch = await f.start(item); const file = module.documentPath;
  const document = await readFile(path.join(launch.cwd, file), "utf8"); expect(document).toContain(prd.id); expect(document).toContain("实际实现的新设计");
  await f.finish(item); await writeFile(path.join(launch.cwd, file), document.replace("实际实现的新设计", "未确认改动"));
  await expect(f.deliver(item)).rejects.toThrow("模块仓库文档");
  await writeFile(path.join(launch.cwd, file), document); const delivery = await f.deliver(item); expect(delivery.files).toContain(file);
  const attempt = await f.integrate(delivery.id); await f.service.merge(attempt.id);
  expect(await readFile(path.join(f.repository, file), "utf8")).toBe(document);
  const child = await f.create("后续需求"); const state = await f.service.state(f.project.id);
  const current = state.moduleRevisions!.find((entry) => entry.id === state.designBaselines?.[child.id]?.moduleRevisionIds[module.id]);
  expect(current).toMatchObject({ content: "实际实现的新设计", integrationId: attempt.id });
});

it("automatically seals and checks an authorized cycle but never accepts or integrates it", async () => {
  const f = await fixture(); const item = await f.create("自动验证"); await planned(f, item);
  const requestId = randomUUID(); const first = await f.service.startCycle(item.id, 2, requestId); await f.service.idle();
  const duplicate = await f.service.startCycle(item.id, 2, requestId); expect(duplicate.cycle.id).toBe(first.cycle.id);
  await writeFile(path.join(f.launched.at(-1)!.cwd, "done.txt"), "done"); await f.finish(item);
  expect(f.service.store.state.cycles!.at(-1)?.status).toBe("ready_for_review");
  expect(f.service.store.state.deliveries).toHaveLength(1); expect(f.service.store.state.acceptances).toHaveLength(0);
  expect(f.service.store.state.integrations).toHaveLength(0); expect(f.service.design.prd(item.id)?.frozenAt).toBeNull();
});

it("uses real failed-check logs for a bounded repair and succeeds on the repaired tree", async () => {
  const check = { ...defaultChecks[0]!, command: `node -e "if(!require('fs').existsSync('fixed.txt')){console.log('missing fixed file');process.exit(1)}"` };
  const f = await fixture(2, [check]); const item = await f.create("自动修复"); await planned(f, item);
  await f.service.startCycle(item.id, 1, randomUUID()); await f.service.idle(); await f.finish(item);
  expect(f.launched).toHaveLength(2); expect(f.service.store.state.tickets.at(-1)?.instruction).toContain("missing fixed file");
  await writeFile(path.join(f.launched.at(-1)!.cwd, "fixed.txt"), "fixed"); await f.finish(item);
  expect(f.service.store.state.cycles!.at(-1)).toMatchObject({ status: "ready_for_review", repairs: 1 });
  expect(f.service.store.state.deliveries).toHaveLength(2); expect(f.service.store.state.verifications.at(-1)?.status).toBe("passed");
});

it("stops automatic repairs at the limit and does not run again after restart", async () => {
  const f = await fixture(2, [{ ...defaultChecks[0]!, command: `node -e "process.exit(1)"` }]); const item = await f.create("修复上限");
  await f.service.startCycle(item.id, 1, randomUUID()); await f.service.idle(); await f.finish(item); await f.finish(item);
  expect(f.service.store.state.cycles!.at(-1)).toMatchObject({ status: "paused", repairs: 1 }); expect(f.launched).toHaveLength(2);
  await f.service.startCycle(item.id, 1, randomUUID()); await f.service.idle(); await f.service.flush();
  const count = f.launched.length; const restored = f.createService(); await restored.ready; await restored.idle();
  expect(restored.store.state.cycles!.at(-1)?.status).toBe("interrupted"); expect(f.launched).toHaveLength(count);
});

it("pauses an automatic cycle when the Agent changes the PRD instead of confirming the change", async () => {
  const f = await fixture(); const item = await f.create("设计变化暂停"); const original = await planned(f, item);
  await f.service.startCycle(item.id, 1, randomUUID()); await f.service.idle();
  await writeFile(path.join(f.launched.at(-1)!.cwd, requirementFiles(item.id).prd), "新的交互方案"); await f.finish(item);
  expect(f.service.store.state.cycles!.at(-1)?.status).toBe("paused"); expect(f.service.store.state.deliveries).toHaveLength(0);
  expect(f.service.design.prd(item.id)).toMatchObject({ previousId: original.id, content: "新的交互方案", confirmedAt: null });
});

it("cancelled automatic progression leaves the current implementation available without sealing it", async () => {
  const f = await fixture(); const item = await f.create("停止自动推进");
  await f.service.startCycle(item.id, 2, randomUUID()); await f.service.idle(); await f.command("workflow.cycle.cancel", { id: item.id });
  await f.finish(item); expect(f.service.store.state.cycles!.at(-1)?.status).toBe("cancelled"); expect(f.service.store.state.deliveries).toHaveLength(0);
});

it("captures structured discussion proposals without approving them and rejects mismatched basis", async () => {
  const f = await fixture(); const item = await f.create("结构化提案"); await f.service.beginPlanning(item.id);
  await f.service.enqueue(item.id, "discussion", "仅讨论"); await f.service.idle();
  const run = f.launched.at(-1)!; const scope = f.service.store.scope(item);
  const proposal = { schemaVersion: 1, itemId: item.id, scopeId: scope.id, expectedPrdId: null, content: "完整方案", reason: "讨论提案", moduleChanges: [], questions: ["待确认边界？"] };
  const message = (value: unknown) => [{ id: randomUUID(), role: "assistant" as const, text: "```qingzhou-design\n" + JSON.stringify(value) + "\n```", createdAt: new Date().toISOString() }];
  await f.service.captureTranscript(item.id, run.runId, message(proposal), []);
  await f.service.captureTranscript(item.id, run.runId, message(proposal), []);
  expect(f.service.store.state.proposals).toHaveLength(1); expect(f.service.design.prd(item.id)).toBeUndefined();
  expect(f.service.design.plan(item.id)?.confirmedScopeId).toBeNull(); await f.finish(item);
  await f.service.enqueue(item.id, "discussion", "再讨论"); await f.service.idle();
  await f.service.captureTranscript(item.id, f.launched.at(-1)!.runId, message({ ...proposal, itemId: randomUUID() }), []);
  expect(f.service.store.state.proposals).toHaveLength(1);
  expect(f.service.store.state.events.some((entry) => entry.type === "design.proposal.failed")).toBe(true);
});

it("merges same-module documents with a separate integration revision while preserving both frozen PRDs", async () => {
  const f = await fixture(); const a = await f.create("并行 A"); const b = await f.create("并行 B");
  const { module, revision } = f.service.design.createModule(f.project.id, "并行设计", "原设计");
  const pa = await planned(f, a, [{ moduleId: module.id, baseRevisionId: revision.id, content: "保留 A 行为" }]);
  const pb = await planned(f, b, [{ moduleId: module.id, baseRevisionId: revision.id, content: "保留 B 行为" }]);
  await f.start(a); await f.start(b); await f.finish(a); await f.finish(b);
  const da = await f.deliver(a); const db = await f.deliver(b);
  await f.service.accept(da.id, "accepted"); const ib = await f.integrate(db.id); await f.service.merge(ib.id);
  const ia = await f.integrate(da.id); expect(ia.status).toBe("conflicts"); expect(ia.conflicts).toContain(module.documentPath);
  await writeFile(path.join(ia.workspace!, module.documentPath), moduleDocument(module, pa, "保留 A 行为，同时保留 B 行为"));
  await git(ia.workspace!, ["add", "-A"]); await f.service.recheck(ia.id); await f.service.idle();
  expect(ia.status).toBe("ready"); await f.review(ia.id); await f.service.merge(ia.id);
  expect(pa.moduleChanges[0]!.content).toBe("保留 A 行为"); expect(pb.moduleChanges[0]!.content).toBe("保留 B 行为");
  const child = await f.create("合并后的后续需求"); const state = await f.service.state(f.project.id);
  const integrated = state.moduleRevisions!.find((entry) => entry.id === state.designBaselines?.[child.id]?.moduleRevisionIds[module.id]);
  expect(integrated).toMatchObject({ integrationId: ia.id, content: "保留 A 行为，同时保留 B 行为" });
});

it("pauses automation when check configuration changes and when launching cannot materialize safe files", async () => {
  const f = await fixture(); const item = await f.create("配置变化"); await planned(f, item);
  await f.service.startCycle(item.id, 2, randomUUID()); await f.service.idle();
  await f.command("workflow.configure", { projectId: f.project.id, targetBranch: "develop", concurrency: 2, checks: [{ ...defaultChecks[0]!, name: "新检查配置" }] });
  await f.finish(item); expect(f.service.store.state.cycles!.at(-1)?.status).toBe("paused"); expect(f.service.store.state.deliveries).toHaveLength(0);
  const other = await f.create("启动失败"); await planned(f, other);
  await f.service.enqueue(other.id, "discussion", "只读"); await f.service.idle(); await f.finish(other);
  await writeFile(path.join(f.launched.at(-1)!.cwd, "docs"), "不安全目录");
  await f.service.startCycle(other.id, 1, randomUUID()); await f.service.idle();
  expect(f.service.store.state.cycles!.at(-1)?.status).toBe("paused");
});

it("does not resurrect an automatic cycle cancelled while changes are being read", async () => {
  const f = await fixture(); const item = await f.create("停止与封存竞态");
  await f.service.startCycle(item.id, 1, randomUUID()); await f.service.idle();
  const original = f.service.changes.bind(f.service);
  const spy = vi.spyOn(f.service, "changes").mockImplementationOnce(async (id) => {
    const changes = await original(id); await f.command("workflow.cycle.cancel", { id }); return changes;
  });
  try { await f.finish(item); } finally { spy.mockRestore(); }
  expect(f.service.store.state.cycles!.at(-1)?.status).toBe("cancelled"); expect(f.service.store.state.deliveries).toHaveLength(0);
});

it("waits for a verification slot when the next queued requirement takes the implementation slot", async () => {
  const f = await fixture(1); const a = await f.create("自动需求 A"); const b = await f.create("排队需求 B");
  await f.service.startCycle(a.id, 1, randomUUID()); await f.service.idle();
  await f.service.enqueue(b.id, "initial"); await f.service.idle();
  await f.items.updateRun(f.launched[0]!.runId, { status: "succeeded" }); await f.service.settled(a.id, true);
  await expect.poll(() => f.launched.some((entry) => entry.id === b.id)).toBe(true);
  expect(f.service.store.state.cycles!.at(-1)?.status).toBe("running");
  await f.finish(b);
  expect(f.service.store.state.cycles!.at(-1)?.status).toBe("ready_for_review");
  expect(f.service.store.state.verifications.at(-1)?.status).toBe("passed");
});

it("writes custom Markdown immediately, preserves bindings, and reloads bodies from immutable files", async () => {
  const f = await fixture(); const item = await f.create("可读文档");
  await f.command("workflow.documents.configure", { projectId: f.project.id, paths: { prds: "design/requirements", modules: "design/modules" } });
  const { module, revision } = await f.command("workflow.module.create", { projectId: f.project.id, name: "阅读模块", content: "# 当前设计\n\n- 易读" }) as ReturnType<WorkflowService["design"]["createModule"]>;
  expect(module.documentPath).toMatch(/^design\/modules\/阅读模块-/);
  expect(await readFile(path.join(f.repository, module.documentPath), "utf8")).toBe(revision.content);
  await f.service.beginPlanning(item.id); const scope = f.service.store.scope(item);
  await f.command("workflow.scope.confirm", { id: item.id, scopeId: scope.id });
  const input = { id: item.id, scopeId: scope.id, expectedPrdId: null, content: "# 阅读方案\n\n|目标|结果|\n|---|---|\n|正文|Markdown|", reason: "首次保存", moduleChanges: [{ moduleId: module.id, baseRevisionId: revision.id, content: revision.content }] };
  const { prd } = await f.command("workflow.prd.save", input) as { prd: import("@qingzhou/protocol").RequirementPrd };
  expect(prd.document?.path).toMatch(/^design\/requirements\/可读文档-/);
  expect(await readFile(path.join(f.repository, prd.document!.path), "utf8")).toBe(prd.content);
  expect(f.service.store.state.workspaces).toHaveLength(0);
  const raw = JSON.parse(await readFile(path.join(f.dataDir, "workflow.json"), "utf8"));
  expect(raw.prds[0].content).toBeUndefined(); expect(raw.prds[0].moduleChanges[0].content).toBeUndefined(); expect(raw.moduleRevisions[0].content).toBeUndefined();
  await f.command("workflow.documents.configure", { projectId: f.project.id, paths: { prds: "future/prds", modules: "future/modules" } });
  const { prd: next } = await f.command("workflow.prd.save", { ...input, expectedPrdId: prd.id, content: "# 新版本" }) as { prd: import("@qingzhou/protocol").RequirementPrd };
  expect(next.document?.path).toBe(prd.document?.path);
  const restarted = f.createService(); await restarted.ready;
  expect(restarted.design.prd(item.id)?.content).toBe("# 新版本");
  expect(restarted.store.state.prds?.find((entry) => entry.id === prd.id)?.content).toBe(prd.content);
});

it("preserves external edits, requires explicit sync, and never carries confirmation to the new version", async () => {
  const f = await fixture(); const item = await f.create("外部修改"); await f.service.beginPlanning(item.id);
  const scope = f.service.store.scope(item); await f.command("workflow.scope.confirm", { id: item.id, scopeId: scope.id });
  const input = { id: item.id, scopeId: scope.id, expectedPrdId: null, content: "# 原始设计", reason: "保存", moduleChanges: [] };
  const { prd } = await f.command("workflow.prd.save", input) as { prd: import("@qingzhou/protocol").RequirementPrd };
  await f.command("workflow.prd.confirm", { id: item.id, prdId: prd.id });
  await writeFile(path.join(f.repository, prd.document!.path), "# 外部编辑");
  await expect(f.command("workflow.prd.save", { ...input, expectedPrdId: prd.id, content: "界面草稿" })).rejects.toThrow(/外部修改/);
  await expect(f.command("workflow.prd.confirm", { id: item.id, prdId: prd.id })).rejects.toThrow(/外部修改/);
  expect(f.service.design.prd(item.id)?.id).toBe(prd.id);
  expect(await readFile(path.join(f.repository, prd.document!.path), "utf8")).toBe("# 外部编辑");
  const synced = await f.command("workflow.prd.import", { id: item.id, source: "project" }) as { prd: import("@qingzhou/protocol").RequirementPrd };
  expect(synced.prd).toMatchObject({ content: "# 外部编辑", confirmedAt: null, previousId: prd.id });
  expect(await readFile(path.join(f.repository, prd.document!.revisionPath), "utf8")).toBe(prd.content);
});

it("merges exact managed Markdown while retaining another demand's draft and blocking user staging", async () => {
  const f = await fixture();
  await f.command("workflow.documents.configure", { projectId: f.project.id, paths: { prds: "custom/prds", modules: "custom/modules" } });
  const save = async (title: string) => {
    const item = await f.create(title); await f.service.beginPlanning(item.id); const scope = f.service.store.scope(item);
    await f.command("workflow.scope.confirm", { id: item.id, scopeId: scope.id });
    const { prd } = await f.command("workflow.prd.save", { id: item.id, scopeId: scope.id, expectedPrdId: null, content: `# ${title}`, reason: "首次保存", moduleChanges: [] }) as { prd: import("@qingzhou/protocol").RequirementPrd };
    return { item, prd };
  };
  const a = await save("当前需求"); const b = await save("其他草稿");
  await f.command("workflow.prd.confirm", { id: a.item.id, prdId: a.prd.id });
  const launch = await f.start(a.item); expect(launch).toBeDefined();
  await writeFile(path.join(launch.cwd, "feature.txt"), "implemented\n"); await f.finish(a.item);
  await writeFile(path.join(f.repository, a.prd.document!.path), "外部变更不能封存");
  await expect(f.deliver(a.item)).rejects.toThrow(/外部修改/);
  expect(f.service.store.state.deliveries).toHaveLength(0);
  await writeFile(path.join(f.repository, a.prd.document!.path), a.prd.content);
  const delivery = await f.deliver(a.item); const attempt = await f.integrate(delivery.id); expect(attempt.status).toBe("ready");
  await writeFile(path.join(f.repository, "manual.txt"), "用户暂存"); await git(f.repository, ["add", "manual.txt"]);
  await expect(f.service.merge(attempt.id)).rejects.toThrow(/人工暂存/);
  expect(await git(f.repository, ["diff", "--cached", "--name-only"])).toBe("manual.txt");
  await git(f.repository, ["restore", "--staged", "manual.txt"]); await unlink(path.join(f.repository, "manual.txt"));
  await f.service.merge(attempt.id);
  expect(attempt.status).toBe("merged"); expect(await readFile(path.join(f.repository, "feature.txt"), "utf8")).toBe("implemented\n");
  expect(await readFile(path.join(f.repository, b.prd.document!.path), "utf8")).toBe(b.prd.content);
  expect(await git(f.repository, ["diff", "--cached", "--name-only"])).toBe("");
  expect((await git(f.repository, ["status", "--porcelain", "--untracked-files=all"]))).toContain(b.prd.document!.path);
});

it("previews all legacy revision bodies before import and retains historical IDs and workspace paths", async () => {
  const f = await fixture(); const item = await f.create("旧项目设计");
  const { module, revision } = f.service.design.createModule(f.project.id, "旧模块", "模块基线");
  const original = await planned(f, item, [{ moduleId: module.id, baseRevisionId: revision.id, content: "提案一" }]);
  const scope = f.service.store.scope(item);
  const latest = f.service.design.save({ id: item.id, scopeId: scope.id, expectedPrdId: original.id, content: "第二版", reason: "修订", moduleChanges: [{ moduleId: module.id, baseRevisionId: revision.id, content: "提案二" }] }).prd;
  await f.service.flush();
  const inspection = await f.service.documents.inspect(f.project.id);
  expect(inspection.files.some((entry) => entry.source.includes("v1"))).toBe(true);
  await f.command("workflow.documents.import", { projectId: f.project.id });
  expect(f.service.store.state.prds?.map((entry) => entry.id)).toEqual([original.id, latest.id]);
  expect(original.confirmedAt).not.toBeNull(); expect(latest.confirmedAt).toBeNull();
  for (const prd of [original, latest]) {
    expect(prd.document?.workspacePath).toBe(requirementFiles(item.id).prd);
    expect(await readFile(path.join(f.repository, prd.document!.revisionPath), "utf8")).toBe(prd.content);
    const change = prd.moduleChanges[0]!;
    expect(await readFile(path.join(f.repository, change.document!.revisionPath), "utf8")).toBe(change.content);
  }
  const restarted = f.createService(); await restarted.ready;
  expect(restarted.design.prd(item.id)?.content).toBe("第二版");
  expect((await restarted.documents.inspect(f.project.id)).files).toEqual([]);
});

it("rejects occupied and linked document destinations without writing partial state", async () => {
  const f = await fixture(); const item = await f.create("冲突目标"); await f.service.beginPlanning(item.id);
  const scope = f.service.store.scope(item); await f.command("workflow.scope.confirm", { id: item.id, scopeId: scope.id });
  const file = `docs/requirements/${item.title}-${item.id}/PRD.md`;
  await mkdir(path.dirname(path.join(f.repository, file)), { recursive: true }); await writeFile(path.join(f.repository, file), "已有用户文档");
  await expect(f.command("workflow.prd.save", { id: item.id, scopeId: scope.id, expectedPrdId: null, content: "新设计", reason: "保存", moduleChanges: [] })).rejects.toThrow(/目标已占用/);
  expect(f.service.design.prd(item.id)).toBeUndefined(); expect(await readFile(path.join(f.repository, file), "utf8")).toBe("已有用户文档");
  const { symlink } = await import("node:fs/promises"); const outside = path.join(f.root, "outside"); await mkdir(outside); await symlink(outside, path.join(f.repository, "linked"));
  await expect(f.command("workflow.documents.configure", { projectId: f.project.id, paths: { prds: "linked/prds", modules: "modules" } })).rejects.toThrow(/链接/);
  await expect(readFile(path.join(f.repository, "docs/qingzhou/project.json"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("rolls back an interrupted file write but keeps external edits and never invents a PRD version", async () => {
  const f = await fixture(); const item = await f.create("中断保存"); await f.service.beginPlanning(item.id);
  const scope = f.service.store.scope(item); await f.command("workflow.scope.confirm", { id: item.id, scopeId: scope.id });
  const staged = f.service.design.save({ id: item.id, scopeId: scope.id, expectedPrdId: null, content: "待保存正文", reason: "保存", moduleChanges: [] }, true).prd;
  await f.service.documents.persistPrd(staged); // Simulate process exit before state/confirmation is committed.
  await writeFile(path.join(f.repository, staged.document!.path), "中断后的外部编辑");
  const restarted = f.createService(); await restarted.ready;
  expect(restarted.design.prd(item.id)).toBeUndefined();
  expect(await readFile(path.join(f.repository, staged.document!.path), "utf8")).toBe("中断后的外部编辑");
  await expect(readFile(path.join(f.repository, staged.document!.revisionPath))).rejects.toMatchObject({ code: "ENOENT" });
});

it("recovers staged managed documents before CAS without altering worktree files or merging", async () => {
  const f = await fixture(); const item = await f.create("合入中断"); await f.service.beginPlanning(item.id);
  const scope = f.service.store.scope(item); await f.command("workflow.scope.confirm", { id: item.id, scopeId: scope.id });
  const { prd } = await f.command("workflow.prd.save", { id: item.id, scopeId: scope.id, expectedPrdId: null, content: "# 设计", reason: "保存", moduleChanges: [] }) as { prd: import("@qingzhou/protocol").RequirementPrd };
  await f.command("workflow.prd.confirm", { id: item.id, prdId: prd.id });
  const launch = await f.start(item); await writeFile(path.join(launch.cwd, "feature.txt"), "实现"); await f.finish(item);
  const delivery = await f.deliver(item); const attempt = await f.integrate(delivery.id);
  const files = await gitModule.changedPaths(f.repository);
  attempt.status = "merging"; await f.service.store.save();
  await f.service.documents.stageOwnedForMerge(f.project.id, attempt.candidate!, files, attempt.id, attempt.baseline!);
  expect(await git(f.repository, ["diff", "--cached", "--name-only"])).not.toBe("");
  const restarted = f.createService(); await restarted.ready;
  expect(await git(f.repository, ["diff", "--cached", "--name-only"])).toBe("");
  expect(await readFile(path.join(f.repository, prd.document!.path), "utf8")).toBe(prd.content);
  expect(await git(f.repository, ["rev-parse", "HEAD"])).toBe(f.baseline);
  expect(restarted.store.state.integrations.find((entry) => entry.id === attempt.id)?.status).toBe("failed");
});

it("advances a new module's exact initial Markdown baseline with its confirmed delivery while preserving external edits", async () => {
  const f = await fixture(); const item = await f.create("首次模块交付");
  const { module, revision } = await f.command("workflow.module.create", { projectId: f.project.id, name: "新模块", content: "# 原设计\n英文问候\n" }) as ReturnType<WorkflowService["design"]["createModule"]>;
  await f.service.beginPlanning(item.id); const scope = f.service.store.scope(item);
  await f.command("workflow.scope.confirm", { id: item.id, scopeId: scope.id });
  const { prd } = await f.command("workflow.prd.save", { id: item.id, scopeId: scope.id, expectedPrdId: null, content: "# 增加中文", reason: "设计更新", moduleChanges: [{ moduleId: module.id, baseRevisionId: revision.id, content: "# 新设计\n英文和中文问候\n" }] }) as { prd: import("@qingzhou/protocol").RequirementPrd };
  await f.command("workflow.prd.confirm", { id: item.id, prdId: prd.id });
  const launch = await f.start(item); await writeFile(path.join(launch.cwd, "feature.txt"), "implemented\n"); await f.finish(item);
  const delivery = await f.deliver(item); const attempt = await f.integrate(delivery.id);
  await writeFile(path.join(f.repository, module.documentPath), "用户另外修改的模块设计");
  await expect(f.service.merge(attempt.id)).rejects.toThrow(/未提交改动或外部修改/);
  expect(await readFile(path.join(f.repository, module.documentPath), "utf8")).toBe("用户另外修改的模块设计");
  expect(await git(f.repository, ["diff", "--cached", "--name-only"])).toBe("");
  await writeFile(path.join(f.repository, module.documentPath), revision.content);
  await f.service.merge(attempt.id); expect(attempt.status).toBe("merged");
  expect(attempt.error).toBeNull();
  expect(await readFile(path.join(f.repository, module.documentPath), "utf8")).toBe(prd.moduleChanges[0]!.content);
  expect(await readFile(path.join(f.repository, revision.document!.revisionPath), "utf8")).toBe(revision.content);
  expect(await git(f.repository, ["diff", "--cached", "--name-only"])).toBe("");
});

it("keeps project history readable with invalid path configuration and repairs only the document settings", async () => {
  const f = await fixture(); const item = await f.create("配置恢复"); await planned(f, item);
  await f.command("workflow.documents.configure", { projectId: f.project.id, paths: { prds: "design/prds", modules: "design/modules" } });
  const file = path.join(f.repository, "docs/qingzhou/project.json"); const manifest = JSON.parse(await readFile(file, "utf8"));
  manifest.documentPaths.prds = "../outside"; manifest.customSetting = { keep: true }; await writeFile(file, JSON.stringify(manifest));
  const state = await f.service.state(f.project.id);
  expect(state.documentPathsError).toContain("配置无效"); expect(state.prds?.some((entry) => entry.itemId === item.id)).toBe(true);
  await f.command("workflow.documents.configure", { projectId: f.project.id, paths: { prds: "docs/prds", modules: "docs/modules" } });
  expect(JSON.parse(await readFile(file, "utf8")).customSetting).toEqual({ keep: true });
  expect((await f.service.state(f.project.id)).documentPathsError).toBeUndefined();
});

it.each(["prd", "module"])("retains legacy %s bodies and bindings after a failed document import", async (kind) => {
  const f = await fixture(); const item = await f.create("导入失败恢复");
  const prd = kind === "prd" ? await planned(f, item) : undefined;
  const module = kind === "module" ? f.service.design.createModule(f.project.id, "旧模块", "原模块正文") : undefined;
  await f.service.store.save(); await f.service.flush();
  const original = workspaceFiles.writeWorkspaceText;
  const spy = vi.spyOn(workspaceFiles, "writeWorkspaceText").mockImplementation(async (root, file, content, overwrite) => {
    if (root === f.repository && file.includes("/.versions/")) throw new Error("simulated revision write failure");
    return original(root, file, content, overwrite);
  });
  try { await expect(f.command("workflow.documents.import", { projectId: f.project.id })).rejects.toThrow("simulated revision write failure"); }
  finally { spy.mockRestore(); }
  expect(prd?.document ?? module?.revision.document).toBeUndefined();
  await f.service.store.save(); await f.service.flush();
  const restored = f.createService(); await restored.ready;
  if (prd) expect(restored.design.prd(item.id)?.content).toBe(prd.content);
  else expect(restored.store.state.moduleRevisions?.find((entry) => entry.id === module!.revision.id)?.content).toBe("原模块正文");
});

it("preserves tracked unrelated document drafts when the candidate leaves their baseline unchanged", async () => {
  const f = await fixture(); const b = await f.create("已跟踪草稿"); await f.service.beginPlanning(b.id);
  const scope = f.service.store.scope(b); await f.command("workflow.scope.confirm", { id: b.id, scopeId: scope.id });
  const { prd } = await f.command("workflow.prd.save", { id: b.id, scopeId: scope.id, expectedPrdId: null, content: "原草稿", reason: "保存", moduleChanges: [] }) as { prd: import("@qingzhou/protocol").RequirementPrd };
  await git(f.repository, ["add", "docs"]); await git(f.repository, ["commit", "-m", "track document draft"]);
  const a = await f.create("独立交付"); const launch = await f.start(a);
  await writeFile(path.join(launch.cwd, "feature.txt"), "A"); await f.finish(a);
  const delivery = await f.deliver(a); const attempt = await f.integrate(delivery.id);
  await f.command("workflow.prd.save", { id: b.id, scopeId: scope.id, expectedPrdId: prd.id, content: "保留新版草稿", reason: "修订", moduleChanges: [] });
  await f.service.merge(attempt.id);
  expect(await readFile(path.join(f.repository, prd.document!.path), "utf8")).toBe("保留新版草稿");
  expect(await git(f.repository, ["diff", "--cached", "--name-only"])).toBe("");
});

it("refuses a polluted document index tree without removing concurrently staged user files", async () => {
  const f = await fixture(); await f.command("workflow.documents.configure", { projectId: f.project.id, paths: { prds: "docs/requirements", modules: "docs/modules" } });
  const item = await f.create("并发暂存"); const launch = await f.start(item);
  await writeFile(path.join(launch.cwd, "feature.txt"), "implemented"); await f.finish(item);
  const delivery = await f.deliver(item); const attempt = await f.integrate(delivery.id);
  const original = f.service.documents.ownedChanges.bind(f.service.documents);
  const spy = vi.spyOn(f.service.documents, "ownedChanges").mockImplementationOnce(async (...args) => {
    const owned = await original(...args);
    await writeFile(path.join(f.repository, "manual.txt"), "用户并发暂存"); await git(f.repository, ["add", "manual.txt"]);
    return owned;
  });
  try { await expect(f.service.merge(attempt.id)).rejects.toThrow(/索引|暂存/); }
  finally { spy.mockRestore(); }
  expect(await readFile(path.join(f.repository, "manual.txt"), "utf8")).toBe("用户并发暂存");
  expect(await git(f.repository, ["diff", "--cached", "--name-only"])).toContain("manual.txt");
  expect(await git(f.repository, ["rev-parse", "HEAD"])).toBe(attempt.baseline);
});

it("allocates distinct module revisions when independent deliveries are accepted concurrently", async () => {
  const f = await fixture();
  const { module, revision } = await f.command("workflow.module.create", { projectId: f.project.id, name: "并行模块", content: "初始设计" }) as ReturnType<WorkflowService["design"]["createModule"]>;
  const deliveries = [];
  for (const title of ["A", "B"]) {
    const item = await f.create(title); await planned(f, item, [{ moduleId: module.id, baseRevisionId: revision.id, content: `设计 ${title}` }]);
    const launch = await f.start(item); await writeFile(path.join(launch.cwd, `${title}.txt`), title); await f.finish(item); deliveries.push(await f.deliver(item));
  }
  const original = f.service.documents.persistModule.bind(f.service.documents);
  const spy = vi.spyOn(f.service.documents, "persistModule").mockImplementation(async (...args) => {
    await new Promise((resolve) => setTimeout(resolve, 30)); return original(...args);
  });
  try { await Promise.all(deliveries.map((delivery) => f.service.accept(delivery.id, "accepted"))); }
  finally { spy.mockRestore(); }
  expect(f.service.store.state.moduleRevisions?.filter((entry) => entry.moduleId === module.id).map((entry) => entry.version)).toEqual([1, 2, 3]);
});

it("rejects immutable module history changes both when sealing and when verifying a candidate", async () => {
  const f = await fixture();
  const { module, revision } = await f.command("workflow.module.create", { projectId: f.project.id, name: "不可变历史", content: "原始历史正文\n" }) as ReturnType<WorkflowService["design"]["createModule"]>;
  await git(f.repository, ["add", "docs"]); await git(f.repository, ["commit", "-m", "track initial module history"]);
  const item = await f.create("保护历史"); await planned(f, item, [{ moduleId: module.id, baseRevisionId: revision.id, content: "完成后的设计" }]);
  const launch = await f.start(item); const file = revision.document!.revisionPath;
  await writeFile(path.join(launch.cwd, "feature.txt"), "implemented"); await writeFile(path.join(launch.cwd, file), "篡改历史"); await f.finish(item);
  await expect(f.deliver(item)).rejects.toThrow(/历史.*文档|不可变/);
  await writeFile(path.join(launch.cwd, file), revision.content);
  const delivery = await f.deliver(item); const attempt = await f.integrate(delivery.id);
  await writeFile(path.join(attempt.workspace!, file), "候选篡改历史");
  await f.service.recheck(attempt.id); await f.service.idle();
  expect(attempt.status).toBe("failed"); expect(attempt.error).toMatch(/历史.*文档|不可变/);
  expect(await readFile(path.join(f.repository, file), "utf8")).toBe(revision.content);
});

it("continues an imported legacy JSON-only workspace without rewriting its sealed Git history", async () => {
  const f = await fixture(); const item = await f.create("旧 JSON 工作区"); const prd = await planned(f, item);
  const launch = await f.start(item); await f.finish(item);
  const file = path.join(launch.cwd, requirementDesignPath(item.id));
  const document = JSON.parse(await readFile(file, "utf8")); delete document.documentationVersion;
  await writeFile(file, JSON.stringify(document));
  await unlink(path.join(launch.cwd, requirementFiles(item.id).prd));
  await f.command("workflow.documents.import", { projectId: f.project.id });
  expect(f.service.design.prd(item.id)?.id).toBe(prd.id);
  const next = await f.start(item); expect(next).toBeDefined();
  expect(await readFile(path.join(next.cwd, requirementFiles(item.id).prd), "utf8")).toBe(prd.content);
});

it("continues implementation from a committed imported initial module document", async () => {
  const f = await fixture(); const { module, revision } = f.service.design.createModule(f.project.id, "导入模块", "旧初始设计");
  await f.service.store.save(); await f.command("workflow.documents.import", { projectId: f.project.id });
  await git(f.repository, ["add", "docs"]); await git(f.repository, ["commit", "-m", "track imported documents"]);
  const item = await f.create("导入后实施"); await f.service.beginPlanning(item.id); const scope = f.service.store.scope(item);
  await f.command("workflow.scope.confirm", { id: item.id, scopeId: scope.id });
  const { prd } = await f.command("workflow.prd.save", { id: item.id, scopeId: scope.id, expectedPrdId: null, content: "更新导入模块", reason: "保存", moduleChanges: [{ moduleId: module.id, baseRevisionId: revision.id, content: "新设计" }] }) as { prd: import("@qingzhou/protocol").RequirementPrd };
  await f.command("workflow.prd.confirm", { id: item.id, prdId: prd.id });
  const launch = await f.start(item); expect(launch).toBeDefined();
  await writeFile(path.join(launch.cwd, "feature.txt"), "implemented"); await f.finish(item);
  const delivery = await f.deliver(item); const attempt = await f.integrate(delivery.id); await f.service.merge(attempt.id);
  expect(await readFile(path.join(f.repository, module.documentPath!), "utf8")).toContain("新设计");
});

it("rejects oversized external module proposals before persisting a new PRD", async () => {
  const f = await fixture(); const { module, revision } = f.service.design.createModule(f.project.id, "长度限制", "初始设计");
  const item = await f.create("外部正文长度"); const base = await planned(f, item, [{ moduleId: module.id, baseRevisionId: revision.id, content: "原提案" }]);
  await f.command("workflow.documents.import", { projectId: f.project.id });
  const oversized = "x".repeat(12001); await writeFile(path.join(f.repository, base.moduleChanges[0]!.document!.path), oversized);
  await expect(f.command("workflow.prd.import", { id: item.id, source: "project" })).rejects.toThrow(/12000|模块/);
  expect(f.service.design.prd(item.id)?.id).toBe(base.id);
  expect(await readFile(path.join(f.repository, base.moduleChanges[0]!.document!.path), "utf8")).toBe(oversized);
  await f.service.flush(); const restored = f.createService(); await restored.ready;
  expect(restored.design.prd(item.id)?.moduleChanges[0]?.content).toBe("原提案");
});

it("reloads generated document bindings beneath valid long configured directories", async () => {
  const f = await fixture(); const directory = Array.from({ length: 4 }, () => "x".repeat(50)).join("/");
  await f.command("workflow.documents.configure", { projectId: f.project.id, paths: { prds: `${directory}/p`, modules: `${directory}/m` } });
  const { module, revision } = await f.command("workflow.module.create", { projectId: f.project.id, name: "长目录模块", content: "初始正文" }) as ReturnType<WorkflowService["design"]["createModule"]>;
  expect(revision.document!.revisionPath.length).toBeGreaterThan(240);
  await f.service.flush(); const restored = f.createService(); await restored.ready;
  expect(restored.store.state.moduleRevisions?.find((entry) => entry.moduleId === module.id)?.content).toBe("初始正文");
});

it("rejects candidate edits to another frozen requirement's custom execution snapshots", async () => {
  const f = await fixture(); await f.command("workflow.documents.configure", { projectId: f.project.id, paths: { prds: "design/prds", modules: "design/modules" } });
  const b = await f.create("B 固化需求"); await f.service.beginPlanning(b.id); const scope = f.service.store.scope(b);
  await f.command("workflow.scope.confirm", { id: b.id, scopeId: scope.id });
  const { prd } = await f.command("workflow.prd.save", { id: b.id, scopeId: scope.id, expectedPrdId: null, content: "B 的设计", reason: "保存", moduleChanges: [] }) as { prd: import("@qingzhou/protocol").RequirementPrd };
  await f.command("workflow.prd.confirm", { id: b.id, prdId: prd.id });
  const wb = await f.start(b); await writeFile(path.join(wb.cwd, "b.txt"), "B"); await f.finish(b);
  const db = await f.deliver(b); const ib = await f.integrate(db.id); await f.service.merge(ib.id);
  const a = await f.create("A 后续需求"); const wa = await f.start(a); await writeFile(path.join(wa.cwd, "a.txt"), "A"); await f.finish(a);
  const context = requirementFiles(b.id, prd.document!.path).context;
  const before = await readFile(path.join(f.repository, context), "utf8");
  await writeFile(path.join(wa.cwd, context), "源交付改写其他需求");
  await expect(f.deliver(a)).rejects.toThrow(/其他需求|快照/);
  await writeFile(path.join(wa.cwd, context), before);
  const da = await f.deliver(a); const ia = await f.integrate(da.id);
  await writeFile(path.join(ia.workspace!, context), "改写其他需求的依据");
  await f.service.recheck(ia.id); await f.service.idle();
  expect(ia.status).toBe("failed"); expect(ia.error).toMatch(/其他需求|快照/);
  expect(await readFile(path.join(f.repository, context), "utf8")).toBe(before);
});

it("preserves structured proposal bodies when an agent copies server document metadata", async () => {
  const f = await fixture(); const { module, revision } = await f.command("workflow.module.create", { projectId: f.project.id, name: "提案模块", content: "基线" }) as ReturnType<WorkflowService["design"]["createModule"]>;
  const item = await f.create("结构化提案"); await f.start(item);
  const ticket = f.service.store.state.tickets.find((entry) => entry.itemId === item.id)!; ticket.phase = "discussion";
  const proposal = { schemaVersion: 1, itemId: item.id, scopeId: ticket.scopeId, expectedPrdId: null, content: "提案正文", reason: "讨论", questions: [], moduleChanges: [{ moduleId: module.id, baseRevisionId: revision.id, content: "模块提案正文", document: revision.document }] };
  await f.service.captureTranscript(item.id, ticket.runId!, [{ id: randomUUID(), role: "assistant", text: `\x60\x60\x60qingzhou-design\n${JSON.stringify(proposal)}\n\x60\x60\x60`, createdAt: new Date().toISOString() }], []);
  expect(f.service.store.state.proposals?.[0]?.moduleChanges[0]?.content).toBe("模块提案正文");
  expect(f.service.store.state.proposals?.[0]?.moduleChanges[0]).not.toHaveProperty("document");
  // Existing in-memory records from the previous protocol must also retain their bodies.
  Object.assign(f.service.store.state.proposals![0]!.moduleChanges[0]!, { document: revision.document });
  await f.service.store.save();
  await f.service.flush(); const restored = f.createService(); await restored.ready;
  expect(restored.store.state.proposals?.[0]?.moduleChanges[0]?.content).toBe("模块提案正文");
});

it("preserves concurrent manual staging of a document included in the candidate", async () => {
  const f = await fixture(); const item = await f.create("同路径暂存保护"); await f.service.beginPlanning(item.id); const scope = f.service.store.scope(item);
  await f.command("workflow.scope.confirm", { id: item.id, scopeId: scope.id });
  const { prd } = await f.command("workflow.prd.save", { id: item.id, scopeId: scope.id, expectedPrdId: null, content: "登记的 PRD", reason: "保存", moduleChanges: [] }) as { prd: import("@qingzhou/protocol").RequirementPrd };
  await f.command("workflow.prd.confirm", { id: item.id, prdId: prd.id });
  const launch = await f.start(item); await writeFile(path.join(launch.cwd, "feature.txt"), "implemented"); await f.finish(item);
  const delivery = await f.deliver(item); const attempt = await f.integrate(delivery.id);
  const file = prd.document!.path; const manual = "用户手工暂存的另一版正文";
  const original = f.service.documents.ownedChanges.bind(f.service.documents);
  const spy = vi.spyOn(f.service.documents, "ownedChanges").mockImplementationOnce(async (...args) => {
    const owned = await original(...args);
    await writeFile(path.join(f.repository, file), manual); await git(f.repository, ["add", "--", file]);
    await writeFile(path.join(f.repository, file), prd.content);
    return owned;
  });
  try { await expect(f.service.merge(attempt.id)).rejects.toThrow(/索引|暂存/); }
  finally { spy.mockRestore(); }
  expect(await git(f.repository, ["show", `:${file}`])).toBe(manual);
  expect(await readFile(path.join(f.repository, file), "utf8")).toBe(prd.content);
  expect(await git(f.repository, ["rev-parse", "HEAD"])).toBe(attempt.baseline);
});

it("preserves an external index lock and concurrent manual staging during merge recovery", async () => {
  const f = await fixture(); const item = await f.create("恢复时暂存保护"); await f.service.beginPlanning(item.id); const scope = f.service.store.scope(item);
  await f.command("workflow.scope.confirm", { id: item.id, scopeId: scope.id });
  const { prd } = await f.command("workflow.prd.save", { id: item.id, scopeId: scope.id, expectedPrdId: null, content: "登记正文", reason: "保存", moduleChanges: [] }) as { prd: import("@qingzhou/protocol").RequirementPrd };
  await f.command("workflow.prd.confirm", { id: item.id, prdId: prd.id });
  const launch = await f.start(item); await writeFile(path.join(launch.cwd, "feature.txt"), "implemented"); await f.finish(item);
  const delivery = await f.deliver(item); const attempt = await f.integrate(delivery.id);
  const files = await gitModule.changedPaths(f.repository); const file = prd.document!.path;
  const lock = `${await git(f.repository, ["rev-parse", "--path-format=absolute", "--git-path", "index"])}.lock`;
  await writeFile(lock, "external lock", { flag: "wx" });
  try { await expect(f.service.documents.stageOwnedForMerge(f.project.id, attempt.candidate!, files, attempt.id, attempt.baseline!)).rejects.toThrow(); }
  finally { expect(await readFile(lock, "utf8")).toBe("external lock"); await unlink(lock); }
  expect(await git(f.repository, ["diff", "--cached", "--name-only"])).toBe("");
  await f.service.documents.stageOwnedForMerge(f.project.id, attempt.candidate!, files, attempt.id, attempt.baseline!);
  const original = gitModule.workflowGit;
  const spy = vi.spyOn(gitModule, "workflowGit").mockImplementation(async (cwd, args, input, index) => {
    if (args[0] === "restore") {
      await writeFile(path.join(f.repository, file), "恢复期间手工暂存"); await original(f.repository, ["add", "--", file]);
      await writeFile(path.join(f.repository, file), prd.content);
    }
    return original(cwd, args, input, index);
  });
  try { await expect(f.service.documents.reconcileMerge(attempt.id, f.project.id, attempt.candidate!, attempt.baseline!, false)).rejects.toThrow(/索引|暂存/); }
  finally { spy.mockRestore(); }
  expect(await git(f.repository, ["show", `:${file}`])).toBe("恢复期间手工暂存");
  expect(await readFile(path.join(f.repository, file), "utf8")).toBe(prd.content);
});
