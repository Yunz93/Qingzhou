import { useEffect, useState } from "react";
import type { ProjectStandardInspection } from "@qingzhou/protocol";
import { socketClient } from "../../transport/socket-client";
import { WorkflowModal } from "./WorkflowTabs";

export function ProjectStandard({ projectId, onClose, onRefresh }: { projectId: string; onClose: () => void; onRefresh: () => Promise<void> }) {
  const [inspection, setInspection] = useState<ProjectStandardInspection>();
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [result, setResult] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true; setError("");
    void socketClient.send<ProjectStandardInspection>("workflow.standard.inspect", { projectId }).then((value) => { if (current) setInspection(value); }).catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : "读取项目文件失败"); });
    return () => { current = false; };
  }, [projectId, retry]);
  return <WorkflowModal title="项目文件与 Agent 规范" onClose={() => { if (!busy) onClose(); }}><section className="workflow-design" aria-label="项目标准文件">
    <p className="text-sm text-mute">仅补齐缺失文件，保留现有内容；改动不会自动提交。</p>
    {inspection ? <><p className="text-sm">标准 v{inspection.version} · 缺失 {inspection.files.filter((file) => file.status === "missing").length} 个文件</p><ul className="workflow-standard-files">{inspection.files.map((file) => <li key={file.path}><details><summary><code>{file.path}</code><span>{file.status === "present" ? "已有 · 保留" : "待建立"}</span></summary><p className="text-sm text-mute">{file.purpose}</p>{file.preview ? <pre className="workflow-document">{file.preview}</pre> : null}</details></li>)}</ul>
      <button className="btn btn-primary" disabled={busy || inspection.ready} onClick={() => {
        setBusy(true); setError(""); setResult(""); void socketClient.send<{ created: string[]; preserved: string[]; inspection: ProjectStandardInspection }>("workflow.standard.initialize", { projectId }).then(async (value) => {
          setInspection(value.inspection); setResult(`已建立 ${value.created.length} 个文件，保留 ${value.preserved.length} 个已有文件。改动尚未提交。`); await onRefresh();
        }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "建立标准文件失败")).finally(() => setBusy(false));
      }}>{busy ? "正在建立…" : inspection.ready ? "标准文件已齐备" : "补齐缺失标准文件"}</button></> : !error ? <p role="status">正在检查项目文件…</p> : null}
    {result ? <p role="status" className="text-sm">{result}</p> : null}{error ? <div role="alert"><p className="text-danger text-sm">{error}</p><button className="btn btn-secondary mt-2" disabled={busy} onClick={() => setRetry((value) => value + 1)}>重新检查</button></div> : null}
  </section></WorkflowModal>;
}
