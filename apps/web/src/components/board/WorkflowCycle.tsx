import { useState } from "react";
import type { WorkflowProjectState } from "@qingzhou/protocol";
import { socketClient } from "../../transport/socket-client";

export function WorkflowCycle({ state, itemId, canStart, onRefresh }: { state: WorkflowProjectState; itemId: string; canStart: boolean; onRefresh: () => Promise<void> }) {
  const cycle = state.cycles?.findLast((entry) => entry.itemId === itemId);
  const active = cycle && ["running", "verifying"].includes(cycle.status);
  const [maxRepairs, setMaxRepairs] = useState(2);
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const act = async (cancel: boolean) => {
    setBusy(true); setError("");
    try { await socketClient.send(cancel ? "workflow.cycle.cancel" : "workflow.cycle.start", { id: itemId, maxRepairs }); await onRefresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "操作失败"); } finally { setBusy(false); }
  };
  const labels = { running: "实施与修复中", verifying: "封存与验证中", ready_for_review: "验证通过，等待人工验收", paused: "自动推进暂停", cancelled: "已停止自动推进", interrupted: "重启中断，待检查现场" };
  if (!cycle && !canStart) return null;
  return <section className="workflow-design-note mb-4" aria-label="实施并验证">
    {cycle ? <p role="status">{labels[cycle.status]} · 已修复 {cycle.repairs}/{cycle.maxRepairs} 轮{cycle.error ? ` · ${cycle.error}` : ""}</p> : null}
    {active ? <button className="btn btn-secondary" disabled={busy} onClick={() => void act(true)}>停止自动推进，保留当前轮次</button> : canStart ? <details><summary>实施并验证</summary>
      <p>完成后封存当前需求全部改动并运行项目检查；失败时按上限继续修复。通过后等待你验收，不自动固化或合入。</p>
      <label className="block">最多自动修复<select aria-label="最多自动修复轮次" className="field ml-2" value={maxRepairs} onChange={(event) => setMaxRepairs(Number(event.target.value))}>{[0, 1, 2, 3].map((value) => <option key={value} value={value}>{value} 轮</option>)}</select></label>
      <label className="flex gap-2 mt-2"><input type="checkbox" checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} />授权本需求的实施、全部改动封存、检查及限定次数修复</label>
      <button className="btn btn-primary mt-2" disabled={busy || !authorized} onClick={() => void act(false)}>开始实施并验证</button></details> : null}
    {error ? <p role="alert" className="text-danger">{error}</p> : null}
  </section>;
}
