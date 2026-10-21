import { useMemo, useState } from "react";
import { parseGitPatch, type GitPatchFile } from "@qingzhou/protocol";
import { DiffView } from "./DiffView";

const labels = { added: "新增", deleted: "删除", renamed: "重命名", modified: "修改" };
export function PatchDiff({ patch, files: provided, fallback = "没有文件差异。", beforeLabel, afterLabel, layout, initialPath = "" }: {
  layout?: "workspace"; initialPath?: string; patch?: string; files?: GitPatchFile[]; fallback?: string; beforeLabel?: string; afterLabel?: string;
}) {
  const files = useMemo(() => provided ?? parseGitPatch(patch ?? ""), [provided, patch]);
  const [path, setPath] = useState(initialPath);
  const file = files.find((entry) => entry.path === path) ?? files[0];
  if (!file) return <p className="text-sm text-mute mt-3">{patch?.trim() ? "此差异格式无法逐行展示。" : fallback}</p>;
  return <section className={`patch-diff${layout ? " patch-diff-workspace" : ""}`} aria-label="文件差异审阅">
    <nav className="patch-diff-files" aria-label="变更文件">{files.map((entry) => {
      const segments = entry.path.split("/");
      const name = segments.pop();
      const folder = segments.at(-1)?.replace(/-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "");
      return <button key={entry.path} className="btn btn-ghost" title={entry.path} aria-label={entry.path} aria-pressed={entry.path === file.path} onClick={() => setPath(entry.path)}><span>{layout === "workspace" ? <><strong>{name}</strong>{folder ? <small>{folder}</small> : null}</> : entry.path}</span><small>{labels[entry.changeType ?? "modified"]}</small></button>;
    })}</nav>
    <div className="patch-diff-content"><p className="patch-diff-path">{file.oldPath && file.newPath && file.oldPath !== file.newPath ? `${file.oldPath} → ${file.newPath}` : file.path}</p>
      {file.oldMode || file.newMode ? <p className="text-xs text-mute mb-2">文件模式：{file.oldMode ?? "无"} → {file.newMode ?? "无"}</p> : null}
      {file.binary ? <p className="text-sm text-mute">二进制文件变化，无法逐行比较。</p> : <DiffView key={file.path} lines={file.lines} beforeLabel={beforeLabel} afterLabel={afterLabel} fallback={file.changeType === "renamed" ? "文件已重命名，文本内容未变化。" : file.oldMode !== file.newMode ? "仅文件模式变化。" : "没有文本行变化。"} />}
    </div>
  </section>;
}
