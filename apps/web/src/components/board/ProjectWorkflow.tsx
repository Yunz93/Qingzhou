import { useSearchParams } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { verificationIsValid, type DeliveryAcceptance, type WorkflowProjectState, type WorkflowCheck, type WorkflowEvent, type WorkItemSummary, type IntegrationAttempt, type Verification, type TimelineMessage, type ToolExecution } from "@qingzhou/protocol";
import { GitBranch, Layers, LayoutGrid, List, Pause, Play, Plus, Search, Settings2, ShieldCheck } from "lucide-react";
import { requirementStatus, attemptLabels } from "../../lib/requirement-state";
export { requirementStatus } from "../../lib/requirement-state";
import { useViewPreference } from "../../hooks/useViewPreference";
import { WorkflowMenu, WorkflowModal, WorkflowTabs } from "./WorkflowTabs";
import { AttentionInbox, useAttentionItems } from "./AttentionInbox";
import { DeliveryReview } from "./DeliveryReview";
import { hasPrdDraftChanges } from "../../lib/prd-draft";
import { ProjectStandard } from "./ProjectStandard";
import { ModuleDocuments } from "./ModuleDocuments";
import { planningReady, prdFor } from "./RequirementDesign";
import { MainlineHistory } from "./MainlineHistory";
import { socketClient } from "../../transport/socket-client";
import { useAgentStore } from "../../stores/agent-store";

export function useProjectWorkflow(projectId: string | undefined) {
  const connection = useAgentStore((state) => state.connection);
  const items = useAgentStore((state) => state.workItems);
  const [snapshot, setSnapshot] = useState<{ projectId: string; value: WorkflowProjectState } | null>(null);
  const activeProject = useRef(projectId);
  activeProject.current = projectId;
  const [error, setError] = useState("");
  const generation = useRef(0);
  const invalidate = useCallback(() => { generation.current++; }, []);
  const refresh = useCallback(async () => {
    if (!projectId || activeProject.current !== projectId || connection !== "open") return;
    const request = ++generation.current;
    try {
      const value = await socketClient.send<WorkflowProjectState>("workflow.state", { projectId });
      if (request === generation.current && activeProject.current === projectId) { setSnapshot({ projectId, value }); setError(""); }
    } catch (reason) { if (request === generation.current) setError(message(reason)); }
  }, [projectId, connection]);
  useEffect(() => { setSnapshot(null); return invalidate; }, [projectId, invalidate]);
  useEffect(() => { void refresh(); }, [refresh, items]);
  useEffect(() => {
    if (connection !== "open" || !projectId) return;
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 5000);
    return () => clearInterval(timer);
  }, [connection, projectId, refresh]);
  return { state: snapshot && snapshot.projectId === projectId ? snapshot.value : null, error, refresh };
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const date = (value: string) => new Date(value).toLocaleString("zh-CN");
const checkLabels: Record<Verification["status"], string> = {
  queued: "等待验证名额",
  running: "验证中", passed: "必需检查通过", failed: "验证失败", unverified: "未验证", interrupted: "验证中断",
};

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
  const [evidence, setEvidence] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const config = state.configs[0];
  const active = items.filter((item) => item.state !== "archived");
  const statuses = active.map((item) => requirementStatus(state, item));
  const running = state.queue?.running ?? statuses.filter((status) => status.ticket?.status === "running").length;
  const queued = statuses.filter((status) => status.ticket?.status === "queued").length;
  const attention = useAttentionItems(state, items).length;
  const integrations = state.integrations.filter((attempt) => !["merged", "cancelled", "stale"].includes(attempt.status));
  const run = async (type: "workflow.pause" | "workflow.verifyMain", payload: object) => {
    setBusy(true);
    try { setError(""); await socketClient.send(type, payload); await onRefresh(); } catch (reason) { setError(message(reason)); } finally { setBusy(false); }
  };
  return <section aria-label="项目编排" className="workflow-project">
    <div className="workflow-overview">
      <div className="workflow-project-heading">
        <div><h2>项目总览</h2>
          <p className="mt-1 text-sm text-mute">{config ? "独立实施，逐项验收，按需合入。所有进展都在这里。" : "配置工作模式，让需求拥有独立工作区、验证证据和合入记录。"}</p></div>
        <div className="flex flex-wrap gap-2">{config ? <button className="btn btn-secondary" onClick={() => setStandard(true)}>项目文件与规范</button> : null}<button className="btn btn-secondary" onClick={() => setSettings(true)}><Settings2 size={14} />{config ? "编排设置" : "配置工作模式"}</button></div>
      </div>
      {config ? <>
        <div className="workflow-project-metrics" aria-label="项目进度">
          <button onClick={() => { setView("requirements"); setParams((previous) => { previous.set("status", "active"); return previous; }); }}><strong>{active.length}</strong><span>未归档需求</span></button><button onClick={() => setView("requirements")}><strong>{state.queue?.used ?? running}<small> / {config.concurrency}</small></strong><span>执行名额占用</span></button>
          <button onClick={() => setView("requirements")}><strong>{queued}</strong><span>排队等待</span></button><button className={attention ? "workflow-metric-attention" : ""} onClick={() => setView("attention")}><strong>{attention}</strong><span>待我处理</span></button>
          <button onClick={() => setView("history")}><strong>{items.filter((item) => requirementStatus(state, item).everMerged).length}</strong><span>历史合入需求</span></button>
        </div>
        <div className="workflow-mainline">
          <div className="flex min-w-0 flex-wrap items-center gap-2"><GitBranch size={14} /><strong>{config.targetBranch}</strong><code>{state.head?.slice(0, 8) ?? "版本不可用"}</code>
            <button className="workflow-health" onClick={() => setEvidence(!evidence)} aria-expanded={evidence}><ShieldCheck size={13} />{state.mainVerification ? checkLabels[state.mainVerification.status] : "主线未验证"}</button></div>
          <div className="flex flex-wrap gap-1"><button className="btn btn-ghost" disabled={busy || ["running", "queued"].includes(state.mainVerification?.status ?? "")} onClick={() => void run("workflow.verifyMain", { projectId })}>验证当前主线</button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => void run("workflow.pause", { projectId, paused: !config.paused })}>{config.paused ? <Play size={13} /> : <Pause size={13} />}{config.paused ? "恢复队列" : "暂停后续执行"}</button></div>
        </div>
        <p className="workflow-project-caption">当前范围检查有效 {active.filter((item) => requirementStatus(state, item).valid).length} · 当前范围已合入 {active.filter((item) => requirementStatus(state, item).merged).length} · 并发上限 {config.concurrency}{config.paused ? " · 后续执行已暂停" : ""}</p>
        <p className="workflow-project-caption">实施/讨论 {running} · 验证 {state.queue?.verifying ?? 0} · 准备 {state.queue?.reserved ?? 0}；等待验收不占执行名额。</p>
        {state.mainVerification && state.queue?.resourceWaits[state.mainVerification.id] ? <p className="mt-2 text-sm text-mute">主线验证等待独占资源：{state.queue.resourceWaits[state.mainVerification.id]}</p> : null}
        {evidence ? <section className="mt-3" aria-label="主线检查证据"><VerificationDetails result={state.mainVerification ?? undefined} /></section> : null}
      </> : null}
      {error ? <p role="alert" className="mt-2 text-sm text-danger">{error}</p> : null}
    </div>
    {config ? <>
      <WorkflowTabs id="project" label="项目视图" value={view} onChange={setView} tabs={[
        { id: "requirements", label: "需求", count: active.length }, { id: "attention", label: "待我处理", count: attention }, { id: "integration", label: "集成队列", count: integrations.length }, { id: "modules", label: "模块文档", count: state.modules?.length ?? 0 }, { id: "history", label: "演进与回放" },
      ]} />
      <div role="tabpanel" id="project-panel-requirements" aria-labelledby="project-tab-requirements" hidden={view !== "requirements"}>{children}</div>
      <div role="tabpanel" id="project-panel-attention" aria-labelledby="project-tab-attention" hidden={view !== "attention"}><AttentionInbox state={state} items={items} onSelect={onSelect} /></div>
      <div role="tabpanel" id="project-panel-integration" aria-labelledby="project-tab-integration" hidden={view !== "integration"}>
        <div className="workflow-view-intro"><h3>按交付选择合入顺序</h3><p>实施完成后可先保留交付。集成会基于最新主线创建候选，并重新运行组合检查。</p></div>
        <IntegrationQueue state={state} items={items} onRefresh={onRefresh} onSelect={onSelect} />
        {!integrations.length ? <div className="workflow-empty"><GitBranch size={28} /><h3>主线正在等待下一份交付</h3><p>在需求工作区完成验证和验收后，选择“准备合入这个交付”。</p><button className="btn btn-secondary" onClick={() => setView("requirements")}>回到需求</button></div> : null}
      </div>
      <div role="tabpanel" id="project-panel-modules" aria-labelledby="project-tab-modules" hidden={view !== "modules"}><ModuleDocuments state={state} items={items} projectId={projectId} onRefresh={onRefresh} onSelect={onSelect} /></div>
      <div role="tabpanel" id="project-panel-history" aria-labelledby="project-tab-history" hidden={view !== "history"}><WorkflowHistory state={state} items={items} onSelect={onSelect} onRefresh={onRefresh} expanded /></div>
    </> : null}
    {standard ? <ProjectStandard projectId={projectId} onClose={() => setStandard(false)} onRefresh={onRefresh} /> : null}
    {settings ? <WorkflowModal title={config ? "项目编排设置" : "配置工作模式"} onClose={() => setSettings(false)}><WorkflowSettings key={projectId} projectId={projectId} state={state} onSaved={async () => { await onRefresh(); setSettings(false); }} /></WorkflowModal> : null}
  </section>;
}

function WorkflowSettings({ projectId, state, onSaved }: { projectId: string; state: WorkflowProjectState; onSaved: () => Promise<void> }) {
  const config = state.configs[0];
  const [info, setInfo] = useState<{ isGit: boolean; repository?: string; branch?: string; branches?: string[]; dirty?: string[]; suggestedChecks?: WorkflowCheck[] }>();
  const [branch, setBranch] = useState(config?.targetBranch ?? "");
  const [concurrency, setConcurrency] = useState(config?.concurrency ?? 1);
  const [checks, setChecks] = useState<WorkflowCheck[]>(config?.checks ?? []);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    void socketClient.send<typeof info>("workflow.inspect", { projectId }).then((value) => {
      if (!current) return; setInfo(value); setBranch((previous) => previous || value?.branch || "");
    }).catch((reason) => { if (current) setError(message(reason)); });
    return () => { current = false; };
  }, [projectId]);
  const update = (index: number, patch: Partial<WorkflowCheck>) => setChecks(checks.map((check, position) => position === index ? { ...check, ...patch } : check));
  return <form className="workflow-settings" onSubmit={(event) => {
    event.preventDefault(); setBusy(true); setError("");
    void socketClient.send("workflow.configure", { projectId, targetBranch: branch, concurrency, checks }).then(onSaved).catch((reason) => setError(message(reason))).finally(() => setBusy(false));
  }}>
    <h3 className="text-sm font-semibold mb-2">1. 仓库与集成主线</h3>
    <p className="text-sm text-mute break-all">{info ? info.isGit ? `仓库：${info.repository}` : "目录不是可用的 Git 仓库。请先在项目中建立仓库，再配置。" : "正在检查仓库…"}</p>
    {info?.dirty?.length ? <details className="mt-2 text-sm"><summary>原目录有 {info.dirty.length} 个改动，不会复制到新工作区；合入前需自行处理</summary><pre className="workflow-code">{info.dirty.join("\n")}</pre></details> : null}
    <div className="mt-3 flex flex-wrap gap-4">
      <label className="text-sm">集成分支<select aria-label="集成分支" className="field ml-2" value={branch} onChange={(event) => setBranch(event.target.value)} required>
        <option value="">选择本地分支</option>{info?.branches?.map((name) => <option key={name}>{name}</option>)}
      </select></label>
    </div>
    <h3 className="mt-4 text-sm font-semibold">2. 项目检查</h3>
    {info?.suggestedChecks?.length ? <div className="workflow-detected-checks"><p className="text-sm">检测到 {info.suggestedChecks.length} 个仓库脚本。应用后请审阅命令，并按需要补充依赖安装与环境要求；保存设置不会立即执行。</p><button type="button" className="btn btn-secondary mt-2" onClick={() => setChecks([...checks, ...info.suggestedChecks!.filter((suggestion) => !checks.some((check) => check.id === suggestion.id || check.command === suggestion.command))])}>应用检测到的检查</button></div> : null}
    <p className="mt-1 text-sm text-mute">命令在交付或集成的工作区执行。依赖安装也应写入检查命令。临时目录独立；共享端口或数据库的检查填写相同的独占资源名，进入串行队列。请通过环境变量提供凭据。</p>
    {checks.map((check, index) => <fieldset className="workflow-check-config" key={check.id}>
      <legend className="sr-only">检查 {index + 1}</legend>
      <label>名称<input className="field w-full" value={check.name} onChange={(event) => update(index, { name: event.target.value })} required maxLength={120} /></label>
      <label>命令<input className="field w-full font-mono" value={check.command} onChange={(event) => update(index, { command: event.target.value })} required maxLength={4000} placeholder="pnpm install --frozen-lockfile && pnpm test" /></label>
      <label>独占资源<input className="field w-full" value={check.resource} onChange={(event) => update(index, { resource: event.target.value })} placeholder="例如 e2e-database，可留空" /></label>
      <label>超时（秒）<input className="field w-24" type="number" min={1} max={3600} value={check.timeoutMs / 1000} onChange={(event) => update(index, { timeoutMs: Number(event.target.value) * 1000 })} /></label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={check.required} onChange={(event) => update(index, { required: event.target.checked })} />必需检查</label>
      <button type="button" className="btn btn-ghost" onClick={() => setChecks(checks.filter((_, position) => position !== index))}>移除</button>
    </fieldset>)}
    {!checks.some((check) => check.required) ? <p className="mt-2 text-sm text-danger">未配置必需检查，交付将显示未验证，不能验收合入。</p> : null}
    <h3 className="mt-4 text-sm font-semibold">3. 执行安排</h3><div className="mt-3"><label className="text-sm">并发上限<input aria-label="并发上限" type="number" min={1} max={16} className="field ml-2 w-20" value={concurrency} onChange={(event) => setConcurrency(Number(event.target.value))} required /></label><p className="mt-2 text-sm text-mute">默认逐条执行；提高并发后可同时推进独立需求。</p></div>
    <div className="mt-3 flex gap-2"><button type="button" className="btn btn-secondary" onClick={() => setChecks([...checks, { id: crypto.randomUUID(), name: "回归检查", command: "", required: true, timeoutMs: 600000, resource: "" }])}>添加检查</button>
      <button type="submit" className="btn btn-primary" disabled={busy || !info?.isGit}>{busy ? "正在保存…" : "保存编排设置"}</button></div>
    {error ? <p role="alert" className="mt-2 text-sm text-danger">{error}</p> : null}
  </form>;
}

export function WorkflowDashboard({ state, items, onSelect, onCreate, onStart, onStop, onConversation, onArchive, onRefresh }: {
  state: WorkflowProjectState; items: WorkItemSummary[]; onSelect: (item: WorkItemSummary) => void;
  onCreate: () => void; onStart: (id: string) => void; onStop: (id: string) => void;
  onConversation: (item: WorkItemSummary) => void; onArchive: (id: string) => void; onRefresh: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const projectId = items[0]?.projectId ?? state.configs[0]?.projectId ?? "";
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useViewPreference(`qingzhou:query:${projectId}`, "");
  const [savedFilter, saveFilter] = useViewPreference(`qingzhou:filter:${projectId}`, "active");
  const filter = params.get("status") ?? savedFilter;
  const setFilter = (next: string) => { saveFilter(next); setParams((previous) => { previous.set("status", next); return previous; }, { replace: true }); };
  const [layout, setLayout] = useViewPreference(`qingzhou:layout:${projectId}`, "list");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const sorted = useMemo(() => items.slice().sort((a, b) => a.rank - b.rank), [items]);
  const statuses = useMemo(() => new Map(items.map((item) => [item.id, requirementStatus(state, item)])), [state, items]);
  const statusFor = (item: WorkItemSummary) => statuses.get(item.id)!;
  const matches = (item: WorkItemSummary, value: string) => {
    const status = statusFor(item);
    if (value === "archived") return item.state === "archived";
    if (item.state === "archived") return false;
    if (value === "attention") return !!status.action;
    if (value === "implemented") return status.valid;
    if (value === "accepted") return status.acceptance === "已验收";
    if (value === "merged") return status.merged;
    return true;
  };
  const filtered = sorted.filter((item) => matches(item, filter) && `${item.title} ${item.description}`.toLowerCase().includes(query.toLowerCase()));
  const eligible = (item: WorkItemSummary) => item.state === "open" && planningReady(state, item.id) && !!item.description.trim() && !!item.acceptanceCriteria.trim() && !["running", "queued"].includes(statusFor(item).ticket?.status ?? "");
  const selectable = filtered.filter(eligible);
  const selectedIds = selectable.filter((item) => selected.includes(item.id)).map((item) => item.id);
  const send = async (type: "workflow.enqueue" | "workItem.reorder" | "workItem.reopen", payload: object) => {
    setBusy(true);
    try { setError(""); await socketClient.send(type, payload); setSelected([]); await onRefresh(); } catch (reason) { setError(message(reason)); } finally { setBusy(false); }
  };
  const lane = (item: WorkItemSummary) => statusFor(item).lane;
  const renderItem = (item: WorkItemSummary) => {
    const status = statusFor(item);
    const waiting = (state.dependencies[item.id] ?? []).filter((id) => !state.integrations.some((attempt) => attempt.itemId === id && attempt.status === "merged"));
    const running = status.ticket?.status === "running" || status.ticket?.status === "queued";
    const visibleOrder = sorted.filter((entry) => entry.state !== "archived");
    const previous = visibleOrder[visibleOrder.findIndex((entry) => entry.id === item.id) - 1];
    return <li key={item.id} className="workflow-requirement">
      <input type="checkbox" aria-label={`选择 ${item.title}`} disabled={busy || !eligible(item)} checked={selectedIds.includes(item.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))} />
      <button className="workflow-item-main" onClick={() => onSelect(item)}>
        <span className="workflow-item-title">{item.title}</span>
        {item.description ? <span className="workflow-item-description">{item.description}</span> : null}
        {!item.description.trim() || !item.acceptanceCriteria.trim() ? <span className="mt-2 block text-xs text-mute">先讨论并完善目标与验收标准，再开始实施。</span> : null}
        <span className="workflow-item-version">{status.versionLabel}</span>
        <span className="workflow-item-states"><span data-active={running}>{status.implementation}</span><span data-active={status.acceptance === "待验收"}>{status.acceptance}</span><span data-done={status.merged}>{status.integration}</span></span>
        {waiting.length ? <span className="mt-2 block text-xs text-mute">等待前置合入：{waiting.map((id) => items.find((entry) => entry.id === id)?.title ?? id).join("、")}</span> : null}
        {state.queue?.reasons[item.id] ? <span className="mt-2 block text-xs text-mute">{state.queue.reasons[item.id]}</span> : null}
        {status.action ? <span className="mt-2 block text-xs text-accent">{status.action.reason}</span> : null}
        {status.ticket?.error ? <span className="mt-1 block text-xs text-danger">{status.ticket.error}</span> : null}
      </button>
      <div className="workflow-item-actions">
        {item.state === "archived" ? <button className="btn btn-secondary" disabled={busy} onClick={() => void send("workItem.reopen", { id: item.id })}>恢复需求</button>
          : <><button className="btn btn-secondary" onClick={() => onSelect(item)}>{["delivery", "merged"].includes(status.lane) ? "查看交付" : running ? "进入对话" : "进入工作区"}</button>
            <WorkflowMenu label={`${item.title} 的更多操作`} actions={[
              { label: running ? "停止本轮" : item.state === "completed" ? "重新打开" : "开始执行", disabled: busy || (!running && item.state === "open" && !planningReady(state, item.id)), run: () => running ? onStop(item.id) : item.state === "completed" ? void send("workItem.reopen", { id: item.id }) : onStart(item.id) },
              ...(item.taskId && !state.workspaces.some((entry) => entry.itemId === item.id && entry.removedAt) ? [{ label: "专注对话", run: () => onConversation(item) }] : []),
              { label: "上移优先级", disabled: busy || !previous, run: () => void send("workItem.reorder", { id: item.id, beforeId: previous?.id }) },
              { label: "归档需求", run: () => onArchive(item.id) },
            ]} /></>}
      </div>
    </li>;
  };
  return <section aria-label="需求列表" className="workflow-dashboard">
    <div className="workflow-list-toolbar"><div className="workflow-search"><Search size={15} /><input className="field" aria-label="搜索需求" placeholder="搜索需求和描述…" value={query} onChange={(event) => { setQuery(event.target.value); setSelected([]); }} />{query ? <button className="btn btn-ghost" onClick={() => setQuery("")}>清除</button> : null}</div>
      <div className="workflow-layout-switch" role="group" aria-label="需求展示方式"><button aria-label="列表视图" aria-pressed={layout === "list"} onClick={() => setLayout("list")}><List size={16} /></button><button aria-label="看板视图" aria-pressed={layout === "board"} onClick={() => setLayout("board")}><LayoutGrid size={16} /></button></div>
      <button className="btn btn-primary" onClick={onCreate}><Plus size={14} />新建需求</button></div>
    <div className="workflow-filter-chips" role="group" aria-label="需求状态筛选">{[{ id: "active", label: "全部" }, { id: "attention", label: "需要关注" }, { id: "implemented", label: "已实现" }, { id: "accepted", label: "已验收" }, { id: "merged", label: "已合入" }, { id: "archived", label: "归档" }].map((entry) => <button key={entry.id} aria-pressed={filter === entry.id} onClick={() => { setFilter(entry.id); setSelected([]); }}>{entry.label}<span>{items.filter((item) => matches(item, entry.id)).length}</span></button>)}</div>
    {error ? <p role="alert" className="my-2 text-sm text-danger">{error}</p> : null}
    <div className="workflow-selection-bar"><label><input type="checkbox" aria-label="选择当前可执行需求" disabled={!selectable.length || busy} checked={!!selectable.length && selectedIds.length === selectable.length} onChange={(event) => setSelected(event.target.checked ? selectable.map((item) => item.id) : [])} />{selectedIds.length ? `已选择 ${selectedIds.length} 个需求` : `${filtered.length} 个需求 · 按优先级排序`}</label>
      {selectedIds.length ? <div className="flex gap-2"><button className="btn btn-ghost" onClick={() => setSelected([])}>取消选择</button><button className="btn btn-primary" disabled={busy} onClick={() => void send("workflow.enqueue", { ids: selectedIds })}>{busy ? "正在加入队列…" : `开始所选（${selectedIds.length}）`}</button></div> : null}</div>
    {layout === "list" ? <ul className="workflow-requirements-list">{filtered.map(renderItem)}</ul> : <div className="workflow-kanban">{[{ id: "planned", label: "待推进" }, { id: "running", label: "实施中" }, { id: "delivery", label: "交付与集成" }, { id: "merged", label: "已合入" }].map((entry) => <section key={entry.id} aria-label={entry.label}><h3>{entry.label}<span>{filtered.filter((item) => lane(item) === entry.id).length}</span></h3><ul>{filtered.filter((item) => lane(item) === entry.id).map(renderItem)}</ul>{!filtered.some((item) => lane(item) === entry.id) ? <p className="workflow-lane-empty">暂无需求</p> : null}</section>)}</div>}
    {!filtered.length ? <div className="workflow-empty"><Layers size={28} /><h3>{query || filter !== "active" ? "没有匹配的需求" : "从一个具体需求开始"}</h3><p>{query || filter !== "active" ? "试试其他关键词，或清除筛选查看全部需求。" : "写下目标与验收标准，再逐步实施、验证和交付。"}</p><button className="btn btn-secondary" onClick={() => { if (query || filter !== "active") { setQuery(""); setFilter("active"); } else onCreate(); }}>{query || filter !== "active" ? "清除筛选" : "新建第一个需求"}</button></div> : null}
  </section>;
}

function IntegrationQueue({ state, items, onRefresh, onSelect }: { state: WorkflowProjectState; items: WorkItemSummary[]; onRefresh: () => Promise<void>; onSelect: (item: WorkItemSummary) => void }) {
  const queue = state.integrations.filter((attempt) => !["merged", "cancelled", "stale"].includes(attempt.status));
  const [error, setError] = useState("");
  return queue.length ? <section className="workflow-integration-queue" aria-label="集成队列"><h3 className="sr-only">集成队列 · 与实施顺序独立</h3>
    <ol>{queue.map((attempt, index) => <li key={attempt.id} className="workflow-integration-card">
      <span className="workflow-queue-number">{index + 1}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><button className="font-medium" onClick={() => { const item = items.find((entry) => entry.id === attempt.itemId); if (item) onSelect(item); }}>{items.find((item) => item.id === attempt.itemId)?.title ?? "历史需求"}</button><span className="workflow-integration-status">{attemptLabels[attempt.status]}</span></div>
        <p className="mt-2 text-xs text-mute">{attempt.targetBranch} · 基线 {attempt.baseline?.slice(0, 8) ?? "等待准备"} · 候选 {attempt.candidate?.slice(0, 8) ?? "等待生成"}</p>
        {attempt.error ? <p className="mt-2 text-xs text-danger">{attempt.error}</p> : null}</div>
      <button className="btn btn-secondary" onClick={() => { const item = items.find((entry) => entry.id === attempt.itemId); if (item) onSelect(item); }}>{attempt.status === "conflicts" || attempt.status === "failed" ? "处理集成" : attempt.status === "ready" ? "审阅候选" : "查看进展"}</button>
      {attempt.status === "queued" && index > 0 && queue[index - 1]?.status === "queued" ? <button className="btn btn-ghost" onClick={() => void socketClient.send("workflow.integration.reorder", { id: attempt.id, beforeId: queue[index - 1]!.id }).then(onRefresh).catch((reason) => setError(message(reason)))}>上移</button> : null}
    </li>)}</ol>{error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}</section> : null;
}

export function RequirementWorkflow({ state, item, items, onRefresh, view = "delivery", scopeContent }: { scopeContent?: ReactNode; view?: "delivery" | "scope" | "history" | "design"; state: WorkflowProjectState; item: WorkItemSummary; items: WorkItemSummary[]; onRefresh: () => Promise<void> }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [paths, setPaths] = useState<string[] | null>(null);
  const [loadingChanges, setLoadingChanges] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [summary, setSummary] = useState("");
  const [dependencyDraft, setDependencyDraft] = useState<string[] | null>(null);
  const [behaviors, setBehaviors] = useState("");
  const [unresolved, setUnresolved] = useState("");
  const [artifactPaths, setArtifactPaths] = useState("");
  const scopes = state.scopes.filter((scope) => scope.itemId === item.id);
  const workspace = state.workspaces.find((entry) => entry.itemId === item.id);
  const deliveries = state.deliveries.filter((entry) => entry.itemId === item.id).slice().reverse();
  const attempts = state.integrations.filter((entry) => entry.itemId === item.id).slice().reverse();
  const status = requirementStatus(state, item);
  const sendPending = useRef(false);
  const send = async (type: Parameters<typeof socketClient.send>[0], payload: object) => {
    if (sendPending.current) return;
    sendPending.current = true; setError(""); setBusy(true);
    try { await socketClient.send(type, payload); setPaths(null); setSelected([]); await onRefresh(); } catch (reason) { setError(message(reason)); } finally { sendPending.current = false; setBusy(false); }
  };
  const active = ["running", "queued"].includes(status.ticket?.status ?? "") || ["running", "queued"].includes(status.verification?.status ?? "");
  return <section className="work-panel-section" aria-label="交付与集成">
    <div hidden={view !== "delivery"}><h3 className="font-semibold">交付与集成</h3><p className="mt-2 text-sm text-mute">{status.implementation} · {status.acceptance} · {status.integration}</p></div>
    {error ? <p role="alert" className="mt-2 text-sm text-danger">{error}</p> : null}
    {status.verification && state.queue?.resourceWaits[status.verification.id] ? <p className="mt-2 text-sm text-mute">等待独占验证资源：{state.queue.resourceWaits[status.verification.id]}</p> : null}
    <div hidden={view !== "scope"} role="tabpanel" id="requirement-panel-scope" aria-labelledby="requirement-tab-scope">{scopeContent}<details open className="mt-3 text-sm"><summary>范围版本与前置需求</summary>
      {scopes.map((scope) => <details key={scope.id} className="mt-2"><summary>范围 v{scope.version} · {date(scope.createdAt)}</summary><pre className="workflow-code">{scope.title}{"\n\n"}{scope.description}{"\n\n验收标准\n"}{scope.acceptanceCriteria}</pre></details>)}
      {status.ticket?.status === "queued" ? <button className="btn btn-secondary mt-3" disabled={busy} onClick={() => void send("workItem.stop", { id: item.id })}>停止排队以调整依赖</button> : null}
      <fieldset className="mt-3 space-y-2" disabled={active || busy}><legend className="mb-2">前置需求合入后才能开工</legend>
        {items.filter((entry) => entry.id !== item.id && (entry.state !== "archived" || (state.dependencies[item.id] ?? []).includes(entry.id))).map((entry) => <label key={entry.id} className="flex items-center gap-2"><input type="checkbox" checked={(dependencyDraft ?? state.dependencies[item.id] ?? []).includes(entry.id)} onChange={(event) => { const dependencies = event.target.checked ? [...(state.dependencies[item.id] ?? []), entry.id] : (state.dependencies[item.id] ?? []).filter((id) => id !== entry.id); setDependencyDraft(dependencies); void send("workflow.dependencies", { id: item.id, dependencies }).finally(() => setDependencyDraft(null)); }} />{entry.title}{entry.state === "archived" ? " · 已归档（可取消此依赖）" : ""}</label>)}
      </fieldset>
    </details>
    {workspace ? <details className="mt-3 text-sm"><summary>工作区与基线</summary><pre className="workflow-code">{workspace.path}{"\n"}{workspace.branch}{"\n基线 "}{workspace.baseline}{workspace.removedAt ? "\n已清理，历史仍保留" : ""}</pre>
      {!workspace.removedAt && status.merged ? <button className="btn btn-secondary" disabled={busy || active} onClick={() => void send("workflow.cleanup", { id: item.id })}>清理已合入且无改动的工作区</button> : null}
    </details> : null}
    </div><div hidden={view !== "delivery"} role="tabpanel" id="requirement-panel-delivery" aria-labelledby="requirement-tab-delivery">
    <BaselineRelationship state={state} item={item} items={items} />
    {workspace && !workspace.removedAt && item.state === "open" && !prdFor(state, item.id)?.frozenAt ? <div className="mt-4">
      <button className="btn btn-secondary" disabled={busy || active || loadingChanges} onClick={() => { setError(""); setLoadingChanges(true); void socketClient.send<{ paths: string[] }>("workflow.changes", { id: item.id }).then((value) => { setPaths(value.paths); setSelected([]); }).catch((reason) => setError(message(reason))).finally(() => setLoadingChanges(false)); }}>{loadingChanges ? "正在读取改动…" : "查看本次待封存改动"}</button>
      {paths ? <div className="mt-3 rounded-lg border border-line p-3 text-sm">
        <p>核对文件归属后明确选择。交付不会复制原目录文件；来源不明的改动请先处理。</p>
        <label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={paths.length > 0 && selected.length === paths.length} onChange={(event) => setSelected(event.target.checked ? paths : [])} />确认全部改动属于本需求</label>
        {paths.map((file) => <label key={file} className="mt-2 flex items-center gap-2 break-all"><input type="checkbox" checked={selected.includes(file)} onChange={(event) => setSelected(event.target.checked ? [...selected, file] : selected.filter((entry) => entry !== file))} />{file}</label>)}
        {!paths.length ? <p className="mt-2 text-mute">没有新文件差异，可封存当前代码树以重新验证。</p> : null}
        <label className="mt-3 block">交付说明<textarea className="field mt-1 w-full" rows={2} value={summary} onChange={(event) => setSummary(event.target.value)} /></label>
        <label className="mt-3 block">本轮实现的行为<textarea className="field mt-1 w-full" rows={3} value={behaviors} maxLength={6000} onChange={(event) => setBehaviors(event.target.value)} placeholder="描述用户可观察的结果，提交后仍需人工验收。" /></label>
        <label className="mt-3 block">未完成与需人工检查<textarea className="field mt-1 w-full" rows={2} value={unresolved} maxLength={6000} onChange={(event) => setUnresolved(event.target.value)} placeholder="列出未验证的行为、限制及尚需决定的事项。" /></label>
        <label className="mt-3 block">保存到交付的产物路径<textarea className="field mt-1 w-full font-mono" rows={2} value={artifactPaths} onChange={(event) => setArtifactPaths(event.target.value)} placeholder="每行一个仓库内文件，如 screenshots/result.png。文件须已纳入本次提交，预览读取封存版本。" /></label>
        <button className="btn btn-primary mt-3" disabled={busy || selected.length !== paths.length} onClick={() => void send("workflow.seal", { id: item.id, paths: selected, summary, review: { behaviors, unresolved, artifactPaths: artifactPaths.split("\n").map((file) => file.trim()).filter(Boolean) } })}>封存所选改动并验证</button>
      </div> : null}
    </div> : null}
    <div className="mt-4 space-y-3">{deliveries.map((delivery, index) => <details key={delivery.id} open={index === 0} className="workflow-delivery"><summary>交付 {deliveries.length - index} · {delivery.commit.slice(0, 8)} · {date(delivery.createdAt)}</summary>
      <DeliveryReview state={state} delivery={delivery} previous={deliveries[index + 1]} />
      <VerificationDetails result={state.verifications.find((result) => result.id === delivery.verificationId)} />
      <details className="mt-2 text-sm"><summary>封存差异（只读）· {delivery.files.length} 个文件</summary><pre className="workflow-code">{delivery.patch || "无文件差异"}</pre></details>
      <DeliveryActions key={`${delivery.id}:${delivery.scopeId}`} state={state} deliveryId={delivery.id} current={index === 0 && status.valid} busy={busy} send={send} />
    </details>)}</div>
    {attempts.map((attempt) => <IntegrationDetails key={`${attempt.id}:${attempt.candidate}:${attempt.verificationId}`} state={state} attempt={attempt} busy={busy} send={send} />)}
    {!deliveries.length && !workspace ? <div className="workflow-empty"><h3>交付从一次执行开始</h3><p>Agent 完成本轮后，在这里核对改动、运行检查并验收交付。</p></div> : null}
    </div><div hidden={view !== "history"} role="tabpanel" id="requirement-panel-history" aria-labelledby="requirement-tab-history"><WorkflowHistory state={state} items={items} onlyItemId={item.id} onRefresh={onRefresh} expanded /></div>
  </section>;
}

type Send = (type: Parameters<typeof socketClient.send>[0], payload: object) => Promise<void>;
function DeliveryActions({ state, deliveryId, current, busy, send }: { state: WorkflowProjectState; deliveryId: string; current: boolean; busy: boolean; send: Send }) {
  const delivery = state.deliveries.find((entry) => entry.id === deliveryId)!;
  const prd = prdFor(state, delivery.itemId);
  const unsavedDesign = (() => { try { return !!prd && hasPrdDraftChanges(sessionStorage.getItem(`qingzhou:prd-draft:${delivery.itemId}`), prd); } catch { return false; } })();
  const scope = state.scopes.find((entry) => entry.id === delivery.scopeId);
  const acceptance = state.acceptances.filter((entry) => entry.deliveryId === deliveryId).at(-1);
  const criteria = scope?.acceptanceCriteria.split("\n").map((line) => line.trim()).filter(Boolean) ?? [];
  const [checked, setChecked] = useState<number[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState(acceptance?.decision === "rejected" ? acceptance.note : "");
  const [confirmContinue, setConfirmContinue] = useState(false);
  const verification = state.verifications.find((entry) => entry.id === delivery.verificationId);
  const [evidence, setEvidence] = useState<NonNullable<DeliveryAcceptance["evidence"]>>(() => criteria.map((criterion) => ({ criterion, note: "", checkIds: [], artifactPaths: [] })));
  const updateEvidence = (index: number, patch: Partial<NonNullable<DeliveryAcceptance["evidence"]>[number]>) => setEvidence((current) => current.map((row, position) => index === position ? { ...row, ...patch } : row));
  return <div className="mt-3 text-sm">
    {acceptance ? <p>{acceptance.decision === "accepted" ? "这个版本已验收，验收不会自动合入。" : "这个版本需返工。"} · {date(acceptance.createdAt)} {acceptance.note}</p> : null}
    {current && acceptance?.decision !== "accepted" ? <><p className="mt-2 font-medium">人工验收当前范围</p>{criteria.map((criterion, index) => <div className="workflow-criterion" key={index}><label className="mt-2 flex items-start gap-2"><input type="checkbox" checked={checked.includes(index)} onChange={(event) => setChecked(event.target.checked ? [...checked, index] : checked.filter((entry) => entry !== index))} />{criterion}</label>
        <details className="mt-2"><summary>记录这条标准的验收依据</summary><label className="block mt-2">人工观察<textarea aria-label={`验收依据 ${index + 1}`} className="field w-full mt-1" rows={2} maxLength={2000} value={evidence[index]?.note ?? ""} onChange={(event) => updateEvidence(index, { note: event.target.value })} placeholder="记录观察到的行为，或引用检查和封存产物。" /></label>
        {verification?.checks.map((check) => <label className="flex items-start gap-2 mt-2" key={check.id}><input type="checkbox" checked={evidence[index]?.checkIds.includes(check.id) ?? false} onChange={(event) => updateEvidence(index, { checkIds: event.target.checked ? [...evidence[index]!.checkIds, check.id] : evidence[index]!.checkIds.filter((id) => id !== check.id) })} />引用检查：{check.name} · {check.status === "passed" ? "通过" : "未通过"}</label>)}
        {delivery.review?.artifactPaths.map((file) => <label className="flex items-start gap-2 mt-2" key={file}><input type="checkbox" checked={evidence[index]?.artifactPaths.includes(file) ?? false} onChange={(event) => updateEvidence(index, { artifactPaths: event.target.checked ? [...evidence[index]!.artifactPaths, file] : evidence[index]!.artifactPaths.filter((path) => path !== file) })} />引用产物：{file}</label>)}
        </details></div>)}
      {unsavedDesign ? <p className="workflow-design-note mt-3" role="alert">有未保存的 PRD 草稿，请回到“设计与 PRD”保存并确认，或明确放弃草稿后再验收。</p> : null}
      {prdFor(state, delivery.itemId) ? <p className="workflow-design-note mt-3">最终确认会固化本交付对应的 PRD，并发布关联模块设计。请确认实现、PRD 与模块设计已同步；后续变更通过子需求推进。</p> : null}
      <label className="mt-3 flex items-start gap-2"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />我已审阅这个交付的代码、检查证据与需人工确认的结果</label>
      <button className="btn btn-primary mt-3" disabled={busy || unsavedDesign || !reviewed || checked.length !== criteria.length} onClick={() => void send("workflow.accept", { deliveryId, decision: "accepted", note: "已逐条人工确认当前范围验收标准", evidence: evidence.map((row) => ({ ...row, note: row.note.trim() || "用户已逐条人工确认，未补充文字观察。" })) })}>{prdFor(state, delivery.itemId) ? "验收并固化 PRD" : "验收这个版本"}</button>
      <button className="btn btn-ghost mt-3 ml-2" aria-expanded={rejecting} onClick={() => setRejecting(!rejecting)}>需要调整</button>
      {rejecting ? <div className="mt-3 rounded-lg border border-line p-3"><label className="block">验收反馈<textarea className="field mt-1 w-full" rows={3} value={note} onChange={(event) => { setNote(event.target.value); setConfirmContinue(false); }} placeholder="记录未达到的标准与需要调整的结果。" /></label><p className="mt-2 text-xs text-mute">可仅记录意见，或审阅下面的反馈后直接开始新一轮实施。</p><button className="btn btn-secondary mt-3" disabled={busy || !note.trim()} onClick={() => { setReviewed(false); setChecked([]); void send("workflow.accept", { deliveryId, decision: "rejected", note: note.trim() }); }}>记录返工意见</button><button className="btn btn-primary mt-3 ml-2" disabled={busy || !note.trim()} onClick={() => setConfirmContinue(true)}>反馈并继续</button>
        {confirmContinue ? <div className="workflow-feedback-confirm mt-3"><strong>确认按以下反馈开始新一轮实施</strong><p className="whitespace-pre-wrap mt-2">{note.trim()}</p><button className="btn btn-primary mt-3" disabled={busy} onClick={() => { void send("workItem.feedback", { id: delivery.itemId, text: note.trim(), expectedDeliveryId: delivery.id }); }}>确认反馈并开始实施</button><button className="btn btn-ghost mt-3" disabled={busy} onClick={() => setConfirmContinue(false)}>返回修改</button></div> : null}
      </div> : null}</> : null}
    {acceptance?.evidence?.length ? <details className="mt-3"><summary>已保存的逐条验收依据</summary>{acceptance.evidence.map((row, index) => <div className="mt-2" key={index}><strong>{row.criterion}</strong><p>{row.note}</p><p className="text-mute">{row.checkIds.map((id) => verification?.checks.find((check) => check.id === id)?.name ?? id).join("、")}{row.artifactPaths.length ? ` · 产物 ${row.artifactPaths.join("、")}` : ""}</p></div>)}</details> : null}
    {current && acceptance?.decision === "accepted" && !state.integrations.some((entry) => entry.deliveryId === deliveryId && ["queued", "preparing", "conflicts", "verifying", "ready", "merging", "merged"].includes(entry.status)) ? <button className="btn btn-primary mt-3" disabled={busy} onClick={() => void send("workflow.integrate", { deliveryId })}>准备合入这个交付</button> : null}
  </div>;
}

function IntegrationDetails({ state, attempt, busy, send }: { state: WorkflowProjectState; attempt: IntegrationAttempt; busy: boolean; send: Send }) {
  const [reviewed, setReviewed] = useState(false);
  const [instruction, setInstruction] = useState("");
  const repairable = ["conflicts", "failed", "ready"].includes(attempt.status);
  const config = state.configs[0];
  const delivery = state.deliveries.find((entry) => entry.id === attempt.deliveryId);
  const workspace = state.workspaceStates[attempt.itemId];
  const readyCurrent = attempt.baseline === state.head && !!config && !!attempt.tree && !!delivery && !!workspace && workspace.head === delivery.commit && !workspace.dirty
    && verificationIsValid(state.verifications.find((entry) => entry.id === attempt.verificationId), config, attempt.tree);
  return <details className="workflow-delivery mt-3" open={!["merged", "cancelled"].includes(attempt.status)}><summary>集成 · {attemptLabels[attempt.status]} · {date(attempt.createdAt)}</summary>
    <p className="mt-2 text-sm">目标 {attempt.targetBranch} · 基线 {attempt.baseline?.slice(0, 8) ?? "待准备"} · 候选 {attempt.candidate?.slice(0, 8) ?? "待生成"}</p>
    {attempt.error ? <p className="mt-2 text-sm text-danger">{attempt.error}</p> : null}
    {attempt.conflicts.length ? <pre className="workflow-code">{attempt.conflicts.join("\n")}</pre> : null}
    {attempt.workspace ? <details className="mt-2 text-sm"><summary>隔离集成目录</summary><pre className="workflow-code">{attempt.workspace}</pre></details> : null}
    {attempt.verificationId && state.queue?.resourceWaits[attempt.verificationId] ? <p className="mt-2 text-sm text-mute">等待独占验证资源：{state.queue.resourceWaits[attempt.verificationId]}</p> : null}
    <VerificationDetails result={state.verifications.find((entry) => entry.id === attempt.verificationId)} />
    <details className="mt-2 text-sm"><summary>候选相对源交付的组合变化（含主线与冲突修复）</summary><pre className="workflow-code">{attempt.patch || "尚无已封存候选差异"}</pre></details>
    {repairable ? <details className="mt-3" open={attempt.status !== "ready"}><summary className="text-sm">{attempt.status === "ready" ? "需要调整候选？展开修复操作" : "处理集成候选"}</summary><div className="mt-3"><label className="text-sm">集成反馈<textarea className="field mt-1 w-full" rows={2} value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="需要产品取舍时说明处理方向" /></label>
      <div className="mt-2 flex flex-wrap gap-2"><button className="btn btn-secondary" disabled={busy} onClick={() => void send("workflow.integration.repair", { id: attempt.id, instruction })}>在原对话处理候选</button><button className="btn btn-secondary" disabled={busy} onClick={() => void send("workflow.integration.recheck", { id: attempt.id })}>封存候选并重新验证</button></div></div></details> : null}
    {attempt.status === "ready" && !readyCurrent ? <p className="mt-3 text-sm text-danger" role="status">候选依据已变化。请取消旧候选后基于最新主线重新准备；当前候选不能直接合入。</p> : null}
    {attempt.status === "ready" && readyCurrent ? <div className="mt-3"><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />我已审阅组合后的候选与验证结果，确认将此版本合入主线</label>
      <button className="btn btn-primary mt-3" disabled={busy || !reviewed} onClick={() => void send("workflow.integration.merge", { id: attempt.id })}>确认合入 {attempt.targetBranch}</button></div> : null}
    {!["merged", "merging", "preparing", "verifying", "cancelled"].includes(attempt.status) ? <button className="btn btn-ghost mt-3" disabled={busy} onClick={() => void send("workflow.integration.cancel", { id: attempt.id })}>取消集成，保留现场</button> : null}
    {["stale", "failed", "cancelled"].includes(attempt.status) ? <button className="btn btn-secondary mt-3" disabled={busy} onClick={() => void send("workflow.integrate", { deliveryId: attempt.deliveryId })}>基于最新主线重新准备</button> : null}
  </details>;
}

function VerificationDetails({ result }: { result: Verification | undefined }) {
  if (!result) return <p className="mt-2 text-sm text-mute">尚无检查证据</p>;
  return <div className="mt-2 text-sm"><p>{checkLabels[result.status]} · 配置 v{result.configRevision} · {result.environment}</p>
    {result.error ? <p className="mt-2 text-danger">{result.error}</p> : null}
    {result.checks.map((check, index) => <details className="mt-2" key={`${check.id}:${index}`}><summary>{check.name} · {check.required ? "必需" : "非必需"} · {check.status === "passed" ? "通过" : check.status === "running" ? "执行中" : "失败或中断"} · 退出码 {check.exitCode ?? "无"}</summary>
      <pre className="workflow-code">{check.command}{"\n"}{check.cwd}{"\n"}{date(check.startedAt)}{check.finishedAt ? ` → ${date(check.finishedAt)}` : ""}{"\n\n"}{check.output || "暂无输出"}{check.truncated ? "\n[日志超出长度，已截断]" : ""}</pre></details>)}
  </div>;
}

export function WorkflowHistory({ state, items, onlyItemId, onSelect, onRefresh, expanded = false }: { expanded?: boolean; state: WorkflowProjectState; items: WorkItemSummary[]; onlyItemId?: string; onSelect?: (item: WorkItemSummary) => void; onRefresh?: () => Promise<void> }) {
  const replayRequest = useRef(0);
  const replayRef = useRef<HTMLElement>(null);
  const [transcript, setTranscript] = useState<{ messages: TimelineMessage[]; tools: ToolExecution[] } | null>(null);
  const [itemFilter, setItemFilter] = useState(onlyItemId ?? "");
  const [typeFilter, setTypeFilter] = useState("");
  const [selected, setSelected] = useState<WorkflowEvent | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const selectEvent = (event: WorkflowEvent | null) => { if (replayRef.current) replayRef.current.scrollTop = 0; replayRequest.current++; setSelected(event); setTranscript(null); setError(""); setBusy(false); };
  const events = state.events.filter((event) => (!itemFilter || event.itemId === itemFilter) && (!typeFilter || event.type.startsWith(typeFilter))).slice().reverse();
  const attempt = selected?.facts?.integration ?? state.integrations.find((entry) => entry.id === selected?.subjectId);
  const delivery = state.deliveries.find((entry) => entry.id === selected?.subjectId || entry.id === attempt?.deliveryId);
  const acceptance = state.acceptances.find((entry) => entry.id === selected?.subjectId);
  const ticket = selected?.facts?.ticket ?? state.tickets.find((entry) => entry.id === selected?.subjectId);
  const scopeId = delivery?.scopeId ?? ticket?.scopeId ?? acceptance?.scopeId;
  const scope = state.scopes.find((entry) => entry.id === scopeId || entry.id === selected?.subjectId);
  const verification = state.verifications.find((entry) => entry.id === selected?.subjectId || entry.id === delivery?.verificationId || entry.id === attempt?.verificationId);
  return <details open={expanded || undefined} className="workflow-history mt-4 border-t border-line pt-3"><summary className="text-sm font-semibold">{onlyItemId ? "需求历史与只读回放" : "项目演进时间线"} · {events.length}</summary>
    {!onlyItemId ? <MainlineHistory state={state} items={items} onSelect={onSelect} /> : null}
    <div className="mt-3 flex flex-wrap gap-2">{!onlyItemId ? <select className="field text-sm" aria-label="按需求筛选历史" value={itemFilter} onChange={(event) => { setItemFilter(event.target.value); selectEvent(null); }}><option value="">全部需求</option>{items.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select> : null}
      <select className="field text-sm" aria-label="按事件筛选历史" value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); selectEvent(null); }}><option value="">全部事件</option><option value="scope.">范围变更</option><option value="run.">执行</option><option value="delivery.">交付与验收</option><option value="integration.">集成</option><option value="verification.">验证</option><option value="main.">主线变化</option></select></div>
    <div className="workflow-history-layout"><ol className="workflow-timeline mt-3">{events.filter((event) => event.type !== "delivery.request").map((event) => <li key={event.id}>
      <button className="w-full text-left text-sm" aria-pressed={selected?.id === event.id} onClick={() => selectEvent(event)}><time className="block text-xs text-mute">#{event.sequence} · {date(event.createdAt)} · {items.find((item) => item.id === event.itemId)?.title ?? "项目"}</time><span className="mt-1 block">{event.message}</span></button>
    </li>)}</ol>
    {selected ? <section ref={replayRef} className="workflow-replay mt-3" aria-label="只读历史回放"><div className="flex justify-between gap-2"><h4 className="font-medium">只读回放 · #{selected.sequence}</h4><button className="btn btn-ghost" onClick={() => selectEvent(null)}>关闭回放</button></div>
      <p className="mt-2 text-sm">{selected.message}</p>
      {scope ? <pre className="workflow-code">范围 v{scope.version}{"\n"}{scope.title}{"\n\n"}{scope.description}{"\n\n"}{scope.acceptanceCriteria}</pre> : null}
      {ticket ? <pre className="workflow-code">{ticket.phase === "integration" ? "集成处理" : "需求实施"}{"\n"}执行记录：{ticket.runId ?? "尚未开始"}{"\n"}{ticket.instruction}</pre> : null}
      {delivery ? <><p className="mt-2 text-sm">交付 {delivery.commit} · 执行记录 {delivery.runId ?? "无"}</p><pre className="workflow-code">{delivery.patch || "无差异"}</pre></> : null}
      {attempt ? <><p className="mt-2 text-sm">主线节点：{attempt.mergedCommit ?? attempt.candidate ?? "尚无候选"} · {attemptLabels[attempt.status]}</p><pre className="workflow-code">{attempt.patch || "无差异"}</pre></> : null}
      {attempt?.includedItemIds?.length ? <p className="mt-2 text-sm">该版本已包含：{attempt.includedItemIds.map((id) => items.find((item) => item.id === id)?.title ?? id).join("、")}</p> : null}
      {acceptance ? <p className="mt-2 text-sm">{acceptance.decision === "accepted" ? "验收通过" : "需返工"} · {acceptance.note}</p> : null}
      {verification ? <VerificationDetails result={verification} /> : null}
      {(ticket?.runId || delivery?.runId || selected.type === "conversation.captured") ? <button className="btn btn-secondary mt-3" disabled={busy} onClick={() => {
        setBusy(true); setError(""); const request = ++replayRequest.current;
        void socketClient.send<{ messages: TimelineMessage[]; tools: ToolExecution[] }>("workflow.transcript", { runId: ticket?.runId ?? delivery?.runId ?? selected.subjectId })
          .then((value) => { if (request === replayRequest.current) setTranscript(value); }).catch((reason) => { if (request === replayRequest.current) setError(message(reason)); }).finally(() => { if (request === replayRequest.current) setBusy(false); });
      }}>只读回放本轮对话</button> : null}
      {transcript ? <div className="mt-3">{transcript.messages.map((entry) => <article className="mt-3" key={entry.id}><p className="text-sm font-medium">{entry.role === "user" ? "用户" : entry.role === "assistant" ? "助手" : entry.role}</p><pre className="workflow-code">{entry.text}</pre></article>)}
        <details className="mt-3 text-sm"><summary>本轮保存的工具记录 · {transcript.tools.length}</summary>{transcript.tools.map((tool) => <pre className="workflow-code" key={tool.toolCallId}>{tool.toolName} · {tool.status}{"\n"}{JSON.stringify(tool, null, 2)}</pre>)}</details></div> : null}
      {selected.type === "main.merged" && attempt?.status === "merged" ? <button className="btn btn-secondary mt-3" disabled={busy} onClick={() => {
        setBusy(true); setError("");
        void socketClient.send("workflow.revert", { integrationId: attempt.id }).then(onRefresh).catch((reason) => setError(message(reason))).finally(() => setBusy(false));
      }}>创建撤销需求，保留后续主线</button> : null}
      {error ? <p role="alert" className="mt-2 text-sm text-danger">{error}</p> : null}
      {onSelect && selected.itemId ? <button className="btn btn-secondary mt-3" onClick={() => { const item = items.find((entry) => entry.id === selected.itemId); if (item) onSelect(item); }}>打开当前需求工作间</button> : null}
    </section> : <div className="workflow-empty"><h3>选择一个节点，回看当时的交付</h3><p>范围、对话、代码差异与检查证据按发生时的版本保留。</p></div>}
    </div>
  </details>;
}

function BaselineRelationship({ state, item, items }: { state: WorkflowProjectState; item: WorkItemSummary; items: WorkItemSummary[] }) {
  const relation = state.baselineRelations?.[item.id];
  const status = requirementStatus(state, item);
  const workspace = state.workspaces.find((entry) => entry.itemId === item.id);
  if (!workspace || status.merged || !relation?.behind) return null;
  const combinationPassed = status.attempt?.status === "ready" && status.attempt.baseline === state.head;
  return <section className="workflow-baseline mt-3" aria-label="需求与最新主线的关系"><h4>主线已变化</h4><p className="mt-2 text-sm">需求基线 {workspace.baseline.slice(0, 8)} · 当前主线 {state.head?.slice(0, 8)}。</p>
    {relation.includedItemIds.length ? <p className="mt-2 text-sm">主线此后已合入：{relation.includedItemIds.map((id) => items.find((entry) => entry.id === id)?.title ?? id).join("、")}。</p> : null}
    <p className="mt-2 text-sm">{combinationPassed ? "当前候选已基于此主线完成组合验证，等待确认合入。" : "源交付的检查不代表最新组合已通过；验收后准备候选，处理冲突并运行组合回归。"}</p>{relation.error ? <p role="alert" className="text-danger">{relation.error}</p> : null}
  </section>;
}
