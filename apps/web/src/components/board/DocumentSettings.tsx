import { useState } from "react";
import { DEFAULT_DOCUMENT_PATHS, documentPathsSchema, type DocumentInspection, type WorkflowProjectState } from "@qingzhou/protocol";
import { socketClient } from "../../transport/socket-client";
import { DocumentPath } from "./DocumentPath";

export function DocumentSettings({ projectId, state }: { projectId: string; state: WorkflowProjectState }) {
  const [paths, setPaths] = useState(state.documentPaths ?? DEFAULT_DOCUMENT_PATHS);
  const [inspection, setInspection] = useState<DocumentInspection>();
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const act = async (action: () => Promise<void>) => {
    setBusy(true); setError(""); setNotice("");
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : "文档操作失败"); } finally { setBusy(false); }
  };
  return <fieldset className="workflow-design-section" disabled={busy}><legend>文档位置</legend>
    {state.documentPathsError ? <div><p role="alert" className="text-danger">{state.documentPathsError}</p><DocumentPath projectId={projectId} path="docs/qingzhou/project.json" /></div> : null}
    <p className="text-sm text-mute">填写项目内的相对目录。修改仅作用于新文档，已有文件保留绑定路径。</p>
    <label className="block mt-2">PRD 目录<input aria-label="PRD 目录" className="field w-full" value={paths.prds} onChange={(event) => { setPaths({ ...paths, prds: event.target.value }); setInspection(undefined); }} /></label>
    <label className="block mt-2">模块目录<input aria-label="模块目录" className="field w-full" value={paths.modules} onChange={(event) => { setPaths({ ...paths, modules: event.target.value }); setInspection(undefined); }} /></label>
    <p className="text-xs text-mute mt-2 break-all">路径示例：{paths.prds}/需求名称-需求ID/PRD.md</p>
    <div className="flex flex-wrap gap-2 mt-3"><button type="button" className="btn btn-secondary" onClick={() => void act(async () => {
      const parsed = documentPathsSchema.safeParse(paths);
      if (!parsed.success) {
        const issue = parsed.error.issues[0]!;
        const label = issue.path[0] === "prds" ? "PRD 目录" : issue.path[0] === "modules" ? "模块目录" : "文档目录";
        throw new Error(`${label}：${issue.message}`);
      }
      await socketClient.send("workflow.documents.configure", { projectId, paths: parsed.data }); setNotice("文档位置已保存；已有文件路径不变。"); setInspection(undefined);
    })}>保存文档位置</button><button type="button" className="btn btn-ghost" onClick={() => void act(async () => {
      setInspection(await socketClient.send<DocumentInspection>("workflow.documents.inspect", { projectId }));
    })}>预览旧文档导入</button></div>
    {inspection ? <div className="mt-3"><p className="text-sm">待检查 {inspection.files.length} 个文件，需写入 {inspection.files.filter((entry) => entry.status === "ready").length} 个，冲突 {inspection.files.filter((entry) => entry.status === "conflict").length} 个。</p>
      <ul className="workflow-file-list">{inspection.files.map((entry, index) => <li key={`${entry.path}:${index}`}><span>{entry.source} · {entry.status === "ready" ? "待写入" : entry.status === "present" ? "内容一致" : "内容冲突"}</span><code className="block break-all">{entry.path}</code></li>)}</ul>
      <button type="button" className="btn btn-secondary" disabled={!inspection.files.length || inspection.files.some((entry) => entry.status === "conflict")} onClick={() => void act(async () => {
        await socketClient.send("workflow.documents.import", { projectId }); setInspection(await socketClient.send<DocumentInspection>("workflow.documents.inspect", { projectId })); setNotice("已导入 Markdown，保留原版本与确认记录。");
      })}>导入已有文档</button></div> : null}
    {notice ? <p role="status" className="mt-2 text-sm">{notice}</p> : null}{error ? <p role="alert" className="text-danger mt-2">{error}</p> : null}
  </fieldset>;
}
