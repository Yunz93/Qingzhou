import { useDialogLayer } from "../../hooks/useDialogLayer";
import { useRef, useState } from "react";
import type { PiSessionRef } from "@qingzhou/protocol";
import { X } from "lucide-react";
import { FolderPicker } from "../setup/FolderPicker";
import { isDesktopApp } from "../../desktop-bridge";

type Props = {
  defaultCwd: string;
  sessions?: PiSessionRef[];
  onCancel: () => void;
  onCreate: (cwd?: string, title?: string) => void | Promise<void>;
  onResume?: (session: PiSessionRef) => void | Promise<void>;
};

export function NewTaskDialog({ defaultCwd, sessions = [], onCancel, onCreate, onResume }: Props) {
  const desktop = isDesktopApp();
  const [cwd, setCwd] = useState(defaultCwd);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"browse" | "type">("browse");

  async function submitCreate(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onCreate(cwd.trim() || undefined, title.trim() || undefined);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "创建对话失败");
      setBusy(false);
    }
  }

  async function submitResume(session: PiSessionRef): Promise<void> {
    if (busy || !onResume) return;
    setBusy(true);
    setError("");
    try {
      await onResume(session);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "恢复会话失败");
      setBusy(false);
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
        aria-labelledby="new-task-title"
        onSubmit={(event) => {
          event.preventDefault();
          void submitCreate();
        }}
      >
        <div className="dialog-head">
          <div className="dialog-head-text">
            <h2 id="new-task-title" className="dialog-title">
              新对话
            </h2>
            <p className="dialog-copy">默认使用当前工作文件夹，也可以选择其他文件夹。</p>
          </div>
          <button type="button" className="pressable icon-btn -mr-1 -mt-1" aria-label="关闭" onClick={() => { if (!busy) onCancel(); }}>
            <X size={16} />
          </button>
        </div>

        <div className="dialog-body space-y-3">
          {desktop ? null : (
            <div className="seg">
              <button
                type="button"
                className={`pressable btn ${mode === "browse" ? "seg-active" : "text-mute"}`}
                onClick={() => setMode("browse")}
              >
                浏览
              </button>
              <button
                type="button"
                className={`pressable btn ${mode === "type" ? "seg-active" : "text-mute"}`}
                onClick={() => setMode("type")}
              >
                输入路径
              </button>
            </div>
          )}

          {desktop || mode === "browse" ? (
            <FolderPicker initialPath={defaultCwd || undefined} selectedPath={cwd} onSelect={setCwd} />
          ) : (
            <div>
              <label className="block text-sm text-mute" htmlFor="task-cwd">
                工作文件夹
              </label>
              <input
                id="task-cwd"
                value={cwd}
                onChange={(event) => {
                  setCwd(event.target.value);
                  setError("");
                }}
                className="field mt-1 w-full font-mono text-sm"
                autoFocus
              />
            </div>
          )}

          {error ? <p className="text-sm text-danger">{error}</p> : null}

          <div>
            <label className="block text-sm text-mute" htmlFor="task-title">
              标题
            </label>
            <input
              id="task-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="field mt-1 w-full text-sm"
              placeholder="可选"
            />
          </div>

          {sessions.length > 0 ? (
            <div>
              <p className="text-sm text-mute">继续本机上的 Pi 会话</p>
              <ul className="mt-2 max-h-40 space-y-1 overflow-auto">
                {sessions.slice(0, 12).map((session) => (
                  <li key={session.path}>
                    <button
                      type="button"
                      className="pressable hover-fill block w-full rounded-md px-2 py-2 text-left"
                      onClick={() => void submitResume(session)}
                    >
                      <span className="block truncate text-sm text-ink">
                        {session.name || session.preview || "未命名会话"}
                      </span>
                      <span className="block truncate font-mono text-[11px] text-mute">
                        {session.cwd ?? session.path}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="dialog-actions">
          <button type="button" className="pressable btn btn-ghost" onClick={() => { if (!busy) onCancel(); }} disabled={busy}>
            取消
          </button>
          <button type="submit" className="pressable btn btn-primary" disabled={busy}>
            创建对话
          </button>
        </div>
      </form>
    </div>
  );
}
