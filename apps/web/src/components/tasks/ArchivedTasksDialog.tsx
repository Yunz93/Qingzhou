import { useAgentStore } from "../../stores/agent-store";
import { useEffect, useRef, useState } from "react";
import type { TaskRecord } from "@qingzhou/protocol";
import { X } from "lucide-react";
import { useDialogLayer } from "../../hooks/useDialogLayer";
import { socketClient } from "../../transport/socket-client";
import { folderName } from "../../copy";

type Props = { onClose: () => void; onRestore: (id: string) => Promise<void> };
export function ArchivedTasksDialog({ onClose, onRestore }: Props) {
  const connection = useAgentStore((state) => state.connection);
  const panelRef = useRef<HTMLDivElement>(null);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useDialogLayer(panelRef, onClose);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    if (connection !== "open") return;
    void socketClient.send<{ tasks: TaskRecord[] }>("task.listArchived")
      .then((data) => { if (current) setTasks(data.tasks); })
      .catch((error: unknown) => { if (current) setError(error instanceof Error ? error.message : "读取归档失败"); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [connection, reload]);
  async function restore(id: string) {
    setBusyId(id);
    setError("");
    try {
      await onRestore(id);
      setTasks((current) => current.filter((task) => task.id !== id));
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "恢复失败，请重试");
    } finally { setBusyId(""); }
  }
  return (
    <div className="dialog-scrim z-40">
      <button type="button" className="absolute inset-0" aria-label="关闭" onClick={onClose} />
      <div ref={panelRef} tabIndex={-1} className="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="archived-tasks-title">
        <div className="dialog-head"><h2 id="archived-tasks-title" className="dialog-title">已归档会话</h2><button type="button" className="pressable icon-btn" aria-label="关闭" onClick={onClose}><X size={16} /></button></div>
        <div className="dialog-body">
          {loading ? <p role="status" className="text-sm text-mute">正在读取归档…</p> : tasks.length === 0 && !error ? <p className="text-sm text-mute">没有已归档的会话。</p> : null}
          {error ? <div role="alert" className="flex items-center justify-between gap-3 text-sm text-danger"><span>{error}</span><button type="button" className="pressable text-accent" onClick={() => setReload((value) => value + 1)}>重试</button></div> : null}
          <ul className="max-h-80 space-y-1 overflow-auto">{tasks.map((task) => <li key={task.id} className="flex items-center justify-between gap-3 rounded-md bg-fill px-3 py-2"><div className="min-w-0"><p className="truncate text-sm text-ink" title={task.title}>{task.title}</p><p className="mt-1 truncate text-[11px] text-mute" title={task.cwd}>{folderName(task.cwd)}</p></div><button type="button" className="pressable btn btn-ghost shrink-0" aria-label={`恢复 ${task.title}`} disabled={Boolean(busyId)} onClick={() => void restore(task.id)}>{busyId === task.id ? "恢复中…" : "恢复"}</button></li>)}</ul>
        </div>
      </div>
    </div>
  );
}
