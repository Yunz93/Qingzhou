import { useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type { WorkflowProjectState, WorkItemSummary } from "@qingzhou/protocol";
import { GitBranch, Play, Settings2, ShieldCheck } from "lucide-react";
import { requirementStatus, attemptLabels } from "../../lib/requirement-state";
import { checkLabels } from "../../lib/workflow-presentation";
import { useViewPreference } from "../../hooks/useViewPreference";
import { useWorkflowAction } from "../../hooks/useWorkflowAction";
import { socketClient } from "../../transport/socket-client";
import { WorkflowMenu, WorkflowModal, WorkflowTabs } from "./WorkflowTabs";
import { AttentionInbox, useAttentionItems } from "./AttentionInbox";
import { WorkflowSettings } from "./WorkflowSettings";
import { VerificationDetails } from "./VerificationDetails";
import { ProjectStandard } from "./ProjectStandard";
import { ModuleDocuments } from "./ModuleDocuments";
import { WorkflowHistory } from "./WorkflowHistory";

export function ProjectWorkflow({ projectId, state, items, onRefresh, onSelect, children }: {
  projectId: string; state: WorkflowProjectState; items: WorkItemSummary[];
  onRefresh: () => Promise<void>; onSelect: (item: WorkItemSummary, panel?: string) => void; children?: ReactNode;
}) {
  const [settings, setSettings] = useState(false);
  const [standard, setStandard] = useState(false);
  const [params, setParams] = useSearchParams();
  const [savedView, saveView] = useViewPreference(`qingzhou:project-view:${projectId}`, "requirements");
  const view = params.get("projectView") || savedView;
  const setView = (next: string) => { saveView(next); setParams((previous) => { previous.set("projectView", next); return previous; }, { replace: true }); };
  const [runtimeOpen, setRuntimeOpen] = useState(false);
  const [evidence, setEvidence] = useState(false);
  const { busy, error, run: action } = useWorkflowAction(projectId);
  const config = state.configs[0];
  const active = items.filter((item) => item.state !== "archived");
  const statuses = active.map((item) => requirementStatus(state, item));
  const running = state.queue?.running ?? statuses.filter((status) => status.ticket?.status === "running").length;
  const queued = statuses.filter((status) => status.ticket?.status === "queued").length;
  const attention = useAttentionItems(state, items).length;
  const integrations = state.integrations.filter((attempt) => !["merged", "cancelled", "stale"].includes(attempt.status));
  const run = (type: "workflow.pause" | "workflow.verifyMain", payload: object) => action(
    () => socketClient.send(type, payload), onRefresh);
  return <section aria-label="项目编排" className="workflow-project">
    {!config ? <div className="workflow-overview"><div className="workflow-project-heading"><div><h2>项目设置</h2><p className="text-sm text-mute">选择集成分支和项目检查。</p></div><button className="btn btn-secondary" onClick={() => setSettings(true)}><Settings2 size={14} />配置工作模式</button></div></div> : null}
    {error ? <p role="alert" className="my-2 text-sm text-danger">{error}</p> : null}
    {config ? <>
      <div className="workflow-project-navigation">
        <WorkflowTabs id="project" label="项目视图" value={view} onChange={setView} tabs={[
          { id: "requirements", label: "需求" }, { id: "attention", label: "待我处理", count: attention }, { id: "integration", label: "集成队列", count: integrations.length }, { id: "modules", label: "模块文档" }, { id: "history", label: "项目历史" },
        ]} />
        <div className="flex shrink-0 items-center">
          <button className="icon-btn" aria-label="编排设置" title="编排设置" onClick={() => setSettings(true)}><Settings2 size={14} /></button>
          <WorkflowMenu label="项目更多操作" actions={[
            { label: "运行详情", run: () => setRuntimeOpen(!runtimeOpen) },
            { label: "验证当前主线", disabled: busy || ["running", "queued"].includes(state.mainVerification?.status ?? ""), run: () => void run("workflow.verifyMain", { projectId }) },
            { label: config.paused ? "恢复队列" : "暂停后续执行", disabled: busy, run: () => void run("workflow.pause", { projectId, paused: !config.paused }) },
          ]} />
        </div>
      </div>
      {config.paused ? <div className="workflow-runtime-notice"><span>队列已暂停</span><button className="btn btn-secondary" disabled={busy} onClick={() => void run("workflow.pause", { projectId, paused: false })}><Play size={14} />恢复队列</button></div> : null}
      {running > 0 ? <p className="workflow-runtime-notice">{running} 项运行中{queued ? ` · ${queued} 项排队` : ""}</p> : null}
      {state.mainVerification && ["failed", "interrupted"].includes(state.mainVerification.status) ? <p className="workflow-runtime-notice text-danger" role="alert">{checkLabels[state.mainVerification.status]}<button className="btn btn-ghost" onClick={() => { setRuntimeOpen(true); setEvidence(true); }}>查看检查结果</button></p> : null}
      {runtimeOpen ? <details className="workflow-project-caption" open onToggle={(event) => { if (!event.currentTarget.open) setRuntimeOpen(false); }}><summary>运行详情</summary>
        <p className="mt-2"><strong>{config.targetBranch}</strong> · 主线版本 <code>{state.head?.slice(0, 8) ?? "版本不可用"}</code></p>
        <div className="workflow-project-metrics" aria-label="项目进度">
          <button onClick={() => { setView("requirements"); setParams((previous) => { previous.set("status", "active"); return previous; }); }}><strong>{active.length}</strong><span>未归档需求</span></button><button onClick={() => setView("requirements")}><strong>{state.queue?.used ?? running}<small> / {config.concurrency}</small></strong><span>执行名额占用</span></button>
          {queued > 0 ? <button onClick={() => setView("requirements")}><strong>{queued}</strong><span>排队等待</span></button> : null}<button onClick={() => setView("attention")}><strong>{attention}</strong><span>待我处理</span></button>
        </div>
        <button className="workflow-health" onClick={() => setEvidence(!evidence)} aria-expanded={evidence}><ShieldCheck size={13} />{state.mainVerification ? checkLabels[state.mainVerification.status] : "主线未验证"}</button>
        <p className="mt-2">当前范围检查有效 {active.filter((item) => requirementStatus(state, item).valid).length} · 当前范围已合入 {active.filter((item) => requirementStatus(state, item).merged).length} · 并发上限 {config.concurrency}</p>
        <p className="mt-1">实施/讨论 {running} · 验证 {state.queue?.verifying ?? 0} · 准备 {state.queue?.reserved ?? 0}；等待验收不占执行名额。</p>
        {evidence ? <section className="mt-3" aria-label="主线检查证据"><VerificationDetails result={state.mainVerification ?? undefined} /></section> : null}
      </details> : null}
      {state.mainVerification && state.queue?.resourceWaits[state.mainVerification.id] ? <p className="workflow-runtime-notice">主线验证等待独占资源：{state.queue.resourceWaits[state.mainVerification.id]}</p> : null}
      <div role="tabpanel" id="project-panel-requirements" aria-labelledby="project-tab-requirements" hidden={view !== "requirements"}>{children}</div>
      <div role="tabpanel" id="project-panel-attention" aria-labelledby="project-tab-attention" hidden={view !== "attention"}><AttentionInbox state={state} items={items} onSelect={onSelect} /></div>
      <div role="tabpanel" id="project-panel-integration" aria-labelledby="project-tab-integration" hidden={view !== "integration"}>
        <IntegrationQueue state={state} items={items} onRefresh={onRefresh} onSelect={onSelect} />
        {!integrations.length ? <div className="workflow-empty"><GitBranch size={28} /><h3>主线正在等待下一份交付</h3><p>在需求工作区完成验证和验收后，选择“准备合入这个交付”。</p><button className="btn btn-secondary" onClick={() => setView("requirements")}>回到需求</button></div> : null}
      </div>
      <div role="tabpanel" id="project-panel-modules" aria-labelledby="project-tab-modules" hidden={view !== "modules"}><ModuleDocuments state={state} items={items} projectId={projectId} onRefresh={onRefresh} onSelect={onSelect} /></div>
      <div role="tabpanel" id="project-panel-history" aria-labelledby="project-tab-history" hidden={view !== "history"}><WorkflowHistory state={state} items={items} onSelect={onSelect} onRefresh={onRefresh} expanded /></div>
    </> : null}
    {settings ? <WorkflowModal inactive={standard} title={config ? "项目编排设置" : "配置工作模式"} onClose={() => setSettings(false)}><WorkflowSettings key={projectId} projectId={projectId} state={state} onOpenStandard={() => setStandard(true)} onSaved={async () => { await onRefresh(); setSettings(false); }} /></WorkflowModal> : null}
    {standard ? <ProjectStandard projectId={projectId} onClose={() => setStandard(false)} onRefresh={onRefresh} /> : null}
  </section>;
}

function IntegrationQueue({ state, items, onRefresh, onSelect }: { state: WorkflowProjectState; items: WorkItemSummary[]; onRefresh: () => Promise<void>; onSelect: (item: WorkItemSummary, panel?: string) => void }) {
  const queue = state.integrations.filter((attempt) => !["merged", "cancelled", "stale"].includes(attempt.status));
  const { busy, error, run } = useWorkflowAction(state.configs[0]?.projectId ?? "");
  return queue.length ? <section className="workflow-integration-queue" aria-label="集成队列"><h3 className="sr-only">集成队列 · 与实施顺序独立</h3>
    <ol>{queue.map((attempt, index) => <li key={attempt.id} className="workflow-integration-card">
      <span className="workflow-queue-number">{index + 1}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><button className="font-medium" onClick={() => { const item = items.find((entry) => entry.id === attempt.itemId); if (item) onSelect(item, "delivery"); }}>{items.find((item) => item.id === attempt.itemId)?.title ?? "历史需求"}</button><span className="workflow-integration-status">{attemptLabels[attempt.status]}</span></div>
        <p className="mt-2 text-xs text-mute">{attempt.targetBranch} · 基线 {attempt.baseline?.slice(0, 8) ?? "等待准备"} · 候选 {attempt.candidate?.slice(0, 8) ?? "等待生成"}</p>
        {attempt.error ? <p className="mt-2 text-xs text-danger">{attempt.error}</p> : null}</div>
      <button className="btn btn-secondary" onClick={() => { const item = items.find((entry) => entry.id === attempt.itemId); if (item) onSelect(item, "delivery"); }}>{attempt.status === "conflicts" || attempt.status === "failed" ? "处理集成" : attempt.status === "ready" ? "审阅候选" : "查看进展"}</button>
      {attempt.status === "queued" && index > 0 && queue[index - 1]?.status === "queued" ? <button className="btn btn-ghost" disabled={busy} onClick={() => void run(() => socketClient.send("workflow.integration.reorder", { id: attempt.id, beforeId: queue[index - 1]!.id }), onRefresh)}>上移</button> : null}
    </li>)}</ol>{error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}</section> : null;
}
