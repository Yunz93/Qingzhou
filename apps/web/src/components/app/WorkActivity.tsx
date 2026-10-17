import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { WorkflowProjectState } from "@qingzhou/protocol";
import { useAgentStore } from "../../stores/agent-store";
import { socketClient } from "../../transport/socket-client";
import { requirementStatus } from "../../lib/requirement-state";
import { useDialogLayer } from "../../hooks/useDialogLayer";

/** A shared inbox is visible while the user is in a different conversation. */
export function WorkActivity() {
  const items = useAgentStore((state) => state.workItems);
  const projects = useAgentStore((state) => state.workProjects);
  const connection = useAgentStore((state) => state.connection);
  const approvals = useAgentStore((state) => state.pendingApprovals);
  const questions = useAgentStore((state) => state.pendingInteractions);
  const [snapshots, setSnapshots] = useState<Record<string, WorkflowProjectState>>({});
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDialogLayer(ref, () => setOpen(false), open, false);
  useEffect(() => { if (!open) return; const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); }; document.addEventListener("pointerdown", outside); return () => document.removeEventListener("pointerdown", outside); }, [open]);
  useEffect(() => {
    if (connection !== "open") return;
    let current = true;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing || document.hidden) return;
      refreshing = true;
      const results = await Promise.allSettled(projects.map(async (project) => [project.id, await socketClient.send<WorkflowProjectState>("workflow.state", { projectId: project.id })] as const));
      if (current) {
        setSnapshots((previous) => ({ ...previous, ...Object.fromEntries(results.flatMap((result) => result.status === "fulfilled" ? [result.value] : [])) }));
        setError(results.some((result) => result.status === "rejected"));
      }
      refreshing = false;
    };
    const timer = setTimeout(() => void refresh(), 350);
    const poll = setInterval(() => void refresh(), 15000);
    return () => { current = false; clearTimeout(timer); clearInterval(poll); };
  }, [projects, connection, items]);
  const actions = items.filter((item) => item.state !== "archived").flatMap((item) => {
    const snapshot = snapshots[item.projectId];
    const pending = approvals.some((entry) => entry.taskId === item.taskId) ? "等待操作审批" : questions.some((entry) => entry.taskId === item.taskId) ? "等待你的回答" : null;
    const status = snapshot?.configs.length ? requirementStatus(snapshot, item) : null;
    const reason = pending ?? status?.action?.reason ?? (!status && item.latestRun?.status === "succeeded" ? "本轮结束，等待审阅" : null);
    return reason ? [{ item, reason, panel: pending ? "conversation" : status?.action?.view ?? "delivery" }] : [];
  });
  const running = items.filter((item) => item.latestRun && ["queued", "running", "waiting_approval", "waiting_input"].includes(item.latestRun.status)).length;
  if (!items.length) return null;
  return <div className="work-activity app-no-drag" ref={ref}>
    <button className="btn btn-ghost" aria-expanded={open} aria-haspopup="dialog" aria-label={`工作动态：${actions.length} 项待处理，${running} 项运行中${error ? "，部分状态待刷新" : ""}`} onClick={() => setOpen(!open)}><span>待处理 {actions.length}</span>{running ? <span className="work-activity-running">运行 {running}</span> : null}{error ? <span title="部分项目状态读取失败">· 待刷新</span> : null}</button>
    {open ? <div className="work-activity-popover" role="dialog" aria-label="跨模式工作动态"><div className="flex items-center justify-between"><strong>待我处理</strong><button className="btn btn-ghost" onClick={() => setOpen(false)}>关闭</button></div>
      {connection !== "open" ? <p role="status" className="text-sm text-mute mt-2">连接已断开，展示最近状态。</p> : null}
      {actions.length ? <ul>{actions.map(({ item, reason, panel }) => <li key={item.id}><Link to={`/board?item=${item.id}&panel=${panel === "conversation" ? "scope" : panel}`} onClick={() => setOpen(false)}><small>{projects.find((entry) => entry.id === item.projectId)?.name ?? "项目"}</small><strong>{item.title}</strong><span>{reason}</span></Link></li>)}</ul> : <p className="mt-3 text-sm text-mute">当前没有已知待处理事项。{running ? `另有 ${running} 项正在推进。` : ""}</p>}
      <Link className="btn btn-secondary mt-3" to="/board?projectView=attention" onClick={() => setOpen(false)}>打开项目待处理</Link>
    </div> : null}
  </div>;
}
