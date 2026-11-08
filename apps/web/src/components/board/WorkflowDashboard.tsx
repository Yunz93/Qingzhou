import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { WorkflowProjectState, WorkItemSummary } from "@qingzhou/protocol";
import { Layers, LayoutGrid, List, Plus, Search } from "lucide-react";
import { requirementStatus } from "../../lib/requirement-state";
import { planningReady } from "../../lib/requirement-planning";
import { useViewPreference } from "../../hooks/useViewPreference";
import { useWorkflowAction } from "../../hooks/useWorkflowAction";
import { socketClient } from "../../transport/socket-client";
import { WorkflowMenu } from "./WorkflowTabs";

export function WorkflowDashboard({ state, items, onSelect, onCreate, onStart, onStop, onConversation, onArchive, onRefresh }: {
  state: WorkflowProjectState; items: WorkItemSummary[]; onSelect: (item: WorkItemSummary, panel?: string) => void;
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
  const { busy, error, run } = useWorkflowAction(projectId);
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
  const send = (type: "workflow.enqueue" | "workItem.reorder" | "workItem.reopen", payload: object) => run(
    () => socketClient.send(type, payload), async () => { setSelected([]); await onRefresh(); });
  const lane = (item: WorkItemSummary) => statusFor(item).lane;
  const renderItem = (item: WorkItemSummary) => {
    const status = statusFor(item);
    const waiting = (state.dependencies[item.id] ?? []).filter((id) => !state.integrations.some((attempt) => attempt.itemId === id && attempt.status === "merged"));
    const running = status.ticket?.status === "running" || status.ticket?.status === "queued";
    const visibleOrder = sorted.filter((entry) => entry.state !== "archived");
    const previous = visibleOrder[visibleOrder.findIndex((entry) => entry.id === item.id) - 1];
    return <li key={item.id} className="workflow-requirement">
      {items.length > 1 ? <input type="checkbox" aria-label={`选择 ${item.title}`} disabled={busy || !eligible(item)} checked={selectedIds.includes(item.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))} /> : null}
      <button className="workflow-item-main" onClick={() => onSelect(item)}>
        <span className="workflow-item-title">{item.title}</span>
        {item.description ? <span className="workflow-item-description">{item.description}</span> : null}
        {!item.description.trim() || !item.acceptanceCriteria.trim() ? <span className="mt-2 block text-xs text-mute">先讨论并完善目标与验收标准，再开始实施。</span> : null}
        <span className="workflow-item-states"><span data-active={running || status.valid} data-done={status.merged}>{status.merged ? "已合入" : status.acceptance === "需返工" ? "需返工" : status.acceptance === "已验收" ? "待合入" : status.valid ? "待验收" : status.implementation}</span></span>
        {waiting.length ? <span className="mt-2 block text-xs text-mute">等待前置合入：{waiting.map((id) => items.find((entry) => entry.id === id)?.title ?? id).join("、")}</span> : null}
        {state.queue?.reasons[item.id] ? <span className="mt-2 block text-xs text-mute">{state.queue.reasons[item.id]}</span> : null}
        {status.action ? <span className="mt-2 block text-xs text-accent">{status.action.reason}</span> : null}
        {status.ticket?.error ? <span className="mt-1 block text-xs text-danger">{status.ticket.error}</span> : null}
      </button>
      <div className="workflow-item-actions">
        {item.state === "archived" ? <button className="btn btn-secondary" disabled={busy} onClick={() => void send("workItem.reopen", { id: item.id })}>恢复需求</button>
          : <><button className="btn btn-secondary" onClick={() => running ? onConversation(item) : onSelect(item, ["delivery", "merged"].includes(status.lane) ? "delivery" : undefined)}>{["delivery", "merged"].includes(status.lane) ? "查看交付" : running ? "进入对话" : "进入工作区"}</button>
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
      <label className="workflow-status-filter"><span className="sr-only">需求状态</span><select className="field" aria-label="需求状态筛选" value={filter} onChange={(event) => { setFilter(event.target.value); setSelected([]); }}>
      {[{ id: "active", label: "全部" }, { id: "attention", label: "需要关注" }, { id: "implemented", label: "已实现" }, { id: "accepted", label: "已验收" }, { id: "merged", label: "已合入" }, { id: "archived", label: "归档" }].map((entry) => <option key={entry.id} value={entry.id}>{entry.label} · {items.filter((item) => matches(item, entry.id)).length}</option>)}
    </select></label>
      <div className="workflow-layout-switch" role="group" aria-label="需求展示方式"><button aria-label="列表视图" aria-pressed={layout === "list"} onClick={() => setLayout("list")}><List size={16} /></button><button aria-label="看板视图" aria-pressed={layout === "board"} onClick={() => setLayout("board")}><LayoutGrid size={16} /></button></div>
      <button className="btn btn-primary" onClick={onCreate}><Plus size={14} />新建需求</button></div>

    {error ? <p role="alert" className="my-2 text-sm text-danger">{error}</p> : null}
    {filtered.length > 0 && items.length > 1 ? <div className="workflow-selection-bar"><label><input type="checkbox" aria-label="选择当前可执行需求" disabled={!selectable.length || busy} checked={!!selectable.length && selectedIds.length === selectable.length} onChange={(event) => setSelected(event.target.checked ? selectable.map((item) => item.id) : [])} />{selectedIds.length ? `已选择 ${selectedIds.length} 个需求` : `${filtered.length} 个需求 · 按优先级排序`}</label>
      {selectedIds.length ? <div className="flex gap-2"><button className="btn btn-ghost" onClick={() => setSelected([])}>取消选择</button><button className="btn btn-primary" disabled={busy} onClick={() => void send("workflow.enqueue", { ids: selectedIds })}>{busy ? "正在加入队列…" : `开始所选（${selectedIds.length}）`}</button></div> : null}</div> : null}
    {layout === "list" ? <ul className="workflow-requirements-list">{filtered.map(renderItem)}</ul> : <div className="workflow-kanban">{[{ id: "planned", label: "待推进" }, { id: "running", label: "实施中" }, { id: "delivery", label: "交付与集成" }, { id: "merged", label: "已合入" }].map((entry) => <section key={entry.id} aria-label={entry.label}><h3>{entry.label}<span>{filtered.filter((item) => lane(item) === entry.id).length}</span></h3><ul>{filtered.filter((item) => lane(item) === entry.id).map(renderItem)}</ul>{!filtered.some((item) => lane(item) === entry.id) ? <p className="workflow-lane-empty">暂无需求</p> : null}</section>)}</div>}
    {!filtered.length ? <div className="workflow-empty"><Layers size={28} /><h3>{query || filter !== "active" ? "没有匹配的需求" : "从一个具体需求开始"}</h3><p>{query || filter !== "active" ? "试试其他关键词，或清除筛选查看全部需求。" : "写下目标与验收标准，再逐步实施、验证和交付。"}</p>{query || filter !== "active" ? <button className="btn btn-secondary" onClick={() => { setQuery(""); setFilter("active"); }}>清除筛选</button> : null}</div> : null}
  </section>;
}
