import { useEffect, useRef, useState } from "react";
import type { WorkflowEvent, WorkflowProjectState, WorkItemSummary, TimelineMessage, ToolExecution } from "@qingzhou/protocol";
import { socketClient } from "../../transport/socket-client";
import { DocumentReader } from "./DocumentReader";
import { MainlineHistory } from "./MainlineHistory";
import { WorkflowModal } from "./WorkflowTabs";
import { splitWorkflowPatch } from "../../lib/workflow-history";
import { requirementStatus } from "../../lib/requirement-state";
import { workPromptSummary } from "../../lib/work-prompt-summary";

const milestones = new Set(["scope.confirmed", "prd.confirmed", "delivery.created", "verification.finished", "delivery.accepted", "delivery.rejected", "main.merged"]);
const important = (event: WorkflowEvent) => milestones.has(event.type) || /(?:failed|interrupted|paused)$/.test(event.type);
const date = (value: string) => new Date(value).toLocaleString("zh-CN");

export function WorkflowHistory({ state, items, onlyItemId, onSelect, onRefresh }: {
  expanded?: boolean; state: WorkflowProjectState; items: WorkItemSummary[]; onlyItemId?: string;
  onSelect?: (item: WorkItemSummary) => void; onRefresh?: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<WorkflowEvent | null>(null);
  const [view, setView] = useState("summary");
  const [file, setFile] = useState("");
  const [mergePatch, setMergePatch] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  const [transcript, setTranscript] = useState<{ messages: TimelineMessage[]; tools: ToolExecution[] } | null>(null);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const replay = useRef<HTMLElement>(null);
  useEffect(() => { if (selected) replay.current?.scrollIntoView({ block: "start", behavior: "smooth" }); }, [selected]);
  const select = (event: WorkflowEvent | null) => { generation.current++; setSelected(event); setView("summary"); setFile(""); setTranscript(null); setMergePatch(null); setError(""); setBusy(false); };
  const events = state.events.filter((event) => !onlyItemId || event.itemId === onlyItemId).slice().reverse();
  const groups = new Map<string, WorkflowEvent[]>();
  for (const event of events) if (event.itemId) groups.set(event.itemId, [...(groups.get(event.itemId) ?? []), event]);
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
  const patches = splitWorkflowPatch(merged ? mergePatch ?? "" : attempt?.patch || delivery?.patch || "");
  const selectedFile = patches.find((entry) => entry.path === file) ?? patches[0];
  const runId = ticket?.runId ?? delivery?.runId ?? (selected?.type === "conversation.captured" ? selected.subjectId : null);
  const loadFiles = async () => {
    setView("files");
    if (!merged || mergePatch !== null || !selected || !attempt?.baseline || !attempt.candidate) return;
    const request = ++generation.current; setBusy(true); setError("");
    try {
      const result = await socketClient.send<{ patch: string }>("workflow.compare", { projectId: selected.projectId, from: attempt.baseline, to: attempt.candidate });
      if (request === generation.current) setMergePatch(result.patch);
    } catch (reason) { if (request === generation.current) setError(reason instanceof Error ? reason.message : "读取文件变化失败"); }
    finally { if (request === generation.current) setBusy(false); }
  };
  const loadConversation = async () => {
    setView("conversation"); if (!runId || transcript) return;
    const request = ++generation.current; setBusy(true); setError("");
    try {
      const result = await socketClient.send<NonNullable<typeof transcript>>("workflow.transcript", { runId });
      if (request === generation.current) setTranscript(result);
    } catch (reason) { if (request === generation.current) setError(reason instanceof Error ? reason.message : "读取对话失败"); }
    finally { if (request === generation.current) setBusy(false); }
  };
  return <section className="workflow-history" aria-label={onlyItemId ? "需求历史" : "项目历史"}>
    <div className="workflow-document-toolbar"><h3>{onlyItemId ? "需求历史" : "项目历史"}</h3>{!onlyItemId ? <button className="btn btn-secondary" onClick={() => setCompare(true)}>比较版本</button> : null}</div>
    <div className="workflow-history-groups">{[...groups].map(([id, history]) => {
      const item = items.find((entry) => entry.id === id);
      const latest = history[0]!;
      const merged = history.find((entry) => entry.type === "main.merged");
      const status = item ? requirementStatus(state, item) : null;
      const checkLabels = { queued: "等待检查", running: "检查中", passed: "检查通过", failed: "检查失败", interrupted: "检查中断", unverified: "尚未验证" };
      return <details key={id} className="workflow-history-group" open={onlyItemId ? true : undefined}>
        <summary>{item?.title ?? state.scopes.find((entry) => entry.itemId === id)?.title ?? "历史需求"}<span className="block text-xs text-mute mt-2">{date(latest.createdAt)} · {status ? `${status.merged ? "已合入" : status.implementation} · ${status.acceptance}${status.delivery ? ` · 交付 ${status.delivery.commit.slice(0, 8)}` : ""}${status.verification ? ` · ${checkLabels[status.verification.status]}` : ""}` : latest.message}</span></summary>
        <ol className="workflow-timeline">{history.filter(important).map((event) => <li key={event.id}><button className="btn btn-ghost text-left" aria-pressed={selected?.id === event.id} onClick={() => select(event)}><time className="block text-xs text-mute">{date(event.createdAt)}</time>{event.message}</button></li>)}</ol>
        {!history.some(important) ? <p className="text-sm text-mute mt-3">尚未形成确认或交付记录。</p> : null}
        {merged ? <p className="text-xs text-mute mt-2">合入记录保留各次当时的检查结论。</p> : null}
        <details className="mt-3"><summary>详细过程 · {history.length} 条记录</summary><ol>{history.map((event) => <li key={event.id}><button className="btn btn-ghost text-left" onClick={() => select(event)}>{date(event.createdAt)} · {event.message}</button></li>)}</ol></details>
      </details>;
    })}</div>
    {!groups.size ? <p className="workflow-empty">尚无需求历史。</p> : null}
    {selected ? <section ref={replay} className="workflow-replay mt-4" aria-label="只读历史回放"><div className="workflow-document-toolbar"><h4>当时记录</h4><button className="btn btn-ghost" onClick={() => select(null)}>关闭回放</button></div>
      <nav className="workflow-history-controls" aria-label="历史记录视图"><button className="btn btn-secondary" aria-pressed={view === "summary"} onClick={() => setView("summary")}>变更说明</button><button className="btn btn-secondary" aria-pressed={view === "files"} onClick={() => void loadFiles()}>文件变化</button><button className="btn btn-secondary" aria-pressed={view === "conversation"} onClick={() => void loadConversation()}>当时对话</button></nav>
      {view === "summary" ? <><p>{selected.message}</p>{verification ? <p className="text-sm text-mute mt-2">{verification.finishedAt && verification.finishedAt <= selected.createdAt ? "当时检查" : "关联交付检查"}：{verification.status === "passed" ? "必需检查通过" : verification.status === "running" || verification.status === "queued" ? "尚未完成" : "未通过或中断"}</p> : null}<DocumentReader>{prd?.content || (scope ? `# ${scope.title}\n\n${scope.description}\n\n## 验收标准\n${scope.acceptanceCriteria}` : delivery?.summary || "此节点没有设计正文。")}</DocumentReader>
        <details><summary>版本与来源</summary><pre className="workflow-code">{JSON.stringify({ event: selected.id, delivery: delivery?.commit, candidate: attempt?.candidate, run: runId }, null, 2)}</pre>{ticket ? <pre className="workflow-code">{ticket.instruction}</pre> : null}</details>
        {verification ? <details className="mt-3"><summary>检查证据</summary>{verification.checks.map((check) => <pre className="workflow-code" key={check.id}>{check.name} · {check.status}{"\n"}{check.output}</pre>)}</details> : null}
      </> : view === "files" ? <><p className="text-xs text-mute mt-3">{merged ? "本次合入相对合入前主线的变化" : attempt ? "候选相对源交付的组合变化" : "源交付相对实施基线的变化"}</p>{busy ? <p role="status">正在读取文件变化…</p> : null}<div className="workflow-replay-files"><ul className="workflow-file-list">{patches.map((entry) => <li key={entry.path}><button className="btn btn-ghost" aria-pressed={selectedFile?.path === entry.path} title={entry.path} onClick={() => setFile(entry.path)}>{entry.path}</button></li>)}</ul><pre className="workflow-code workflow-patch">{selectedFile?.patch || "此节点没有文件差异。"}</pre></div></> : <>{busy ? <p role="status">正在读取当时对话…</p> : null}{!runId ? <p>此节点没有执行对话。</p> : null}{transcript?.messages.filter((entry) => (entry.role === "user" || entry.role === "assistant") && entry.text.trim()).map((entry) => {
        const prompt = entry.role === "user" ? workPromptSummary(entry.text) : null;
        return <section key={entry.id} className="mt-4"><h4>{entry.role === "user" ? "用户" : "助手"}</h4><DocumentReader>{prompt?.goal ?? entry.text}</DocumentReader>{prompt?.structured ? <details><summary>完整执行指令</summary><pre className="workflow-code">{entry.text}</pre></details> : null}</section>;
      })}{transcript ? <details className="mt-3"><summary>完整对话与工具记录 · {transcript.tools.length} 次工具调用</summary><pre className="workflow-code">{JSON.stringify(transcript, null, 2)}</pre></details> : null}</>}
      {error ? <p role="alert" className="text-danger">{error}</p> : null}
      <div className="workflow-document-toolbar">{selected.itemId && onSelect ? <button className="btn btn-secondary" onClick={() => { const item = items.find((entry) => entry.id === selected.itemId); if (item) onSelect(item); }}>打开当前需求</button> : null}
      {selected.type === "main.merged" && attempt?.status === "merged" ? <details><summary>更多操作</summary><button className="btn btn-ghost" disabled={busy} onClick={() => {
        setBusy(true); void socketClient.send("workflow.revert", { integrationId: attempt.id }).then(onRefresh).catch((reason) => setError(reason instanceof Error ? reason.message : "创建撤销需求失败")).finally(() => setBusy(false));
      }}>创建撤销需求，保留后续主线</button></details> : null}</div>
    </section> : null}
    <details className="mt-4"><summary>项目详细过程 · {events.length} 条记录</summary>{events.map((event) => <button key={event.id} className="btn btn-ghost block text-left" onClick={() => select(event)}>{date(event.createdAt)} · {event.message}</button>)}</details>
    {compare ? <WorkflowModal title="比较主线版本" onClose={() => setCompare(false)}><MainlineHistory state={state} items={items} onSelect={onSelect} /></WorkflowModal> : null}
  </section>;
}
