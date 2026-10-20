import { useRef, useState } from "react";
import type { TaskRecord, TimelineMessage, WorkItem, WorkProject } from "@qingzhou/protocol";
import { useDialogLayer } from "../../hooks/useDialogLayer";
import { socketClient } from "../../transport/socket-client";

type Props = { task: TaskRecord; messages: TimelineMessage[]; projects: WorkProject[]; onClose: () => void; onCreated: (id: string) => void };
export function ChatToRequirementDialog({ task, messages, projects, onClose, onCreated }: Props) {
  const candidates = messages.filter((entry) => entry.role === "user" || entry.role === "assistant").slice(-30);
  const [selected, setSelected] = useState<string[]>(() => candidates.slice(-4).map((entry) => entry.id));
  const [projectId, setProjectId] = useState(projects.find((entry) => entry.cwd === task.cwd)?.id ?? projects[0]?.id ?? "");
  const [title, setTitle] = useState(task.title.slice(0, 200));
  const [description, setDescription] = useState(() => candidates.filter((entry) => entry.role === "user").at(-1)?.text.slice(0, 20000) ?? "");
  const [criteria, setCriteria] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLFormElement>(null);
  useDialogLayer(ref, () => { if (!busy) onClose(); });
  const images = candidates.filter((entry) => selected.includes(entry.id)).flatMap((entry) => entry.images ?? []).filter((image) => image.dataUrl?.startsWith("data:image/")).slice(0, 20);
  const excerpt = candidates.filter((entry) => selected.includes(entry.id)).map((entry) => `${entry.role === "user" ? "用户" : "助手"}：${entry.text}`).join("\n\n").slice(0, 20000);
  return <div className="dialog-scrim z-40"><form ref={ref} className="dialog-panel dialog-panel-lg" role="dialog" aria-modal="true" aria-labelledby="convert-chat-title" onSubmit={(event) => {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    void socketClient.send<{ item: WorkItem }>("workItem.create", { projectId, title: title.trim(), description: description.trim(), acceptanceCriteria: criteria.trim(), start: false, source: { taskId: task.id, messageIds: selected, excerpt, images } })
      .then(({ item }) => onCreated(item.id)).catch((reason) => setError(reason instanceof Error ? reason.message : "整理需求失败")).finally(() => setBusy(false));
  }}><div className="dialog-head"><h2 id="convert-chat-title" className="dialog-title flex-1">整理为需求</h2><button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>关闭</button></div>
    <div className="dialog-body space-y-3"><p className="text-sm text-mute">保留原对话；保存后进入需求工作区，不会自动实施。</p>
      <label className="block text-sm">目标项目<select className="field mt-1 w-full" value={projectId} onChange={(event) => { setProjectId(event.target.value); setConfirmed(false); }} required><option value="">选择项目</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      {!projects.length ? <p className="text-sm text-mute">请先通过工作入口创建项目，再回来整理此对话。</p> : null}
      <label className="block text-sm">需求标题<input className="field mt-1 w-full" value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} /></label>
      <details><summary className="text-sm">选择作为依据的聊天片段 · 已选 {selected.length} 条</summary><div className="workflow-source-messages">{candidates.map((entry) => <label className="flex gap-2 text-sm mt-2" key={entry.id}><input type="checkbox" checked={selected.includes(entry.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, entry.id] : selected.filter((id) => id !== entry.id))} /><span><strong>{entry.role === "user" ? "用户" : "助手"}</strong><span className="block whitespace-pre-wrap">{entry.text.slice(0, 800)}{entry.text.length > 800 ? "…" : ""}</span>{entry.images?.length ? <span className="text-mute">原消息含 {entry.images.length} 张图片；可用的图片快照将随所选片段保留。</span> : null}</span></label>)}</div></details>
      <button className="btn btn-secondary" type="button" onClick={() => setDescription(excerpt)}>用所选片段填入目标说明</button>
      <label className="block text-sm">目标说明<textarea className="field mt-1 w-full" rows={4} value={description} maxLength={20000} onChange={(event) => setDescription(event.target.value)} placeholder="整理明确目标、边界和背景；来源片段会单独保留。" /></label>
      <label className="block text-sm">验收标准<textarea className="field mt-1 w-full" rows={3} value={criteria} maxLength={10000} onChange={(event) => setCriteria(event.target.value)} placeholder="可先保存讨论，实施前逐条完善。" /></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />我已确认目标项目与需求范围；原对话产生的代码、未提交改动和验证结果不会自动转为此需求的交付。</label>
      {error ? <p role="alert" className="text-danger text-sm">{error}</p> : null}
    </div><div className="dialog-actions"><button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>取消</button><button className="btn btn-primary" type="submit" disabled={busy || !projectId || !title.trim() || !confirmed}>{busy ? "正在保存…" : "保存并完善需求"}</button></div>
  </form></div>;
}
