import { useDialogLayer } from "../../hooks/useDialogLayer";
import { useRef, useState } from "react";
import { X } from "lucide-react";
import { FolderField } from "../setup/FolderField";

type Props = {
  defaultCwd: string;
  defaultName?: string;
  onCancel: () => void;
  onCreate: (input: { cwd: string; name: string }) => void | Promise<void>;
};

export function NewWorkProjectDialog({ defaultCwd, defaultName = "", onCancel, onCreate }: Props) {
  const [cwd, setCwd] = useState(defaultCwd);
  const [name, setName] = useState(defaultName);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
        aria-labelledby="new-work-project-title"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          if (!cwd.trim()) {
            setError("请先选择项目文件夹。");
            return;
          }
          if (!name.trim()) {
            setError("请填写项目名称。");
            return;
          }
          setBusy(true);
          setError("");
          void Promise.resolve(onCreate({ cwd: cwd.trim(), name: name.trim() })).catch((cause: unknown) => {
            setError(cause instanceof Error ? cause.message : "启动项目失败");
            setBusy(false);
          });
        }}
      >
        <div className="dialog-head">
          <div className="dialog-head-text">
            <h2 id="new-work-project-title" className="dialog-title">
              启动项目
            </h2>
            <p className="dialog-copy">选择项目文件夹，记录需求并持续推进。</p>
          </div>
          <button type="button" className="pressable icon-btn -mr-1 -mt-1" aria-label="关闭" onClick={() => { if (!busy) onCancel(); }}>
            <X size={16} />
          </button>
        </div>
        <div className="dialog-body space-y-3">
          <FolderField label="项目文件夹" value={cwd} onChange={(next) => { setCwd(next); setError(""); }} />
          <div>
            <label className="block text-sm text-mute" htmlFor="work-project-name">
              项目名称
            </label>
            <input
              id="work-project-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setError("");
              }}
              className="field mt-1 w-full text-sm"
              required
              autoFocus
            />
          </div>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
        </div>
        <div className="dialog-actions">
          <button type="button" className="pressable btn btn-ghost" onClick={() => { if (!busy) onCancel(); }} disabled={busy}>
            取消
          </button>
          <button type="submit" className="pressable btn btn-primary" disabled={busy}>
            启动项目
          </button>
        </div>
      </form>
    </div>
  );
}
