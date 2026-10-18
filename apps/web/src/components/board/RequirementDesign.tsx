import { useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { requirementFiles, requirementDesignPath, type RequirementPrd, type WorkflowProjectState, type WorkItemSummary } from "@qingzhou/protocol";
import { socketClient } from "../../transport/socket-client";
import { useAgentStore } from "../../stores/agent-store";
import { useConversationDraft } from "../../lib/conversation-draft";
import { WorkflowModal } from "./WorkflowTabs";

const message = (reason: unknown) => reason instanceof Error ? reason.message : "操作失败，请重试";
export const prdFor = (state: WorkflowProjectState, id: string) => state.prds?.find((prd) => prd.id === state.plans?.find((plan) => plan.itemId === id)?.currentPrdId);
export const planningReady = (state: WorkflowProjectState, id: string) => {
  const plan = state.plans?.find((entry) => entry.itemId === id);
  const prd = prdFor(state, id);
  const scope = state.scopes.filter((entry) => entry.itemId === id).at(-1);
  return !plan || (!!prd?.confirmedAt && !prd.frozenAt && prd.scopeId === scope?.id && plan.confirmedScopeId === scope?.id && prd.moduleChanges.every((change) => change.baseRevisionId === (prd.codeBaseline ? prd.codeBaseline.moduleRevisionIds[change.moduleId] ?? null : state.moduleRevisions?.filter((entry) => entry.moduleId === change.moduleId).at(-1)?.id ?? null)));
};
export function RequirementDesign({ state, item, onRefresh, onScope, onConversation }: {
  state: WorkflowProjectState; item: WorkItemSummary; onRefresh: () => Promise<void>; onScope: () => void; onConversation: () => void;
}) {
  const navigate = useNavigate();
  const plan = state.plans?.find((entry) => entry.itemId === item.id);
  const scope = state.scopes.filter((entry) => entry.itemId === item.id).at(-1);
  const prd = prdFor(state, item.id);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [child, setChild] = useState(false);
  const send = async (type: Parameters<typeof socketClient.send>[0], payload: object) => {
    setBusy(true); setError("");
    try { await socketClient.send(type, payload); await onRefresh(); } catch (reason) { setError(message(reason)); } finally { setBusy(false); }
  };
  const active = state.tickets.some((entry) => entry.itemId === item.id && ["running", "queued"].includes(entry.status))
    || state.verifications.some((entry) => entry.itemId === item.id && ["running", "queued"].includes(entry.status))
    || state.integrations.some((entry) => entry.itemId === item.id && ["queued", "preparing", "conflicts", "verifying", "ready", "merging"].includes(entry.status));
  const source = state.prds?.find((entry) => entry.id === item.source?.prdId);
  const lastSync = state.events.filter((entry) => entry.itemId === item.id && ["prd.sync.failed", "prd.revised", "prd.file.synced"].includes(entry.type)).at(-1);
  return <section className="workflow-design" aria-label="需求设计与 PRD">
    {source ? <p className="workflow-design-note">子需求来源：{state.scopes.find((entry) => entry.id === source.scopeId)?.title} · 已固化 PRD v{source.version}。本需求会保留独立的确认与交付记录。</p> : null}
    {lastSync?.type === "prd.sync.failed" ? <p className="workflow-design-note" role="alert">设计文件尚未同步：{lastSync.message}。修复文件后可从工作区重新同步。</p> : null}
    {!plan ? <div className="workflow-empty"><h3>按 PRD 推进这个需求</h3><p>历史交付保持原记录。启用后，依次确认范围与 PRD，最终验收时固化设计。</p><button className="btn btn-primary" disabled={busy || active} onClick={() => void send("workflow.plan.begin", { id: item.id })}>启用 PRD 流程</button></div> : <>
      <section className="workflow-design-section"><div className="flex flex-wrap items-center justify-between gap-2"><h3>需求范围 v{scope?.version ?? 1}</h3><button className="btn btn-ghost" onClick={onScope}>{prd?.frozenAt ? "查看需求范围" : "编辑需求范围"}</button></div>
        <details open={plan.confirmedScopeId !== scope?.id}><summary>目标与验收标准{plan.confirmedScopeId === scope?.id ? " · 已确认" : ""}</summary><p className="whitespace-pre-wrap mt-2">{scope?.description || "在需求范围中补充目标。"}</p><pre className="workflow-code">{scope?.acceptanceCriteria || "待补充验收标准"}</pre></details>
        {plan.confirmedScopeId !== scope?.id ? <button className="btn btn-primary" disabled={busy || active || !scope?.description.trim() || !scope.acceptanceCriteria.trim()} onClick={() => void send("workflow.scope.confirm", { id: item.id, scopeId: scope!.id })}>确认这个需求范围</button> : null}
      </section>
      {prd?.frozenAt ? <section className="workflow-design-section"><h3>PRD v{prd.version} 已固化</h3><p className="text-sm text-mute">{new Date(prd.frozenAt).toLocaleString()} · 对应交付 {prd.deliveryId?.slice(0, 8)}。之后的变更通过关联子需求推进。</p><pre className="workflow-document">{prd.content}</pre><PrdModules state={state} prd={prd} /><MarkdownDownload name={`prd-${item.id}-v${prd.version}.md`} content={`# ${item.title}\nPRD v${prd.version} · ${prd.id}\n交付 ${prd.deliveryId}\n\n${prd.content}\n\n${prd.moduleChanges.map((change) => `## 模块：${state.modules?.find((module) => module.id === change.moduleId)?.name}\n依据版本 ${change.baseRevisionId}\n${change.content}`).join("\n\n")}`} /><button className="btn btn-primary" onClick={() => setChild(true)}>基于此 PRD 创建子需求</button></section>
        : <PrdEditor key={item.id} state={state} item={item} prd={prd} scopeConfirmed={plan.confirmedScopeId === scope?.id} active={active} onRefresh={onRefresh} onConversation={onConversation} />}
      <details className="workflow-design-section"><summary>PRD 版本与变更记录（{state.prds?.filter((entry) => entry.itemId === item.id).length ?? 0}）</summary>{state.prds?.filter((entry) => entry.itemId === item.id).slice().reverse().map((entry) => <details className="workflow-design-revision" key={entry.id}><summary>v{entry.version} · {entry.frozenAt ? "已固化" : entry.confirmedAt ? "已确认" : "草稿"} · {entry.reason}</summary><p className="text-sm text-mute">{new Date(entry.createdAt).toLocaleString()} · 范围 v{state.scopes.find((scope) => scope.id === entry.scopeId)?.version} · {entry.deliveryId ? `交付 ${entry.deliveryId.slice(0, 8)}` : "尚未固化"}</p><pre className="workflow-document">{entry.content}</pre><PrdModules state={state} prd={entry} /></details>)}</details>
    </>}
    {error ? <p className="text-danger" role="alert">{error}</p> : null}
    {child && prd ? <ChildRequirement state={state} projectId={item.projectId} prd={prd} onClose={() => setChild(false)} onCreated={async (id) => { setChild(false); await onRefresh(); navigate(`/board?item=${id}&panel=design`); }} /> : null}
  </section>;
}

function PrdModules({ state, prd }: { state: WorkflowProjectState; prd: RequirementPrd }) {
  return <div>{prd.moduleChanges.map((change) => <details key={change.moduleId}><summary>模块：{state.modules?.find((entry) => entry.id === change.moduleId)?.name} · 依据 v{state.moduleRevisions?.find((entry) => entry.id === change.baseRevisionId)?.version ?? 0}</summary><pre className="workflow-document">{change.content}</pre></details>)}</div>;
}

type Draft = { expectedPrdId: string | null; content: string; reason: string; moduleChanges: RequirementPrd["moduleChanges"] };
function PrdEditor({ state, item, prd, scopeConfirmed, active, onRefresh, onConversation }: {
  state: WorkflowProjectState; item: WorkItemSummary; prd?: RequirementPrd; scopeConfirmed: boolean; active: boolean; onRefresh: () => Promise<void>; onConversation: () => void;
}) {
  const storageKey = `qingzhou:prd-draft:${item.id}`;
  const baseline = state.designBaselines?.[item.id];
  const moduleCurrent = (id: string) => baseline ? state.moduleRevisions?.find((entry) => entry.id === baseline.moduleRevisionIds[id]) : state.moduleRevisions?.filter((entry) => entry.moduleId === id).at(-1);
  const initial = (): Draft => {
    const origin = state.prds?.find((entry) => entry.id === item.source?.prdId);
    const moduleIds = item.source?.moduleIds ?? origin?.moduleChanges.map((change) => change.moduleId) ?? [];
    return { expectedPrdId: prd?.id ?? null, content: prd?.content ?? `# ${item.title}\n\n## 目标与边界\n${item.description}\n\n## 交互与实现方案\n\n## 验收与回归\n${item.acceptanceCriteria}`, reason: "", moduleChanges: prd?.moduleChanges ?? moduleIds.map((moduleId) => {
      const current = moduleCurrent(moduleId);
      return { moduleId, baseRevisionId: current?.id ?? null, content: current?.content || "待补充模块的完整设计" };
    }) };
  };
  const [draft, setDraft] = useState<Draft>(() => { try { const saved = sessionStorage.getItem(storageKey); return saved ? JSON.parse(saved) as Draft : initial(); } catch { return initial(); } });
  const previousPrd = useRef(prd);
  useEffect(() => {
    const previous = previousPrd.current; previousPrd.current = prd;
    if (!prd || !previous || previous.id === prd.id) return;
    setDraft((current) => current.expectedPrdId === previous.id && !current.reason
      && current.content === previous.content && JSON.stringify(current.moduleChanges) === JSON.stringify(previous.moduleChanges)
      ? { expectedPrdId: prd.id, content: prd.content, reason: "", moduleChanges: prd.moduleChanges } : current);
  }, [prd]);
  const editor = useConversationDraft(item.taskId, item.id);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { try { sessionStorage.setItem(storageKey, JSON.stringify(draft)); } catch { /* Optional local recovery. */ } }, [draft, storageKey]);
  const stale = draft.expectedPrdId !== (prd?.id ?? null);
  const dirty = draft.content !== (prd?.content ?? "") || JSON.stringify(draft.moduleChanges) !== JSON.stringify(prd?.moduleChanges ?? []);
  const scope = state.scopes.filter((entry) => entry.itemId === item.id).at(-1)!;
  const patch = (value: Partial<Draft>) => setDraft((previous) => ({ ...previous, ...value }));
  const send = async (confirm: boolean) => {
    setBusy(true); setError("");
    try {
      if (confirm) await socketClient.send("workflow.prd.confirm", { id: item.id, prdId: prd!.id });
      else {
        const result = await socketClient.send<{ prd: RequirementPrd }>("workflow.prd.save", { id: item.id, scopeId: scope.id, ...draft });
        patch({ expectedPrdId: result.prd.id, reason: "" });
      }
      await onRefresh();
    } catch (reason) { setError(message(reason)); } finally { setBusy(false); }
  };
  const proposal = state.proposals?.findLast((entry) => entry.itemId === item.id);
  const proposalCurrent = proposal && proposal.scopeId === scope.id && proposal.expectedPrdId === (prd?.id ?? null);
  return <section className="workflow-design-section"><h3>PRD {prd ? `v${prd.version} · ${prd.confirmedAt ? "已确认" : "待确认"}` : "草稿"}</h3>
    {baseline ? <details className="text-sm text-mute"><summary>代码基线 · {baseline.commit.slice(0, 8)}</summary><p className="mt-2">设计依据对应此代码版本；其他尚未合入的设计保留为来源参考。</p></details> : null}
    {proposal ? <details className="workflow-design-note" open={!!proposalCurrent}><summary>{proposalCurrent ? "Agent 结构化设计提案" : "历史 Agent 设计提案"}</summary>
      {!proposalCurrent ? <p role="alert">此提案依据已过期，请重新讨论；不能覆盖当前草稿。</p> : null}
      <details><summary>对照当前 PRD</summary><pre className="workflow-document">{prd?.content || "尚无 PRD"}</pre></details><h4>提议的 PRD</h4><pre className="workflow-document">{proposal.content}</pre>
      <p>变更原因：{proposal.reason}</p>{proposal.moduleChanges.map((change) => <details key={change.moduleId}><summary>{state.modules?.find((entry) => entry.id === change.moduleId)?.name} · 模块变更提案</summary><pre className="workflow-document">{change.content}</pre></details>)}
      {proposal.questions.length ? <div><strong>待确认问题</strong><ul>{proposal.questions.map((question, index) => <li key={index}>{question}</li>)}</ul></div> : null}
      <button className="btn btn-secondary" disabled={active || !proposalCurrent} onClick={() => patch({ expectedPrdId: proposal.expectedPrdId, content: proposal.content, reason: proposal.reason, moduleChanges: proposal.moduleChanges })}>采用结构化提案为草稿</button>
    </details> : null}
    {!scopeConfirmed ? <p className="workflow-design-note">先确认需求范围。PRD 草稿可以继续编辑。</p> : null}
    {active ? <p className="workflow-design-note">本轮进行中，草稿会保留；结束本轮后可保存并确认设计调整。</p> : null}
    {stale ? <p role="alert" className="workflow-design-note">PRD 已有新版本。你的草稿已保留，请先查看下方版本记录并合并，再<button className="btn btn-ghost" onClick={() => patch({ expectedPrdId: prd?.id ?? null })}>保留草稿并采用新版依据</button><button className="btn btn-ghost" onClick={() => setDraft(initial())}>放弃草稿，载入最新 PRD</button></p> : null}
    {state.workspaces.some((entry) => entry.itemId === item.id && !entry.removedAt) ? <details className="text-sm"><summary>工作区文档</summary><code className="block break-all mt-2">{requirementFiles(item.id).prd}</code><code className="block break-all">{requirementDesignPath(item.id)}</code><code className="block break-all">{requirementFiles(item.id).context}</code><p className="mt-2 text-mute">Agent 的文档修改会在本轮结束后读回为待确认版本；也可手动同步。</p><button className="btn btn-secondary mt-2" disabled={busy || active || !prd} onClick={() => {
      setBusy(true); setError(""); void socketClient.send("workflow.prd.import", { id: item.id }).then(onRefresh).catch((reason) => setError(message(reason))).finally(() => setBusy(false));
    }}>从工作区同步 PRD</button></details> : null}
    <label className="block">PRD 正文<textarea aria-label="PRD 正文" className="field workflow-prd-editor" rows={14} maxLength={16000} value={draft.content} onChange={(event) => patch({ content: event.target.value })} /></label>
    <div className="flex flex-wrap gap-2"><button className="btn btn-secondary" disabled={active} onClick={() => {
      const instruction = `请与我讨论以下 PRD，指出待确认的问题并给出完整修订稿。此轮仅讨论，先不要实施。\n\n${draft.content}`;
      editor.setText((current) => current ? `${current}\n\n${instruction}` : instruction); onConversation();
    }}>将草稿带入对话讨论</button></div><details className="text-sm"><summary>其他草稿来源</summary><button className="btn btn-ghost mt-2" onClick={() => {
      const reply = item.taskId ? useAgentStore.getState().messagesByTask[item.taskId]?.findLast((entry) => entry.role === "assistant" && entry.text.trim()) : null;
      if (!reply) { setError("还没有可采用的 Agent 回复，请先在对话中讨论 PRD。"); return; }
      if (reply.text.length > 16000) { setError("最新回复超过 PRD 字数上限，请先整理或拆分后填入。"); return; }
      patch({ content: reply.text, reason: "根据 Agent 回复调整设计" }); setError("");
    }}>采用 Agent 最新回复为草稿</button></details>
    <details open={draft.moduleChanges.length > 0}><summary>关联模块（{draft.moduleChanges.length}）</summary><fieldset className="workflow-module-changes"><legend className="sr-only">涉及的模块与完成后的设计</legend>
      {!state.modules?.length ? <p className="text-sm">先在项目的“模块文档”中建立模块，再回来关联。</p> : state.modules.map((module) => {
        const change = draft.moduleChanges.find((entry) => entry.moduleId === module.id);
        const current = moduleCurrent(module.id);
        const changed = !!change && change.baseRevisionId !== (current?.id ?? null);
        return <div className="workflow-module-change" key={module.id}><label className="flex items-center gap-2"><input type="checkbox" checked={!!change} disabled={!change && draft.moduleChanges.length >= 8} onChange={(event) => patch({ moduleChanges: event.target.checked ? [...draft.moduleChanges, { moduleId: module.id, baseRevisionId: current?.id ?? null, content: current?.content || "" }] : draft.moduleChanges.filter((entry) => entry.moduleId !== module.id) })} />{module.name} · 代码基线 v{current?.version ?? 0}</label>
          {change ? <><details><summary>{changed ? "模块已更新，请对照并合并当前设计" : "查看当前模块设计"}</summary><pre className="workflow-document">{current?.content || "暂无正文"}</pre></details>{changed ? <p className="workflow-design-note">原依据 v{state.moduleRevisions?.find((entry) => entry.id === change.baseRevisionId)?.version ?? 0} 已过期。<button className="btn btn-secondary" onClick={() => patch({ moduleChanges: draft.moduleChanges.map((entry) => entry.moduleId === module.id ? { ...entry, baseRevisionId: current?.id ?? null } : entry) })}>已合并设计，更新依据版本</button></p> : null}
            <label className="block mt-2">{module.name}完成后的完整设计<textarea aria-label={`${module.name}完成后的完整设计`} className="field w-full" rows={7} maxLength={12000} value={change.content} onChange={(event) => patch({ moduleChanges: draft.moduleChanges.map((entry) => entry.moduleId === module.id ? { ...entry, content: event.target.value } : entry) })} /></label></> : null}</div>;
      })}
    </fieldset></details>
    <label className="block">本次设计变更说明<input className="field w-full" value={draft.reason} maxLength={2000} onChange={(event) => patch({ reason: event.target.value })} placeholder="例如：首次方案；调整空状态与返回路径" /></label>
    <div className="flex flex-wrap gap-2 mt-3"><button className="btn btn-secondary" disabled={busy || active || !scopeConfirmed || stale || !draft.reason.trim()} onClick={() => void send(false)}>保存 PRD 新版本</button>
      {prd && !prd.confirmedAt ? <button className="btn btn-primary" disabled={busy || active || !scopeConfirmed || stale || dirty || prd.scopeId !== scope.id} onClick={() => void send(true)}>确认 PRD v{prd.version}</button> : null}
      {prd?.confirmedAt && !dirty && prd.scopeId === scope.id ? <span className="text-sm text-mute">当前 PRD 已确认，可开始实施。</span> : null}
      {prd && (dirty || draft.reason) ? <button className="btn btn-ghost" disabled={busy} onClick={() => patch({ expectedPrdId: prd.id, content: prd.content, moduleChanges: prd.moduleChanges, reason: "" })}>放弃未保存的 PRD 修改</button> : null}
    </div>{dirty && prd ? <p className="text-sm text-mute">有未保存的设计调整，请保存新版本后确认。</p> : null}
    {error ? <p className="text-danger" role="alert">{error}</p> : null}
  </section>;
}

export function MarkdownDownload({ name, content }: { name: string; content: string }) {
  return <a className="btn btn-secondary" download={name} href={`data:text/markdown;charset=utf-8,${encodeURIComponent(content)}`}>导出 Markdown</a>;
}

export function ChildRequirement({ state, projectId, prd, moduleId, onClose, onCreated }: {
  state: WorkflowProjectState; projectId: string; prd?: RequirementPrd; moduleId?: string; onClose: () => void; onCreated: (id: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(""); const [description, setDescription] = useState(""); const [criteria, setCriteria] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const moduleIds = moduleId ? [moduleId] : prd?.moduleChanges.map((entry) => entry.moduleId) ?? [];
  return <WorkflowModal title="创建关联子需求" onClose={onClose}><form className="workflow-design" onSubmit={(event) => {
    event.preventDefault(); setBusy(true); setError("");
    void socketClient.send<{ item: { id: string } }>("workItem.create", { projectId, title, description, acceptanceCriteria: criteria, start: false, source: { prdId: prd?.id, moduleIds } }).then((result) => onCreated(result.item.id)).catch((reason) => setError(message(reason))).finally(() => setBusy(false));
  }}><p className="text-sm text-mute">继承关联模块，独立确认与交付；原 PRD 保持固化。</p>{moduleIds.length ? <p className="text-sm">关联模块：{moduleIds.map((id) => state.modules?.find((entry) => entry.id === id)?.name).join("、")}</p> : null}
    <label>子需求标题<input className="field w-full" required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>子需求目标<textarea className="field w-full" rows={4} maxLength={20000} value={description} onChange={(event) => setDescription(event.target.value)} /></label><label>子需求验收标准<textarea className="field w-full" rows={3} maxLength={10000} value={criteria} onChange={(event) => setCriteria(event.target.value)} /></label>
    {error ? <p className="text-danger" role="alert">{error}</p> : null}<button type="submit" className="btn btn-primary" disabled={busy || !title.trim()}>创建子需求并开始讨论</button>
  </form></WorkflowModal>;
}
