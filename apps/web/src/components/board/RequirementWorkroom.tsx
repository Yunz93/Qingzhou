import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, GitBranch, MessageSquare, Play, Square } from "lucide-react";
import type { WorkItemDetails, WorkItemSummary, WorkflowProjectState } from "@qingzhou/protocol";
import { requirementProgress } from "../../lib/workflow-progress";
import { Link, useSearchParams } from "react-router-dom";
import { useViewPreference } from "../../hooks/useViewPreference";
import { useConversationDraft } from "../../lib/conversation-draft";
import { socketClient } from "../../transport/socket-client";
import { useAgentStore } from "../../stores/agent-store";
import { useDialogLayer } from "../../hooks/useDialogLayer";
import { WorkConversationDrawer } from "./WorkConversationDrawer";
import { WorkObjectivePanel } from "./WorkObjectivePanel";
import { RequirementWorkflow, requirementStatus } from "./ProjectWorkflow";
import { RequirementDesign, planningReady, prdFor } from "./RequirementDesign";
import { WorkflowTabs } from "./WorkflowTabs";

type View = "delivery" | "scope" | "history" | "design";
type Props = {
  error?: string; state: WorkflowProjectState; details: WorkItemDetails; items: WorkItemSummary[];
  projectName: string; onClose: () => void; onSelect: (item: WorkItemSummary) => void;
  onRefresh: () => Promise<void>; onStart: (id: string) => void | Promise<void>; onStop: (id: string) => void | Promise<void>;
  onReopen: (id: string) => void | Promise<void>; onOpenFull: (item: WorkItemSummary) => void;
  onSave: (input: { title: string; description: string; acceptanceCriteria: string }) => Promise<void>;
};

export function RequirementWorkroom({ error, state, details, items, projectName, onClose, onSelect, onRefresh, onStart, onStop, onReopen, onOpenFull, onSave }: Props) {
  const item: WorkItemSummary = items.find((entry) => entry.id === details.item.id) ?? {
    ...details.item, latestRun: details.runs[0] ?? null, runCount: details.runs.length, feedbackCount: details.feedback.length,
  };
  const status = requirementStatus(state, item);
  const plan = state.plans?.find((entry) => entry.itemId === item.id);
  const prd = prdFor(state, item.id);
  const designReady = planningReady(state, item.id);
  const running = ["running", "queued"].includes(status.ticket?.status ?? "");
  const latestAttempt = state.integrations.filter((entry) => entry.itemId === item.id && entry.deliveryId === status.delivery?.id).at(-1);
  const integrated = status.merged;
  const accepted = status.valid && status.acceptance === "已验收";
  const { stage, canStart: scopeCanStart } = requirementProgress({
    scopeId: state.scopes.filter((entry) => entry.itemId === item.id).at(-1)?.id,
    implementation: prd && status.implementationTicket?.prdId !== prd.id ? undefined : status.implementationTicket,
    valid: status.valid, accepted, merged: integrated, hasDelivery: !!status.delivery,
  });
  const canStart = !prd?.frozenAt && designReady && (scopeCanStart || (!!prd && status.implementationTicket?.prdId !== prd.id));
  const [searchParams] = useSearchParams();
  const [savedView, setView] = useViewPreference<View>(`qingzhou:workroom-view:${item.id}`, ["delivery", "merged"].includes(status.lane) ? "delivery" : plan ? "design" : "scope");
  const requested = searchParams.get("panel");
  const view = ["scope", "delivery", "history", "design"].includes(requested ?? "") ? requested as View : savedView;
  const [focus, setFocus] = useViewPreference(`qingzhou:workroom-focus:${item.id}`, "split");
  const [width, setWidth] = useViewPreference("qingzhou:workroom-width", 43);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef<Partial<Record<View, number>>>((() => {
    try { return JSON.parse(sessionStorage.getItem(`qingzhou:inspector-scroll:${item.id}`) || "{}"); } catch { return {}; }
  })());
  const [, setSearchParams] = useSearchParams();
  const selectView = (next: View) => {
    if (searchParams.has("panel")) setSearchParams((previous) => { previous.delete("panel"); return previous; }, { replace: true });
    if (inspectorRef.current) scrollPositions.current[view] = inspectorRef.current.scrollTop;
    setView(next);
  };
  useLayoutEffect(() => { if (inspectorRef.current) inspectorRef.current.scrollTop = scrollPositions.current[view] ?? 0; }, [view]);
  const [pane, setPane] = useViewPreference(`qingzhou:workroom-pane:${item.id}`, "conversation");
  useLayoutEffect(() => {
    if (["design", "scope", "delivery", "history"].includes(requested ?? "")) {
      setPane("inspector"); setFocus((current) => current === "conversation" ? "split" : current);
    }
  }, [requested, setPane, setFocus]);
  const [discussionRequest, setDiscussionRequest] = useState(0);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const act = (action: () => void | Promise<void>) => {
    if (actionBusy) return;
    setActionBusy(true); setActionError("");
    void Promise.resolve().then(action).catch((reason: unknown) => setActionError(reason instanceof Error ? reason.message : "操作失败，请重试")).finally(() => setActionBusy(false));
  };
  const ref = useRef<HTMLElement>(null);
  useDialogLayer(ref, onClose);
  const sorted = items.filter((entry) => entry.state !== "archived" || entry.id === item.id).slice().sort((a, b) => a.rank - b.rank);
  const index = sorted.findIndex((entry) => entry.id === item.id);
  const workspace = state.workspaces.find((entry) => entry.itemId === item.id);
  const busyIntegration = latestAttempt && ["queued", "preparing", "verifying", "merging"].includes(latestAttempt.status);
  const headline = integrated ? "这个交付已落到主线" : prd?.frozenAt ? "需求已确认完成，PRD 已固化；可继续选择合入时机" : plan && !designReady && !running ? "先沟通确认需求范围，再审阅并确认 PRD" : integrated ? status.valid ? "这个交付已落到主线" : "这个交付已合入，当前检查证据需更新" : running ? status.implementation : latestAttempt && ["conflicts", "failed"].includes(latestAttempt.status) ? "集成需要处理，原对话可继续修复" : latestAttempt?.status === "ready" ? status.candidateCurrent ? "组合验证已通过，等待你确认合入" : "候选依据已变化，需要更新集成候选" : busyIntegration ? status.integration : accepted ? "交付已验收，可以选择合入时机" : status.acceptance === "需返工" ? "交付需要调整，在原对话继续推进" : status.valid ? "检查已通过，请逐条确认验收标准" : status.verification?.status === "running" ? "正在验证交付，请稍候" : stage === 1 ? "本轮已结束，核对改动并封存验证" : "确认需求目标，开始一轮完整实施";
  const progressStage = plan ? !designReady && !prd?.frozenAt ? plan.confirmedScopeId === status.scope?.id ? 1 : 0 : stage + 2 : stage;
  return <div className="workflow-workroom-layer">
    <section ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="requirement-workroom-title" className="workflow-workroom" data-focus={focus} style={{ "--inspector-width": `${Math.min(70, Math.max(30, width))}%` } as CSSProperties}>
      <header role="presentation" className="workflow-workroom-head">
        <button className="btn btn-ghost" aria-label="关闭" onClick={onClose}><ArrowLeft size={16} /><span>项目</span></button>
        <div className="min-w-0 flex-1"><p>{projectName}<span> / 需求工作区 · {status.versionLabel}</span></p><h2 id="requirement-workroom-title">{item.title}</h2></div>
        <div className="workflow-item-pagination"><button className="icon-btn" aria-label="上一个需求" disabled={index <= 0} onClick={() => onSelect(sorted[index - 1]!)}><ChevronLeft size={17} /></button><span>{index + 1} / {sorted.length}</span><button className="icon-btn" aria-label="下一个需求" disabled={index < 0 || index >= sorted.length - 1} onClick={() => onSelect(sorted[index + 1]!)}><ChevronRight size={17} /></button></div>
        <button className="btn btn-ghost workflow-focus-toggle" aria-pressed={focus === "conversation"} onClick={() => { setFocus(focus === "conversation" ? "split" : "conversation"); setPane("conversation"); }}>{focus === "conversation" ? "恢复双栏" : "专注对话"}</button>
        <button className="btn btn-ghost workflow-focus-toggle" aria-pressed={focus === "inspector"} onClick={() => { setFocus(focus === "inspector" ? "split" : "inspector"); setPane("inspector"); }}>{focus === "inspector" ? "恢复双栏" : "专注审阅"}</button>
      </header>
      {error || actionError ? <p className="workflow-workroom-error" role="alert">{error || actionError}</p> : null}
      <div className="workflow-workroom-progress" aria-label="需求推进阶段">{(plan ? ["确认需求", "确认 PRD", "实施", "封存验证", "验收固化", "集成验证", "合入主线"] : ["实施", "封存验证", "人工验收", "集成验证", "合入主线"]).map((label, position) => <button key={label} data-state={position < progressStage ? "done" : position === progressStage ? "current" : "pending"} onClick={() => { setPane("inspector"); selectView(plan && position < 2 ? "design" : position === (plan ? 2 : 0) ? "scope" : "delivery"); }} aria-label={`查看${label}`} aria-current={position === progressStage ? "step" : undefined}><span>{position < progressStage ? <Check size={12} /> : position + 1}</span>{label}</button>)}</div>
      <div className="workflow-mobile-tabs"><WorkflowTabs id="workroom" label="工作区面板" value={pane} onChange={setPane} tabs={[{ id: "conversation", label: "连续对话" }, { id: "inspector", label: "需求与交付" }]} /></div>
      <div className="workflow-workroom-body" data-pane={pane}>
        <div className="workflow-workroom-chat" id="workroom-panel-conversation">
          <div className="workflow-pane-heading"><MessageSquare size={14} /><h3>连续对话</h3><span>{status.implementation}</span></div>
          {workspace?.removedAt ? <div className="workflow-empty"><h3>工作区已清理</h3><p>执行内容与工具记录仍可在“回放”中查看。</p><button className="btn btn-secondary" onClick={() => { selectView("history"); setPane("inspector"); }}>查看回放</button></div> : <WorkConversationDrawer key={item.id} embedded discussionRequest={discussionRequest} item={item} onClose={onClose} onOpenFull={() => onOpenFull(item)} />}
        </div>
        <div className="workflow-splitter" role="separator" tabIndex={0} aria-label="调整对话与审阅宽度" aria-orientation="vertical" aria-valuemin={30} aria-valuemax={70} aria-valuenow={width} onDoubleClick={() => setWidth(43)} onKeyDown={(event) => { if (["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) { event.preventDefault(); setWidth(event.key === "Home" ? 43 : Math.min(70, Math.max(30, width + (event.key === "ArrowLeft" ? 3 : -3)))); } }} onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) { const box = event.currentTarget.parentElement!.getBoundingClientRect(); setWidth(Math.min(70, Math.max(30, (box.right - event.clientX) / box.width * 100))); } }} onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)} />
        <div className="workflow-workroom-inspector" id="workroom-panel-inspector">
          <WorkflowTabs id="requirement" label="需求工作区视图" value={view} onChange={selectView} tabs={[
            { id: "design", label: "设计与 PRD" }, { id: "delivery", label: "交付", count: state.deliveries.filter((entry) => entry.itemId === item.id).length }, { id: "scope", label: "范围" }, { id: "history", label: "回放" },
          ]} />
          <div className="workflow-next-step" role="status"><span className="workflow-eyebrow">{integrated ? "交付完成" : "当前进展"}</span><strong>{headline}</strong>
            <div className="flex flex-wrap gap-2">{view !== "delivery" && stage > 0 ? <button className="btn btn-secondary" onClick={() => selectView("delivery")}>查看当前交付</button> : null}{item.state === "open" && !workspace?.removedAt ? running ? <button className="btn btn-secondary" disabled={actionBusy} onClick={() => act(() => onStop(item.id))}><Square size={12} />停止本轮</button> : canStart ? <button className="btn btn-primary" disabled={actionBusy} onClick={() => act(() => onStart(item.id))}><Play size={13} />{status.implementationTicket?.status === "finished" ? "开始新一轮" : status.implementationTicket ? "重新执行" : "开始执行"}</button> : null : item.state === "completed" && !workspace?.removedAt ? <button className="btn btn-secondary" disabled={actionBusy} onClick={() => act(() => onReopen(item.id))}>重新打开</button> : null}
            </div>
          </div>
          <div ref={inspectorRef} className="workflow-inspector-scroll" onScroll={(event) => { scrollPositions.current[view] = event.currentTarget.scrollTop; try { sessionStorage.setItem(`qingzhou:inspector-scroll:${item.id}`, JSON.stringify(scrollPositions.current)); } catch { /* Optional reading position. */ } }}>
            {view === "design" ? <RequirementDesign state={state} item={item} onRefresh={onRefresh} onScope={() => selectView("scope")} onConversation={() => { setFocus("split"); setPane("conversation"); setDiscussionRequest((value) => value + 1); if (item.taskId) act(async () => { await socketClient.send("task.policy.set", { mode: "ask", approvalPolicy: "read_only" }, item.taskId!); }); }} /> : null}
            <RequirementWorkflow state={state} item={item} items={items} onRefresh={onRefresh} view={view}
              scopeContent={<><RequirementSource item={item} />{prd?.frozenAt ? <p className="workflow-design-note">需求已固化，范围编辑已关闭；请在“设计与 PRD”创建关联子需求。</p> : <WorkObjectivePanel embedded details={details} onClose={onClose} onSave={onSave} onFeedback={async () => undefined} onAccept={() => undefined} onReopen={() => onReopen(item.id)} onDelete={async () => undefined} onOpenConversation={() => setPane("conversation")} />}</>} />
          </div>
          {workspace ? <div className="workflow-workspace-label"><GitBranch size={12} /><span title={workspace.branch}>{workspace.branch}</span><span>独立工作区</span></div> : null}
        </div>
      </div>
    </section>
  </div>;
}

function RequirementSource({ item }: { item: WorkItemSummary }) {
  const source = item.source;
  const editor = useConversationDraft(item.taskId, item.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!source) return null;
  return <section className="workflow-source text-sm mb-4"><h3 className="font-medium">{source.integrationId ? "撤销来源" : "讨论来源"}</h3>
    {source.excerpt ? <details className="mt-2"><summary>查看创建时保存的讨论依据</summary><pre className="workflow-code">{source.excerpt}</pre></details> : null}
    {source.taskId ? <Link className="btn btn-secondary mt-2" to="/" onClick={() => useAgentStore.getState().setActiveTask(source.taskId!)}>查看原始对话</Link> : null}
    {source.integrationId ? <p className="text-mute mt-2">通过新需求撤销集成 {source.integrationId}，原主线历史保留。</p> : null}
    {source.images?.length ? <div className="mt-2"><p>创建时保存的来源图片 · {source.images.length}</p><div className="workflow-source-images">{source.images.map((image, index) => image.dataUrl?.startsWith("data:image/") ? <img key={index} src={image.dataUrl} alt={image.name || `来源图片 ${index + 1}`} /> : null)}</div><button className="btn btn-secondary mt-2" disabled={busy} onClick={() => {
      setBusy(true); setError(""); void (async () => {
        for (const image of source.images ?? []) {
          if (!image.dataUrl?.startsWith("data:image/")) continue;
          const blob = await fetch(image.dataUrl).then((response) => response.blob());
          const body = new FormData(); body.append("file", blob, image.name || "来源图片.png");
          const response = await fetch("/uploads", { method: "POST", credentials: "same-origin", body });
          if (!response.ok) throw new Error("来源图片上传失败，请重试");
          const uploaded = await response.json() as { id: string };
          editor.setImages((current) => [...current, { id: uploaded.id, name: image.name || "来源图片", previewUrl: image.dataUrl! }]);
        }
      })().catch((reason) => setError(reason instanceof Error ? reason.message : "添加来源图片失败")).finally(() => setBusy(false));
    }}>{busy ? "正在添加…" : "将来源图片加入本轮草稿"}</button></div> : null}
    {error ? <p className="text-danger" role="alert">{error}</p> : null}
    {!source.integrationId ? <p className="text-mute mt-2">来源讨论不代表交付或验证；原目录未提交改动不会自动复制。</p> : null}
  </section>;
}
