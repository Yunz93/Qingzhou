import { useEffect, useRef, useState } from "react";
import type { WorkflowEvent, WorkflowProjectState, WorkItemSummary, TimelineMessage, ToolExecution } from "@qingzhou/protocol";
import { socketClient } from "../../transport/socket-client";
import { DocumentReader } from "./DocumentReader";
import { MainlineHistory } from "./MainlineHistory";
import { WorkflowModal } from "./WorkflowTabs";
import { historyEvents } from "../../lib/workflow-history";
import { PatchDiff } from "../diff/PatchDiff";
import { workPromptSummary } from "../../lib/work-prompt-summary";

const date = (value: string) => new Date(value).toLocaleString("zh-CN");

type Props = {
  expanded?: boolean; state: WorkflowProjectState; items: WorkItemSummary[]; onlyItemId?: string;
  onSelect?: (item: WorkItemSummary) => void; onRefresh?: () => Promise<void>;
};
export function WorkflowHistory(props: Props) {
  return <HistoryContent key={`${props.state.configs[0]?.projectId}:${props.onlyItemId ?? "project"}`} {...props} />;
}
function HistoryContent({ state, items, onlyItemId, onSelect, onRefresh }: Props) {
  const [all, setAll] = useState(false);
  const [selected, setSelected] = useState<WorkflowEvent | null>(null);
  const [view, setView] = useState("summary");
  const [mergePatch, setMergePatch] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  const [transcript, setTranscript] = useState<{ messages: TimelineMessage[]; tools: ToolExecution[] } | null>(null);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const replay = useRef<HTMLElement>(null);
  useEffect(() => { if (selected) replay.current?.scrollIntoView({ block: "start" }); }, [selected]);
  useEffect(() => () => { generation.current++; }, []);
  const changeView = (next: string) => { generation.current++; setBusy(false); setError(""); setView(next); };
  const select = (event: WorkflowEvent | null) => { generation.current++; setSelected(event); setView("summary"); setTranscript(null); setMergePatch(null); setError(""); setBusy(false); };
  const events = historyEvents(state.events, onlyItemId, all);
  const selectedVerification = state.verifications.find((entry) => entry.id === selected?.subjectId);
  const checkedAttempt = selectedVerification?.phase === "integration" ? [
    ...state.events.flatMap((event) => event.facts?.integration ? [event.facts.integration] : []), ...state.integrations,
  ].find((entry) => entry.id === selectedVerification.subjectId && entry.verificationId === selectedVerification.id) : undefined;
  const attempt = selected?.facts?.integration ?? state.integrations.find((entry) => entry.id === selected?.subjectId) ?? checkedAttempt;
  const acceptance = state.acceptances.find((entry) => entry.id === selected?.subjectId);
  const delivery = state.deliveries.find((entry) => entry.id === selected?.subjectId || entry.id === attempt?.deliveryId || entry.id === acceptance?.deliveryId || entry.verificationId === selected?.subjectId || (selectedVerification?.phase === "delivery" && entry.id === selectedVerification.subjectId));
  const ticket = selected?.facts?.ticket ?? state.tickets.find((entry) => entry.id === selected?.subjectId);
  const scope = state.scopes.find((entry) => entry.id === (delivery?.scopeId ?? ticket?.scopeId ?? acceptance?.scopeId ?? selected?.subjectId));
  const prd = state.prds?.find((entry) => entry.id === (delivery?.prdId ?? ticket?.prdId ?? selected?.subjectId));
  const verification = selectedVerification ?? state.verifications.find((entry) => entry.id === attempt?.verificationId) ?? state.verifications.find((entry) => entry.id === delivery?.verificationId);
  const merged = selected?.type === "main.merged";
  const patch = merged ? mergePatch ?? "" : attempt?.patch || delivery?.patch || "";
  const runId = ticket?.runId ?? delivery?.runId ?? (selected?.type === "conversation.captured" ? selected.subjectId : null);
  const loadFiles = async () => {
    changeView("files");
    if (!merged || mergePatch !== null || !selected || !attempt?.baseline || !attempt.candidate) return;
    const request = ++generation.current; setBusy(true); setError("");
    try {
      const result = await socketClient.send<{ patch: string }>("workflow.compare", { projectId: selected.projectId, from: attempt.baseline, to: attempt.candidate });
      if (request === generation.current) setMergePatch(result.patch);
    } catch (reason) { if (request === generation.current) setError(reason instanceof Error ? reason.message : "读取文件变化失败"); }
    finally { if (request === generation.current) setBusy(false); }
  };
  const loadConversation = async () => {
    changeView("conversation"); if (!runId || transcript) return;
    const request = ++generation.current; setBusy(true); setError("");
    try {
      const result = await socketClient.send<NonNullable<typeof transcript>>("workflow.transcript", { runId });
      if (request === generation.current) setTranscript(result);
    } catch (reason) { if (request === generation.current) setError(reason instanceof Error ? reason.message : "读取对话失败"); }
    finally { if (request === generation.current) setBusy(false); }
  };
  return <section className="workflow-history" aria-label={onlyItemId ? "需求历史" : "项目历史"}>
    {onlyItemId ? <div className="review-toolbar"><h3>需求变更历史</h3><select className="review-version-select" aria-label="历史筛选" value={all ? "all" : "milestones"} onChange={(event) => { const next = event.target.value === "all"; setAll(next); if (selected && !historyEvents(state.events, onlyItemId, next).some((entry) => entry.id === selected.id)) select(null); }}><option value="milestones">关键节点</option><option value="all">全部事件</option></select></div> : <>    <div className="workflow-document-toolbar"><h3>{onlyItemId ? "需求历史" : "项目历史"}</h3>{!onlyItemId ? <button className="btn btn-secondary" onClick={() => setCompare(true)}>比较版本</button> : null}</div>
    <div className="workflow-history-controls" role="group" aria-label="历史筛选">{[{ value: false, label: "关键事件" }, { value: true, label: "全部事件" }].map((filter) => <button key={filter.label} className="btn btn-secondary" aria-pressed={all === filter.value} onClick={() => { setAll(filter.value); if (selected && !historyEvents(state.events, onlyItemId, filter.value).some((entry) => entry.id === selected.id)) select(null); }}>{filter.label}</button>)}</div>
</>}
    <ol className="workflow-timeline">{events.map((event) => <li key={event.id}><button className="btn btn-ghost" aria-pressed={selected?.id === event.id} onClick={() => select(event)}><time className="block text-xs text-mute">{date(event.createdAt)}</time><span>{event.message}</span>{!onlyItemId && event.itemId ? <span className="block text-xs text-mute">{items.find((item) => item.id === event.itemId)?.title ?? "历史需求"}</span> : null}</button></li>)}</ol>
    {!events.length ? <p className="workflow-empty">{all ? "尚无历史记录。" : "尚无关键历史记录。"}</p> : null}
    {selected ? <section ref={replay} className="workflow-replay mt-4" aria-label="只读历史回放"><div className="workflow-document-toolbar"><h4>当时记录</h4><button className="btn btn-ghost" onClick={() => select(null)}>关闭回放</button></div>
      <nav className="workflow-history-controls" aria-label="历史记录视图"><button className="btn btn-secondary" aria-pressed={view === "summary"} onClick={() => changeView("summary")}>变更说明</button><button className="btn btn-secondary" aria-pressed={view === "files"} onClick={() => void loadFiles()}>文件变化</button><button className="btn btn-secondary" aria-pressed={view === "conversation"} onClick={() => void loadConversation()}>当时对话</button></nav>
      {view === "summary" ? <><p>{selected.message}</p>{verification ? <p className="text-sm text-mute mt-2">{verification.finishedAt && verification.finishedAt <= selected.createdAt ? "当时检查" : "关联交付检查"}：{verification.status === "passed" ? "必需检查通过" : verification.status === "running" || verification.status === "queued" ? "尚未完成" : "未通过或中断"}</p> : null}<DocumentReader>{prd?.content || (scope ? `# ${scope.title}\n\n${scope.description}\n\n## 验收标准\n${scope.acceptanceCriteria}` : delivery?.summary || "此节点没有设计正文。")}</DocumentReader>
        <details><summary>版本与来源</summary><pre className="workflow-code">{JSON.stringify({ event: selected.id, delivery: delivery?.commit, candidate: attempt?.candidate, run: runId }, null, 2)}</pre>{ticket ? <pre className="workflow-code">{ticket.instruction}</pre> : null}</details>
        {verification ? <details className="mt-3"><summary>检查证据</summary>{verification.checks.map((check) => <pre className="workflow-code" key={check.id}>{check.name} · {check.status}{"\n"}{check.output}</pre>)}</details> : null}
      </> : view === "files" ? <><p className="text-xs text-mute mt-3">{merged ? "本次合入相对合入前主线的变化" : attempt?.patch ? "候选相对源交付的组合变化" : "源交付相对实施基线的变化"}</p>{busy ? <p role="status">正在读取文件变化…</p> : null}{!busy && !error ? <PatchDiff key={selected.id} patch={patch} fallback="此节点没有文件差异。" /> : null}</> : <>{busy ? <p role="status">正在读取当时对话…</p> : null}{!runId ? <p>此节点没有执行对话。</p> : null}{transcript?.messages.filter((entry) => (entry.role === "user" || entry.role === "assistant") && entry.text.trim()).map((entry) => {
        const prompt = entry.role === "user" ? workPromptSummary(entry.text) : null;
        return <section key={entry.id} className="mt-4"><h4>{entry.role === "user" ? "用户" : "助手"}</h4><DocumentReader>{prompt?.goal ?? entry.text}</DocumentReader>{prompt?.structured ? <details><summary>完整执行指令</summary><pre className="workflow-code">{entry.text}</pre></details> : null}</section>;
      })}{transcript ? <details className="mt-3"><summary>完整对话与工具记录 · {transcript.tools.length} 次工具调用</summary><pre className="workflow-code">{JSON.stringify(transcript, null, 2)}</pre></details> : null}</>}
      {error ? <p role="alert" className="text-danger">{error}</p> : null}
      <div className="workflow-document-toolbar">{selected.itemId && onSelect ? <button className="btn btn-secondary" onClick={() => { const item = items.find((entry) => entry.id === selected.itemId); if (item) onSelect(item); }}>打开当前需求</button> : null}
      {selected.type === "main.merged" && attempt?.status === "merged" ? <details><summary>更多操作</summary><button className="btn btn-ghost" disabled={busy} onClick={() => {
        setBusy(true); void socketClient.send("workflow.revert", { integrationId: attempt.id }).then(onRefresh).catch((reason) => setError(reason instanceof Error ? reason.message : "创建撤销需求失败")).finally(() => setBusy(false));
      }}>创建撤销需求，保留后续主线</button></details> : null}</div>
    </section> : null}
    {compare ? <WorkflowModal title="比较主线版本" onClose={() => setCompare(false)}><MainlineHistory state={state} items={items} onSelect={onSelect} /></WorkflowModal> : null}
  </section>;
}
