import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import console from "node:console";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { pathToFileURL, URL } from "node:url";

function sendCommand(socket, type, payload) {
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.removeEventListener("message", receive);
      reject(new Error(`旧版命令超时 ${type}`));
    }, 12_000);
    function receive(event) {
      const frame = JSON.parse(event.data);
      const reply = (frame.__batch ? frame.events : [frame]).find(entry => entry.payload?.requestId === id);
      if (!reply) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", receive);
      if (reply.type === "request.succeeded") resolve(reply.payload.data);
      else reject(new Error(`${type}: ${reply.payload.error}`));
    }
    socket.addEventListener("message", receive);
    socket.send(JSON.stringify({ id, type, payload }));
  });
}

export async function createProjectHistory(send, workspace) {
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(workspace, "README.md"), "# 升级回归项目\n");
  const git = (...args) => execFileSync("git", ["-C", workspace, ...args]);
  git("init", "-b", "integration");
  git("add", "README.md");
  git("-c", "user.name=Release Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture baseline");

  const { project } = await send("workProject.create", { name: "旧版升级回归项目", cwd: workspace });
  const projectId = project.id;
  await send("workflow.configure", { projectId, targetBranch: "integration", concurrency: 1, checks: [] });
  const { item } = await send("workItem.create", {
    projectId, cwd: workspace, title: "跨版本保留的需求", description: "验证旧项目在新窗口可继续推进",
    acceptanceCriteria: "打开已确认的 PRD 和历史事件", start: false,
  });
  const { id } = item;
  const state = await send("workflow.state", { projectId });
  const scopeId = state.scopes.find(scope => scope.itemId === id).id;
  await send("workflow.scope.confirm", { id, scopeId });
  const marker = "旧版确认的需求设计";
  const { prd } = await send("workflow.prd.save", {
    id, scopeId, expectedPrdId: null, content: `# ${marker}\n\n升级后保留这份原始手稿。`,
    reason: "旧版迁移验收设计说明", moduleChanges: [],
  });
  await send("workflow.prd.confirm", { id, prdId: prd.id });
  const final = await send("workflow.state", { projectId });
  const confirmed = final.events.find(event => event.type === "prd.confirmed" && event.subjectId === prd.id);
  const configured = final.events.find(event => event.type === "project.configured");
  assert(confirmed && configured, "缺少旧版确认或项目编排事件");
  return { project, item, prdId: prd.id, marker, confirmed, configured };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [address, home, data, fixtureFile] = process.argv.slice(2);
  const origin = new URL(address);
  assert.equal(origin.hostname, "127.0.0.1");
  assert.equal(origin.protocol, "http:");
  const response = await globalThis.fetch(origin, { signal: globalThis.AbortSignal.timeout(10_000) });
  assert(response.ok, "旧版应用页面未加载");
  const cookie = response.headers.getSetCookie().find(value => value.startsWith("qingzhou_session="))?.split(";")[0];
  assert(cookie, "旧版未签发测试会话");
  await response.arrayBuffer();
  const socket = new globalThis.WebSocket(`ws://${origin.host}/ws`, { headers: { Origin: origin.origin, Cookie: cookie } });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("旧版 WebSocket 握手超时")), 10_000);
      socket.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
      socket.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("旧版 WebSocket 握手失败")); }, { once: true });
    });
    const workspace = path.join(home, "Upgrade Project");
    const history = await createProjectHistory((type, payload) => sendCommand(socket, type, payload), workspace);
    await mkdir(path.dirname(fixtureFile), { recursive: true });
    await writeFile(fixtureFile, JSON.stringify({ home, data, workspace, ...history }));
    console.log("旧版已保存 Git 项目、需求、已确认 PRD 与编排历史。");
  } finally {
    socket.close();
  }
}
