import { useDialogLayer } from "../../hooks/useDialogLayer";
import { useEditorDraft } from "../../hooks/useEditorDraft";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, RotateCcw, Send, Trash2, X } from "lucide-react";
import type { WorkItemDetails, WorkRun } from "@qingzhou/protocol";

type Props = {
  details: WorkItemDetails;
  onClose: () => void;
  onSave: (input: { title: string; description: string; acceptanceCriteria: string }) => void | Promise<void>;
  onFeedback: (text: string) => void | Promise<void>;
  onAccept: () => void;
  onReopen: () => void;
  onDelete: () => void | Promise<void>;
  onOpenConversation: () => void;
};

const RUN_STATUS: Record<WorkRun["status"], string> = {
  queued: "排队中",
  running: "执行中",
  waiting_approval: "等待批准",
  waiting_input: "等待回答",
  succeeded: "本轮已结束",
  failed: "执行失败",
  aborted: "已停止",
};

const RUN_KIND: Record<WorkRun["kind"], string> = {
  initial: "首次执行",
  feedback: "补充后继续",
  retry: "重试",
  migrated: "历史执行",
};

export function WorkObjectivePanel({
  details,
  onClose,
  onSave,
  onFeedback,
  onAccept,
  onReopen,
  onDelete,
  onOpenConversation,
}: Props) {
  const { item, runs, feedback } = details;
  const editor = useEditorDraft(`qingzhou:objective:${item.id}`, { title: item.title, description: item.description, acceptanceCriteria: item.acceptanceCriteria });
  const { title, description, acceptanceCriteria } = editor.draft;
  const feedbackEditor = useEditorDraft(`qingzhou:feedback:${item.id}`, { text: "" });
  const feedbackText = feedbackEditor.draft.text;
  const setFeedbackText = (text: string) => feedbackEditor.update({ text });
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const panelRef = useRef<HTMLElement>(null);
  useDialogLayer(panelRef, onClose);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    setConfirmDelete(false);
    setDeleteBusy(false);
  }, [item.id, item.title, item.description, item.acceptanceCriteria]);

  const dirty =
    title.trim() !== item.title ||
    description.trim() !== item.description ||
    acceptanceCriteria.trim() !== item.acceptanceCriteria;
  const activeRun = runs.some((run) =>
    ["queued", "running", "waiting_approval", "waiting_input"].includes(run.status),
  );

  return (
    <div className="work-panel-layer" role="presentation">
      <button type="button" className="work-panel-scrim" aria-label="关闭目标详情" onClick={onClose} />
      <aside ref={panelRef} tabIndex={-1} className="work-panel" role="dialog" aria-modal="true" aria-labelledby="work-panel-title">
        <header className="work-panel-head">
          <div>
            <p className="work-panel-kicker">任务</p>
            <h2 id="work-panel-title">{item.title}</h2>
          </div>
          <button type="button" className="pressable icon-btn" aria-label="关闭" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="work-panel-body">
          <section className="work-panel-section" aria-labelledby="work-goal-heading">
            <div className="work-panel-section-head">
              <h3 id="work-goal-heading">目标定义</h3>
              {dirty ? (
                <button
                  type="button"
                  className="pressable btn btn-secondary"
                  disabled={!title.trim() || saveBusy}
                  onClick={async () => {
                    setSaveBusy(true);
                    setSaveError("");
                    setSaveMessage("");
                    try {
                      await onSave({ title: title.trim(), description: description.trim(), acceptanceCriteria: acceptanceCriteria.trim() });
                      editor.clear(editor.draft);
                      setSaveMessage("已保存");
                    } catch (error: unknown) {
                      setSaveError(error instanceof Error ? error.message : "保存失败，请重试");
                    } finally { setSaveBusy(false); }
                  }}
                >
                  {saveBusy ? "正在保存…" : "保存修改"}
                </button>
              ) : null}
            </div>
            {dirty ? <div className="draft-notice"><span>草稿已暂存，关闭后可继续编辑</span><button type="button" className="pressable text-accent" disabled={saveBusy} onClick={() => editor.discard()}>放弃修改</button></div> : null}
            {saveError ? <p role="alert" className="text-sm text-danger">{saveError}</p> : saveMessage ? <p role="status" className="text-sm text-success">{saveMessage}</p> : null}
            <label className="work-field-label" htmlFor="objective-title">
              标题
            </label>
            <input
              id="objective-title"
              className="field w-full"
              value={title}
              onChange={(event) => editor.update({ ...editor.draft, title: event.target.value })}
            />
            <label className="work-field-label" htmlFor="objective-description">
              目标说明
            </label>
            <textarea
              id="objective-description"
              className="field w-full"
              rows={5}
              value={description}
              placeholder="要完成什么，有哪些背景与边界。"
              onChange={(event) => editor.update({ ...editor.draft, description: event.target.value })}
            />
            <label className="work-field-label" htmlFor="objective-acceptance">
              验收标准
            </label>
            <textarea
              id="objective-acceptance"
              className="field w-full"
              rows={4}
              value={acceptanceCriteria}
              placeholder="怎样才算完成，例如测试通过、页面可用、没有改动无关文件。"
              onChange={(event) => editor.update({ ...editor.draft, acceptanceCriteria: event.target.value })}
            />
          </section>

          {item.state === "open" && !activeRun ? (
            <section className="work-panel-section" aria-labelledby="work-feedback-heading">
              <div className="work-panel-section-head">
                <div>
                  <h3 id="work-feedback-heading">补充要求并继续</h3>
                  <p>Agent 会基于已有进度开启新一轮执行。</p>
                </div>
              </div>
              <textarea
                className="field w-full"
                rows={4}
                value={feedbackText}
                placeholder="说明哪里需要调整、补充或继续推进。"
                onChange={(event) => setFeedbackText(event.target.value)}
              />
              <div className="work-panel-inline-actions">
                <button
                  type="button"
                  className="pressable btn btn-primary"
                  disabled={!feedbackText.trim() || feedbackBusy}
                  onClick={() => {
                    const text = feedbackText.trim();
                    if (!text || feedbackBusy) return;
                    setFeedbackBusy(true);
                    void Promise.resolve(onFeedback(text))
                      .then(() => feedbackEditor.clear({ text: feedbackText }))
                      .catch((error: unknown) => setSaveError(error instanceof Error ? error.message : "继续执行失败"))
                      .finally(() => setFeedbackBusy(false));
                  }}
                >
                  <Send size={13} />
                  继续执行
                </button>
              </div>
            </section>
          ) : null}

          <section className="work-panel-section" aria-labelledby="work-history-heading">
            <div className="work-panel-section-head">
              <div>
                <h3 id="work-history-heading">执行记录</h3>
                <p>
                  {runs.length} 轮执行，{feedback.length} 条补充要求
                </p>
              </div>
              {item.taskId ? (
                <button type="button" className="pressable btn btn-ghost" onClick={onOpenConversation}>
                  打开对话
                  <ArrowUpRight size={13} />
                </button>
              ) : null}
            </div>
            {runs.length > 0 ? (
              <ol className="work-run-list">
                {runs.map((run) => (
                  <li key={run.id} className={`work-run work-run-${run.status}`}>
                    <div className="work-run-head">
                      <strong>{RUN_KIND[run.kind]}</strong>
                      <span>{RUN_STATUS[run.status]}</span>
                    </div>
                    <time dateTime={run.createdAt}>{formatDate(run.createdAt)}</time>
                    {run.resultSummary ? <p>{run.resultSummary}</p> : null}
                    {run.errorMessage ? <p className="text-danger">{run.errorMessage}</p> : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="work-panel-empty">还没有执行记录。</p>
            )}
          </section>
        </div>

        <footer className="work-panel-foot">
          <div className="work-panel-foot-start">
            {confirmDelete ? (
              <>
                <span className="text-[11px] text-mute">删除后不可恢复</span>
                <button
                  type="button"
                  className="pressable btn btn-ghost"
                  disabled={deleteBusy}
                  onClick={() => setConfirmDelete(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="pressable btn btn-danger"
                  disabled={deleteBusy}
                  onClick={() => {
                    if (deleteBusy) return;
                    setDeleteBusy(true);
                    void Promise.resolve(onDelete()).catch((error: unknown) => setSaveError(error instanceof Error ? error.message : "删除失败")).finally(() => setDeleteBusy(false));
                  }}
                >
                  <Trash2 size={13} />
                  {deleteBusy ? "删除中…" : "确认删除"}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="pressable btn btn-ghost text-danger"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={13} />
                删除
              </button>
            )}
          </div>
          <div className="work-panel-foot-end">
            {item.state === "completed" ? (
              <button type="button" className="pressable btn btn-secondary" onClick={onReopen}>
                <RotateCcw size={13} />
                重新打开
              </button>
            ) : !activeRun && runs.at(0)?.status === "succeeded" ? (
              <button type="button" className="pressable btn btn-primary" onClick={onAccept}>
                <Check size={13} />
                接受并完成
              </button>
            ) : null}
          </div>
        </footer>
      </aside>
    </div>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
