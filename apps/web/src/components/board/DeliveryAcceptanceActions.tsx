import { useState } from "react";
import type { DeliveryAcceptance, WorkflowProjectState } from "@qingzhou/protocol";
import type { WorkflowSend } from "../../hooks/useWorkflowAction";
import { hasPrdDraftChanges, readPrdDraftCache } from "../../lib/prd-draft";
import { prdFor } from "../../lib/requirement-planning";
import { ReviewActions } from "./ReviewActions";
import { workflowDate as date } from "../../lib/workflow-presentation";

export function DeliveryAcceptanceActions({ state, deliveryId, current, busy, send, actionsTarget }: { actionsTarget?: HTMLElement | null; state: WorkflowProjectState; deliveryId: string; current: boolean; busy: boolean; send: WorkflowSend }) {
  const delivery = state.deliveries.find((entry) => entry.id === deliveryId)!;
  const prd = prdFor(state, delivery.itemId);
  const unsavedDesign = (() => { try { return !!prd && hasPrdDraftChanges(readPrdDraftCache(`qingzhou:prd-draft:${delivery.itemId}`), prd); } catch { return true; } })();
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
    {acceptance ? acceptance.decision === "accepted" ? <details className="review-hint"><summary>验收记录 · {date(acceptance.createdAt)}</summary><p className="mt-2">{acceptance.note}</p></details> : <p className="text-danger">这个版本需返工。 · {date(acceptance.createdAt)} {acceptance.note}</p> : null}
    {current && acceptance?.decision !== "accepted" ? <><p className="mt-2 font-medium">人工验收当前范围</p>{criteria.map((criterion, index) => <div className="workflow-criterion" key={index}><label className="mt-2 flex items-start gap-2"><input type="checkbox" checked={checked.includes(index)} onChange={(event) => setChecked(event.target.checked ? [...checked, index] : checked.filter((entry) => entry !== index))} />{criterion}</label>
        <details className="mt-2"><summary>记录这条标准的验收依据</summary><label className="block mt-2">人工观察<textarea aria-label={`验收依据 ${index + 1}`} className="field w-full mt-1" rows={2} maxLength={2000} value={evidence[index]?.note ?? ""} onChange={(event) => updateEvidence(index, { note: event.target.value })} placeholder="记录观察到的行为，或引用检查和封存产物。" /></label>
        {verification?.checks.map((check) => <label className="flex items-start gap-2 mt-2" key={check.id}><input type="checkbox" checked={evidence[index]?.checkIds.includes(check.id) ?? false} onChange={(event) => updateEvidence(index, { checkIds: event.target.checked ? [...evidence[index]!.checkIds, check.id] : evidence[index]!.checkIds.filter((id) => id !== check.id) })} />引用检查：{check.name} · {check.status === "passed" ? "通过" : "未通过"}</label>)}
        {delivery.review?.artifactPaths.map((file) => <label className="flex items-start gap-2 mt-2" key={file}><input type="checkbox" checked={evidence[index]?.artifactPaths.includes(file) ?? false} onChange={(event) => updateEvidence(index, { artifactPaths: event.target.checked ? [...evidence[index]!.artifactPaths, file] : evidence[index]!.artifactPaths.filter((path) => path !== file) })} />引用产物：{file}</label>)}
        </details></div>)}
      {unsavedDesign ? <p className="workflow-design-note mt-3" role="alert">有未保存的 PRD 草稿，请回到“设计”保存并确认，或明确放弃草稿后再验收。</p> : null}
      <label className="mt-3 flex items-start gap-2"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />我已审阅这个交付的代码、检查证据与需人工确认的结果{prd ? "，并确认 PRD 与模块设计已同步" : ""}</label>
      <ReviewActions target={actionsTarget}><span className="review-hint">验收后固化本次设计</span><div className="review-action-buttons">      <button className="btn btn-primary mt-3" disabled={busy || unsavedDesign || !reviewed || checked.length !== criteria.length} onClick={() => void send("workflow.accept", { deliveryId, decision: "accepted", note: "已逐条人工确认当前范围验收标准", evidence: evidence.map((row) => ({ ...row, note: row.note.trim() || "用户已逐条人工确认，未补充文字观察。" })) })}>{prdFor(state, delivery.itemId) ? "验收并固化 PRD" : "验收这个版本"}</button>
      <button className="btn btn-ghost mt-3 ml-2" aria-expanded={rejecting} onClick={() => setRejecting(!rejecting)}>需要调整</button>
</div></ReviewActions>
      {rejecting ? <div className="mt-3 rounded-lg border border-line p-3"><label className="block">验收反馈<textarea className="field mt-1 w-full" rows={3} value={note} onChange={(event) => { setNote(event.target.value); setConfirmContinue(false); }} placeholder="记录未达到的标准与需要调整的结果。" /></label><p className="mt-2 text-xs text-mute">可仅记录意见，或审阅下面的反馈后直接开始新一轮实施。</p><button className="btn btn-secondary mt-3" disabled={busy || !note.trim()} onClick={() => { setReviewed(false); setChecked([]); void send("workflow.accept", { deliveryId, decision: "rejected", note: note.trim() }); }}>记录返工意见</button><button className="btn btn-primary mt-3 ml-2" disabled={busy || !note.trim()} onClick={() => setConfirmContinue(true)}>反馈并继续</button>
        {confirmContinue ? <div className="workflow-feedback-confirm mt-3"><strong>确认按以下反馈开始新一轮实施</strong><p className="whitespace-pre-wrap mt-2">{note.trim()}</p><button className="btn btn-primary mt-3" disabled={busy} onClick={() => { void send("workItem.feedback", { id: delivery.itemId, text: note.trim(), expectedDeliveryId: delivery.id }); }}>确认反馈并开始实施</button><button className="btn btn-ghost mt-3" disabled={busy} onClick={() => setConfirmContinue(false)}>返回修改</button></div> : null}
      </div> : null}</> : null}
    {acceptance?.evidence?.length ? <details className="mt-3"><summary>已保存的逐条验收依据</summary>{acceptance.evidence.map((row, index) => <div className="mt-2" key={index}><strong>{row.criterion}</strong><p>{row.note}</p><p className="text-mute">{row.checkIds.map((id) => verification?.checks.find((check) => check.id === id)?.name ?? id).join("、")}{row.artifactPaths.length ? ` · 产物 ${row.artifactPaths.join("、")}` : ""}</p></div>)}</details> : null}
    <ReviewActions target={acceptance?.decision === "accepted" || !current ? actionsTarget : null}><span className="review-hint">{acceptance?.decision === "accepted" ? "当前交付已验收" : "只读交付 · 验证通过后可验收最新版本"}</span>    {current && acceptance?.decision === "accepted" && !state.integrations.some((entry) => entry.deliveryId === deliveryId && ["queued", "preparing", "conflicts", "verifying", "ready", "merging", "merged"].includes(entry.status)) ? <button className="btn btn-primary mt-3" disabled={busy} onClick={() => void send("workflow.integrate", { deliveryId })}>准备合入这个交付</button> : null}</ReviewActions>
  </div>;
}
