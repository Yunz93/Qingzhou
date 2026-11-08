import { useEffect, useState } from "react";
import { verificationIsValid, type WorkflowProjectState, type IntegrationAttempt } from "@qingzhou/protocol";
import type { WorkflowSend } from "../../hooks/useWorkflowAction";
import { attemptLabels } from "../../lib/requirement-state";
import { workflowDate as date } from "../../lib/workflow-presentation";
import { PatchDiff } from "../diff/PatchDiff";
import { ReviewActions } from "./ReviewActions";
import { VerificationDetails } from "./VerificationDetails";

export function IntegrationReview({ state, attempt, busy, send, actionsTarget }: { actionsTarget?: HTMLElement | null; state: WorkflowProjectState; attempt: IntegrationAttempt; busy: boolean; send: WorkflowSend }) {
  const [reviewed, setReviewed] = useState(false);
  const [instruction, setInstruction] = useState("");
  const savedReviewNote = attempt.review?.note ?? "";
  const savedReviewDecision = attempt.review?.decision ?? "compatible";
  const [reviewNote, setReviewNote] = useState(savedReviewNote);
  const [reviewDecision, setReviewDecision] = useState(savedReviewDecision);
  const reviewDirty = reviewNote.trim() !== savedReviewNote || reviewDecision !== savedReviewDecision;
  const candidateReviewed = attempt.review?.candidate === attempt.candidate && attempt.review?.tree === attempt.tree && attempt.review?.decision === "compatible";
  useEffect(() => { setReviewed(false); setReviewNote(savedReviewNote); setReviewDecision(savedReviewDecision); }, [attempt.candidate, attempt.verificationId, savedReviewNote, savedReviewDecision]);
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
    <details className="mt-2 text-sm"><summary>候选相对源交付的组合变化（含主线与冲突修复）</summary><PatchDiff patch={attempt.patch} beforeLabel="源交付" afterLabel="集成候选" fallback="尚无已封存候选差异" /></details>
    {repairable ? <details className="mt-3" open={attempt.status !== "ready"}><summary className="text-sm">{attempt.status === "ready" ? "需要调整候选？展开修复操作" : "处理集成候选"}</summary><div className="mt-3"><label className="text-sm">集成反馈<textarea className="field mt-1 w-full" rows={2} value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="需要产品取舍时说明处理方向" /></label>
      <div className="mt-2 flex flex-wrap gap-2"><button className="btn btn-secondary" disabled={busy} onClick={() => void send("workflow.integration.repair", { id: attempt.id, instruction })}>在原对话处理候选</button><button className="btn btn-secondary" disabled={busy} onClick={() => void send("workflow.integration.recheck", { id: attempt.id })}>封存候选并重新验证</button></div></div></details> : null}
    {attempt.status === "ready" && !readyCurrent ? <p className="mt-3 text-sm text-danger" role="status">候选依据已变化。请取消旧候选后基于最新主线重新准备；当前候选不能直接合入。</p> : null}
    {attempt.status === "ready" && readyCurrent ? <div className="mt-3">
      {attempt.review ? <p role="status" className="text-sm mt-2">{candidateReviewed ? "当前候选复审通过" : "设计发生变化，请取消集成并在设计面板创建关联子需求"}：{attempt.review.note}</p> : null}
      <details key={attempt.review?.createdAt ?? "new"} className="mt-2" open={!attempt.review}><summary>{attempt.review ? "修改复审" : "候选行为复审"}</summary>
      <label className="block text-sm">复审结论<select aria-label="候选复审结论" className="field w-full" value={reviewDecision} onChange={(event) => { setReviewDecision(event.target.value as typeof reviewDecision); setReviewed(false); }}><option value="compatible">符合已确认设计，保留各需求有效行为</option><option value="design_changed">涉及设计变化，需要关联子需求</option></select></label>
      <label className="block text-sm">复审依据<textarea aria-label="候选复审依据" className="field w-full" rows={2} maxLength={4000} value={reviewNote} onChange={(event) => { setReviewNote(event.target.value); setReviewed(false); }} /></label>

      </details>
      <label className="flex items-start gap-2 text-sm mt-3"><input type="checkbox" checked={reviewed} disabled={!candidateReviewed || reviewDirty} onChange={(event) => setReviewed(event.target.checked)} />我已审阅组合后的候选与验证结果，确认将此版本合入主线</label>
</div> : null}
    {!["merged", "cancelled", "stale"].includes(attempt.status) ? <ReviewActions target={actionsTarget}><span className="review-hint">{candidateReviewed ? `候选 ${attempt.candidate?.slice(0, 8)}` : `集成候选 · ${attemptLabels[attempt.status]}`}</span><div className="review-action-buttons">{attempt.status === "ready" && readyCurrent ? <>
      {!attempt.review || reviewDirty ? <button className="btn btn-secondary" disabled={busy || !reviewNote.trim()} onClick={() => void send("workflow.integration.review", { id: attempt.id, candidate: attempt.candidate, decision: reviewDecision, note: reviewNote.trim() })}>{attempt.review ? "更新候选复审" : "记录候选复审"}</button> : null}
      {candidateReviewed ? <button className="btn btn-primary" disabled={busy || !reviewed || reviewDirty} onClick={() => void send("workflow.integration.merge", { id: attempt.id })}>确认合入 {attempt.targetBranch}</button> : null}
    </> : null}</div></ReviewActions> : null}
    {!["merged", "merging", "preparing", "verifying", "cancelled"].includes(attempt.status) ? <button className="btn btn-ghost mt-3" disabled={busy} onClick={() => void send("workflow.integration.cancel", { id: attempt.id })}>取消集成，保留现场</button> : null}
    {["stale", "failed", "cancelled"].includes(attempt.status) ? <button className="btn btn-secondary mt-3" disabled={busy} onClick={() => void send("workflow.integrate", { deliveryId: attempt.deliveryId })}>基于最新主线重新准备</button> : null}
  </details>;
}
