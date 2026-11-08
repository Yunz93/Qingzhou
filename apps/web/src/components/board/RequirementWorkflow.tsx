import { useState, type ReactNode } from "react";
import type { WorkflowProjectState, WorkItemSummary } from "@qingzhou/protocol";
import { socketClient } from "../../transport/socket-client";
import { requirementStatus } from "../../lib/requirement-state";
import { prdFor } from "../../lib/requirement-planning";
import { workflowDate as date, workflowError as message } from "../../lib/workflow-presentation";
import { useWorkflowAction } from "../../hooks/useWorkflowAction";
import { WorkflowModal } from "./WorkflowTabs";
import { ReviewActions } from "./ReviewActions";
import { WorkflowCycle } from "./WorkflowCycle";
import { AcceptanceEvidence } from "./AcceptanceEvidence";
import { DeliveryReview } from "./DeliveryReview";
import { PatchDiff } from "../diff/PatchDiff";
import { WorkflowHistory } from "./WorkflowHistory";
import { DeliveryAcceptanceActions } from "./DeliveryAcceptanceActions";
import { IntegrationReview } from "./IntegrationReview";
import { VerificationDetails } from "./VerificationDetails";

export function RequirementWorkflow({ state, item, items, onRefresh, view = "delivery", scopeContent, onViewChange, actionsTarget, settingsOpen, onCloseSettings, canStart }: {
  onViewChange?: (view: "delivery" | "design" | "modules" | "acceptance" | "history") => void; actionsTarget?: HTMLElement | null;
  settingsOpen?: boolean; onCloseSettings?: () => void; canStart?: boolean; scopeContent?: ReactNode;
  view?: "delivery" | "acceptance" | "history" | "design" | "modules"; state: WorkflowProjectState; item: WorkItemSummary; items: WorkItemSummary[]; onRefresh: () => Promise<void>;
}) {
  const { busy, error, setError, run } = useWorkflowAction(item.id);
  const [selectedDeliveryId, setSelectedDeliveryId] = useState("");
  const [selectedTestPath, setSelectedTestPath] = useState("");
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
  const send = (type: Parameters<typeof socketClient.send>[0], payload: object) => run(
    () => socketClient.send(type, payload), async () => {
      setPaths(null); setSelected([]);
      if (type === "workflow.seal") setSelectedDeliveryId("");
      await onRefresh();
      if (type === "workflow.integrate") onViewChange?.("delivery");
    });
  const active = ["running", "queued"].includes(status.ticket?.status ?? "") || ["running", "queued"].includes(status.verification?.status ?? "");
  const delivery = deliveries.find((entry) => entry.id === selectedDeliveryId) ?? deliveries[0];
  const deliveryIndex = delivery ? deliveries.indexOf(delivery) : -1;
  const attempt = attempts.find((entry) => entry.deliveryId === delivery?.id);
  const activeCandidate = attempt && !["merged", "cancelled", "stale"].includes(attempt.status);
  const selectDelivery = (id: string) => { setSelectedDeliveryId(id); setSelectedTestPath(""); };
  const versions = delivery ? <select className="review-version-select" aria-label="交付版本" value={delivery.id} onChange={(event) => selectDelivery(event.target.value)}>{deliveries.map((entry, index) => <option value={entry.id} key={entry.id}>交付 {deliveries.length - index} · {entry.commit.slice(0, 8)}</option>)}</select> : null;
  return <section className="work-panel-section review-workflow" aria-label={view === "acceptance" ? "需求验收" : view === "design" ? "需求范围设置" : view === "history" ? "需求历史与回放" : "交付与集成"}>
    {error ? <p role="alert" className="review-blocker text-danger">{error}</p> : null}
    {status.verification && state.queue?.resourceWaits[status.verification.id] ? <p className="review-blocker">等待独占验证资源：{state.queue.resourceWaits[status.verification.id]}</p> : null}
    {settingsOpen ? <WorkflowModal title="需求设置" closeLabel="关闭需求设置" onClose={() => onCloseSettings?.()}>
    <div className="workflow-scope-settings">{scopeContent}<details open className="mt-3 text-sm"><summary>范围版本与前置需求</summary>
      {scopes.map((scope) => <details key={scope.id} className="mt-2"><summary>范围 v{scope.version} · {date(scope.createdAt)}</summary><pre className="workflow-code">{scope.title}{"\n\n"}{scope.description}{"\n\n验收标准\n"}{scope.acceptanceCriteria}</pre></details>)}
      {status.ticket?.status === "queued" ? <button className="btn btn-secondary mt-3" disabled={busy} onClick={() => void send("workItem.stop", { id: item.id })}>停止排队以调整依赖</button> : null}
      <fieldset className="mt-3 space-y-2" disabled={active || busy}><legend className="mb-2">前置需求合入后才能开工</legend>
        {items.filter((entry) => entry.id !== item.id && (entry.state !== "archived" || (state.dependencies[item.id] ?? []).includes(entry.id))).map((entry) => <label key={entry.id} className="flex items-center gap-2"><input type="checkbox" checked={(dependencyDraft ?? state.dependencies[item.id] ?? []).includes(entry.id)} onChange={(event) => { const dependencies = event.target.checked ? [...(state.dependencies[item.id] ?? []), entry.id] : (state.dependencies[item.id] ?? []).filter((id) => id !== entry.id); setDependencyDraft(dependencies); void send("workflow.dependencies", { id: item.id, dependencies }).finally(() => setDependencyDraft(null)); }} />{entry.title}{entry.state === "archived" ? " · 已归档（可取消此依赖）" : ""}</label>)}
      </fieldset>
    </details>
    {workspace ? <details className="mt-3 text-sm"><summary>工作区与基线</summary><pre className="workflow-code">{workspace.path}{"\n"}{workspace.branch}{"\n基线 "}{workspace.baseline}{workspace.removedAt ? "\n已清理，历史仍保留" : ""}</pre>
      {!workspace.removedAt && status.merged ? <button className="btn btn-secondary" disabled={busy || active} onClick={() => void send("workflow.cleanup", { id: item.id })}>清理已合入且无改动的工作区</button> : null}
    </details> : null}
    </div>
      <WorkflowCycle state={state} itemId={item.id} canStart={!!canStart} onRefresh={onRefresh} />
    </WorkflowModal> : null}
    <div hidden={view !== "delivery"} className="review-delivery" role="tabpanel" id="requirement-panel-delivery" aria-labelledby="requirement-tab-delivery">
      <div className="review-toolbar"><h3>本次交付</h3><div className="review-toolbar-actions">{delivery ? <span className="review-hint">{delivery.files.length} 个变更文件</span> : null}{versions}</div></div>
    {workspace && !workspace.removedAt && item.state === "open" && !prdFor(state, item.id)?.frozenAt ? <div className="mt-4">
      <button className="btn btn-secondary" disabled={busy || active || loadingChanges} onClick={() => { setError(""); setLoadingChanges(true); void socketClient.send<{ paths: string[] }>("workflow.changes", { id: item.id }).then((value) => { setPaths(value.paths); setSelected([]); }).catch((reason) => setError(message(reason))).finally(() => setLoadingChanges(false)); }}>{loadingChanges ? "正在读取改动…" : "查看本次待封存改动"}</button>
      {paths ? <div className="mt-3 rounded-lg border border-line p-3 text-sm">
        <label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={paths.length > 0 && selected.length === paths.length} onChange={(event) => setSelected(event.target.checked ? paths : [])} />确认全部改动属于本需求</label>
        {paths.map((file) => <label key={file} className="mt-2 flex min-w-0 items-center gap-2"><input type="checkbox" aria-label={file} className="shrink-0" checked={selected.includes(file)} onChange={(event) => setSelected(event.target.checked ? [...selected, file] : selected.filter((entry) => entry !== file))} /><span className="truncate font-mono text-xs" title={file}>{file.replaceAll(/([a-f0-9]{8})-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g, "$1…")}</span></label>)}
        {!paths.length ? <p className="mt-2 text-mute">没有新文件差异，可封存当前代码树以重新验证。</p> : null}
        <label className="mt-3 block">本轮实现的行为<textarea className="field mt-1 w-full" rows={3} value={behaviors} maxLength={6000} onChange={(event) => setBehaviors(event.target.value)} placeholder="描述用户可观察的结果，提交后仍需人工验收。" /></label>
        <details className="mt-3"><summary>补充交付信息</summary>
        <label className="mt-3 block">交付说明<textarea className="field mt-1 w-full" rows={2} value={summary} onChange={(event) => setSummary(event.target.value)} /></label>
        <label className="mt-3 block">未完成与需人工检查<textarea className="field mt-1 w-full" rows={2} value={unresolved} maxLength={6000} onChange={(event) => setUnresolved(event.target.value)} placeholder="列出未验证的行为、限制及尚需决定的事项。" /></label>
        <label className="mt-3 block">保存到交付的产物路径<textarea className="field mt-1 w-full font-mono" rows={2} value={artifactPaths} onChange={(event) => setArtifactPaths(event.target.value)} placeholder="每行一个仓库内文件，如 screenshots/result.png。文件须已纳入本次提交，预览读取封存版本。" /></label>
        </details>
      </div> : null}
    </div> : null}

      {delivery ? <>
        <PatchDiff key={`${delivery.id}:${selectedTestPath}`} layout="workspace" initialPath={selectedTestPath} patch={delivery.patch} beforeLabel={`实施基线 · ${delivery.baseline.slice(0, 8)}`} afterLabel={`封存交付 · ${delivery.commit.slice(0, 8)}`} fallback="无文件差异" />
        <details className="review-delivery-notes"><summary>交付说明与产物</summary><DeliveryReview key={delivery.id} state={state} delivery={delivery} previous={deliveries[deliveryIndex + 1]} /><BaselineRelationship state={state} item={item} items={items} /></details>
        {attempt ? <IntegrationReview key={`${attempt.id}:${attempt.candidate}:${attempt.verificationId}`} state={state} attempt={attempt} busy={busy} send={send} actionsTarget={view === "delivery" && paths === null ? actionsTarget : null} /> : null}
      </> : <p className="workflow-empty">实施结束后，核对本次改动并封存交付。</p>}
      {!activeCandidate || paths !== null ? <ReviewActions target={view === "delivery" ? actionsTarget : null}><span className="review-hint">{paths !== null ? `待封存 · ${paths.length} 个文件` : delivery ? `实施基线 → 交付 ${delivery.commit.slice(0, 8)}` : "尚无封存交付"}</span><div className="review-action-buttons">{paths !== null ? <button className="btn btn-primary mt-3" disabled={busy || selected.length !== paths.length} onClick={() => void send("workflow.seal", { id: item.id, paths: selected, summary, review: { behaviors, unresolved, artifactPaths: artifactPaths.split("\n").map((file) => file.trim()).filter(Boolean) } })}>封存所选改动并验证</button> : delivery ? <button className="btn btn-primary" onClick={() => onViewChange?.("acceptance")}>审阅测试与验收 →</button> : <button className="btn btn-secondary" onClick={() => onViewChange?.("design")}>回到设计与实施</button>}</div></ReviewActions> : null}
    </div>
    <div hidden={view !== "acceptance"} className="review-acceptance" role="tabpanel" id="requirement-panel-acceptance" aria-labelledby="requirement-tab-acceptance">
      <div className="review-toolbar"><h3>当前交付的验收</h3>{versions}</div>
      {delivery ? <div className="review-acceptance-body">
        <AcceptanceEvidence delivery={delivery} verification={state.verifications.find((result) => result.id === delivery.verificationId)} onViewFile={(path) => { setSelectedTestPath(path); onViewChange?.("delivery"); }} />
        <details className="review-check-logs"><summary>全部检查与日志</summary><VerificationDetails result={state.verifications.find((result) => result.id === delivery.verificationId)} /></details>
        <DeliveryAcceptanceActions key={`${delivery.id}:${delivery.scopeId}`} state={state} deliveryId={delivery.id} current={deliveryIndex === 0 && status.valid} busy={busy} send={send} actionsTarget={view === "acceptance" ? actionsTarget : null} />
      </div> : <p className="workflow-empty">封存交付后，在这里查看测试变更、检查结果并验收。</p>}
    </div>
    <div hidden={view !== "history"} role="tabpanel" id="requirement-panel-history" aria-labelledby="requirement-tab-history"><WorkflowHistory state={state} items={items} onlyItemId={item.id} onRefresh={onRefresh} expanded /></div>
    <ReviewActions target={view === "history" ? actionsTarget : null}><span className="review-hint">历史记录只读</span><button className="btn btn-secondary" onClick={() => onViewChange?.("design")}>回到当前设计</button></ReviewActions>
  </section>;
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
