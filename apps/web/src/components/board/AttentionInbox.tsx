import { useState } from "react";
import type { WorkflowProjectState, WorkItemSummary } from "@qingzhou/protocol";
import { useAgentStore } from "../../stores/agent-store";
import { requirementStatus } from "../../lib/requirement-state";

export function useAttentionItems(state: WorkflowProjectState, items: WorkItemSummary[]) {
  const approvals = useAgentStore((store) => store.pendingApprovals);
  const questions = useAgentStore((store) => store.pendingInteractions);
  return items.filter((item) => item.state !== "archived").flatMap((item) => {
    const action = approvals.some((entry) => entry.taskId === item.taskId) ? { kind: "approval", reason: "执行等待操作审批", label: "处理审批", view: "scope" as const }
      : questions.some((entry) => entry.taskId === item.taskId) ? { kind: "question", reason: "Agent 需要你的回答", label: "回答问题", view: "scope" as const } : requirementStatus(state, item).action;
    return action ? [{ item, action }] : [];
  });
}
export function AttentionInbox({ state, items, onSelect }: { state: WorkflowProjectState; items: WorkItemSummary[]; onSelect: (item: WorkItemSummary, panel: string) => void }) {
  const entries = useAttentionItems(state, items);
  const [filter, setFilter] = useState("");
  const labels: Record<string, string> = { design: "需求与 PRD 确认", approval: "操作审批", question: "等待回答", acceptance: "交付验收", merge: "确认合入", integration: "冲突与集成失败", rework: "需返工", failure: "中断与失败", verification: "封存与验证" };
  const visible = entries.filter((entry) => !filter || entry.action.kind === filter);
  return <section className="workflow-inbox" aria-label="项目待我处理">
    <label className="text-sm">事项类型 <select aria-label="筛选待处理事项" className="field" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="">全部（{entries.length}）</option>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}（{entries.filter((entry) => entry.action.kind === key).length}）</option>)}</select></label>
    <ul>{visible.map(({ item, action }) => <li key={item.id}><div><span className="workflow-eyebrow">{labels[action.kind]}</span><h4>{item.title}</h4><p>{action.reason}</p></div><button className="btn btn-primary" onClick={() => onSelect(item, action.view === "conversation" ? "scope" : action.view)}>{action.label}</button></li>)}</ul>
    {!visible.length ? <div className="workflow-empty"><h3>{entries.length ? "该类型暂无待处理事项" : "当前没有待处理事项"}</h3></div> : null}
  </section>;
}
