import { useDialogLayer } from "../../hooks/useDialogLayer";
import { useRef, useState } from "react";
import { X } from "lucide-react";

type Props = {
  projectName: string;
  onCancel: () => void;
  onCreate: (input: {
    title: string;
    description: string;
    acceptanceCriteria: string;
    start: boolean;
  }) => void | Promise<void>;
};

export function NewWorkItemDialog({ projectName, onCancel, onCreate }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [acceptanceCriteria, setAcceptanceCriteria] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"plan" | "start" | null>(null);

  async function submit(start: boolean) {
    if (busy) return;
    if (!title.trim()) {
      setError("请填写任务标题。");
      return;
    }
    setBusy(start ? "start" : "plan");
    setError("");
    try {
      await onCreate({
        title: title.trim(),
        description: description.trim(),
        acceptanceCriteria: acceptanceCriteria.trim(),
        start,
      });
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "创建任务失败");
    } finally {
      setBusy(null);
    }
  }

  const panelRef = useRef<HTMLFormElement>(null);
  useDialogLayer(panelRef, () => { if (!busy) onCancel(); });

  return (
    <div className="dialog-scrim z-40">
      <button type="button" className="absolute inset-0" aria-label="关闭" onClick={() => { if (!busy) onCancel(); }} />
      <form
        ref={panelRef}
        className="dialog-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-work-item-title"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(true);
        }}
      >
        <div className="dialog-head">
          <div className="dialog-head-text">
            <h2 id="new-work-item-title" className="dialog-title">
              新建任务
            </h2>
            <p className="dialog-copy">{projectName}</p>
          </div>
          <button type="button" className="pressable icon-btn -mr-1 -mt-1" aria-label="关闭" onClick={() => { if (!busy) onCancel(); }}>
            <X size={16} />
          </button>
        </div>
        <div className="dialog-body space-y-3">
          <div>
            <label className="block text-sm text-mute" htmlFor="work-item-title">
              标题
            </label>
            <input
              id="work-item-title"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setError("");
              }}
              className="field mt-1 w-full text-sm"
              required
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm text-mute" htmlFor="work-item-description">
              目标说明
            </label>
            <textarea
              id="work-item-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="field mt-1 w-full text-sm"
              rows={4}
              placeholder="要完成什么，有哪些边界或背景。"
            />
          </div>
          <div>
            <label className="block text-sm text-mute" htmlFor="work-item-acceptance">
              验收标准
            </label>
            <textarea
              id="work-item-acceptance"
              value={acceptanceCriteria}
              onChange={(event) => setAcceptanceCriteria(event.target.value)}
              className="field mt-1 w-full text-sm"
              rows={3}
              placeholder="可选。怎样才算完成，例如测试通过、页面可用、没有改动无关文件。"
            />
          </div>
          {error ? (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div className="dialog-actions">
          <button type="button" className="pressable btn btn-ghost" onClick={() => { if (!busy) onCancel(); }} disabled={busy !== null}>
            取消
          </button>
          <button
            type="button"
            className="pressable btn btn-secondary"
            onClick={() => void submit(false)}
            disabled={busy !== null}
          >
            {busy === "plan" ? "正在保存…" : "保存到计划"}
          </button>
          <button type="submit" className="pressable btn btn-primary" disabled={busy !== null}>
            {busy === "start" ? "正在创建…" : "创建并开始"}
          </button>
        </div>
      </form>
    </div>
  );
}
