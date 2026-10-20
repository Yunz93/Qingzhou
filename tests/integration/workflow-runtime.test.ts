import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { clientCommandSchema, type RequirementPrd, type WorkItem, type WorkflowProjectState, type WorkProject } from "@qingzhou/protocol";
import { createApp } from "../../apps/server/src/index.ts";
import { workflowGit as git } from "../../apps/server/src/tasks/workflow-git.ts";

it("releases finished requirement processes and drains the global queue at a one-process limit", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "qingzhou-workflow-runtime-"));
  const repository = path.join(root, "repo"); await mkdir(repository);
  await git(repository, ["init", "-b", "trunk"]); await writeFile(path.join(repository, "README.md"), "runtime\n");
  await git(repository, ["add", "."]); await git(repository, ["commit", "-m", "initial"]);
  const { app, service } = await createApp({ HOST: "127.0.0.1", PORT: "0", NODE_ENV: "test",
    PI_BIN: fileURLToPath(new URL("../fixtures/fake-pi.mjs", import.meta.url)),
    QINGZHOU_SKIP_PI_TOOLS_FETCH: "1", QINGZHOU_DATA_DIR: path.join(root, "data"), QINGZHOU_HOME_DIR: root,
    QINGZHOU_ALLOWED_ROOTS: root, QINGZHOU_MAX_PROCESSES: "1", QINGZHOU_MUTATIONS: "approval" });
  await app.ready();
  const send = async <T>(type: string, payload: object): Promise<T> => service.handleCommand(clientCommandSchema.parse({ id: randomUUID(), operationId: randomUUID(), type, payload })) as Promise<T>;
  try {
    const { project } = await send<{ project: WorkProject }>("workProject.create", { name: "runtime", cwd: repository });
    await send("workflow.configure", { projectId: project.id, targetBranch: "trunk", concurrency: 2, checks: [] });
    const a = (await send<{ item: WorkItem }>("workItem.create", { projectId: project.id, title: "A", description: "WRITE:a.txt:A", acceptanceCriteria: "文件 A 正确" })).item;
    const b = (await send<{ item: WorkItem }>("workItem.create", { projectId: project.id, title: "B", description: "WRITE:b.txt:B", acceptanceCriteria: "文件 B 正确" })).item;
    await confirmDesign(send, a); await confirmDesign(send, b);
    const startA = clientCommandSchema.parse({ id: "c1", operationId: randomUUID(), type: "workItem.start", payload: { id: a.id } });
    const startB = clientCommandSchema.parse({ id: "c1", operationId: randomUUID(), type: "workItem.start", payload: { id: b.id } });
    await service.handleCommand(startA); await service.handleCommand(startB);
    await expect.poll(async () => {
      const state = await send<WorkflowProjectState>("workflow.state", { projectId: project.id });
      return state.tickets.filter((ticket) => [a.id, b.id].includes(ticket.itemId) && ticket.status === "finished").length;
    }, { timeout: 10000 }).toBe(2);
    const state = await send<WorkflowProjectState>("workflow.state", { projectId: project.id });
    expect(state.workspaces).toHaveLength(2); expect(service.supervisor.runningCount()).toBe(0);
    expect(state.events.filter((event) => event.type === "conversation.captured")).toHaveLength(2);
    const details = await send<{ runs: Array<{ status: string }> }>("workItem.details", { id: b.id });
    expect(details.runs[0]?.status).toBe("succeeded");
    await service.handleCommand(startA);
    expect((await send<WorkflowProjectState>("workflow.state", { projectId: project.id })).tickets).toHaveLength(2);
    const feedback = clientCommandSchema.parse({ id: "c1", operationId: randomUUID(), type: "workItem.feedback", payload: { id: a.id, text: "verify again" } });
    const concurrentStart = clientCommandSchema.parse({ id: "c1", operationId: randomUUID(), type: "workItem.start", payload: { id: a.id } });
    await Promise.all([service.handleCommand(feedback), service.handleCommand(concurrentStart)]);
    await expect.poll(async () => (await send<WorkflowProjectState>("workflow.state", { projectId: project.id })).tickets.filter((ticket) => ticket.status === "finished").length, { timeout: 10000 }).toBe(3);
    await service.handleCommand(feedback);
    expect((await send<WorkflowProjectState>("workflow.state", { projectId: project.id })).tickets).toHaveLength(3);
    expect((await send<WorkflowProjectState>("workflow.state", { projectId: project.id })).tickets.at(-1)?.instruction).toContain("verify again");
    expect((await send<{ feedback: unknown[] }>("workItem.details", { id: a.id })).feedback).toHaveLength(1);
  } finally { await app.close(); }
}, 30000);

it("keeps preparation discussion read-only and carries image-only feedback into a recorded implementation round", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "qingzhou-discussion-runtime-"));
  const repository = path.join(root, "repo"); await mkdir(repository);
  await git(repository, ["init", "-b", "trunk"]); await writeFile(path.join(repository, "README.md"), "discussion\n");
  await git(repository, ["add", "."]); await git(repository, ["commit", "-m", "initial"]);
  const { app, service } = await createApp({ HOST: "127.0.0.1", PORT: "0", NODE_ENV: "test", PI_BIN: fileURLToPath(new URL("../fixtures/fake-pi.mjs", import.meta.url)), QINGZHOU_SKIP_PI_TOOLS_FETCH: "1", QINGZHOU_DATA_DIR: path.join(root, "data"), QINGZHOU_HOME_DIR: root, QINGZHOU_ALLOWED_ROOTS: root, QINGZHOU_MAX_PROCESSES: "2", QINGZHOU_MUTATIONS: "approval" });
  await app.ready();
  const send = async <T>(type: string, payload: object, taskId?: string): Promise<T> => service.handleCommand(clientCommandSchema.parse({ id: randomUUID(), operationId: randomUUID(), type, payload, taskId })) as Promise<T>;
  try {
    const { project } = await send<{ project: WorkProject }>("workProject.create", { name: "先讨论后实施", cwd: repository });
    await send("workflow.configure", { projectId: project.id, targetBranch: "trunk", concurrency: 2, checks: [] });
    const { item } = await send<{ item: WorkItem }>("workItem.create", { projectId: project.id, title: "准备需求", description: "WRITE:result.txt:implemented", acceptanceCriteria: "结果文件正确" });
    await send("workItem.discuss", { id: item.id, text: "先讨论，不允许写文件" });
    await expect.poll(async () => (await send<WorkflowProjectState>("workflow.state", { projectId: project.id })).tickets.at(-1)?.status, { timeout: 10000 }).toBe("finished");
    let state = await send<WorkflowProjectState>("workflow.state", { projectId: project.id });
    expect(state.tickets[0]?.phase).toBe("discussion");
    expect(state.tickets.filter((ticket) => ticket.phase === "implementation")).toHaveLength(0);
    expect(await git(state.workspaces[0]!.path, ["status", "--porcelain"])).toBe("");
    await expect(send("workflow.seal", { id: item.id, paths: [], summary: "不能将讨论算作交付" })).rejects.toThrow("请先沟通并确认当前需求范围");
    await confirmDesign(send, item);
    await send("workItem.start", { id: item.id });
    await expect.poll(async () => (await send<WorkflowProjectState>("workflow.state", { projectId: project.id })).tickets.filter((ticket) => ticket.phase === "implementation" && ticket.status === "finished").length, { timeout: 10000 }).toBe(1);
    const details = await send<{ item: WorkItem }>("workItem.details", { id: item.id });
    await send("task.activate", {}, details.item.taskId!);
    const imageId = randomUUID(); const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=", "base64");
    expect(service.storeUpload(imageId, "image/png", bytes)).toBe(true);
    await send("workItem.feedback", { id: item.id, text: "", imageIds: [imageId] });
    await expect.poll(async () => (await send<WorkflowProjectState>("workflow.state", { projectId: project.id })).tickets.filter((ticket) => ticket.phase === "implementation" && ticket.status === "finished").length, { timeout: 10000 }).toBe(2);
    state = await send<WorkflowProjectState>("workflow.state", { projectId: project.id });
    expect(state.tickets.at(-1)?.imageIds).toEqual([imageId]);
    const transcript = await send<{ messages: Array<{ role: string; images?: Array<{ dataUrl?: string }> }> }>("workflow.transcript", { runId: state.tickets.at(-1)!.runId });
    expect(transcript.messages.some((message) => message.role === "user" && message.images?.some((image) => image.dataUrl?.startsWith("data:image/png;base64,")))).toBe(true);
    await expect(send("workItem.feedback", { id: item.id, text: "丢失附件", imageIds: [randomUUID()] })).rejects.toThrow("附件已过期");
  } finally { await app.close(); }
}, 30000);

async function confirmDesign(send: <T>(type: string, payload: object) => Promise<T>, item: WorkItem) {
  const state = await send<WorkflowProjectState>("workflow.state", { projectId: item.projectId });
  const scope = state.scopes.filter((entry) => entry.itemId === item.id).at(-1)!;
  await send("workflow.scope.confirm", { id: item.id, scopeId: scope.id });
  const { prd } = await send<{ prd: RequirementPrd }>("workflow.prd.save", { id: item.id, scopeId: scope.id, expectedPrdId: null, content: `# ${item.title}\n方案与回归测试`, reason: "初始设计", moduleChanges: [] });
  await send("workflow.prd.confirm", { id: item.id, prdId: prd.id });
}
