import { useId, useState } from "react";
import { Folder } from "lucide-react";
import { isDesktopApp } from "../../desktop-bridge";
import { FolderPicker } from "./FolderPicker";

export function FolderField({ label, value, onChange }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const [browsePath, setBrowsePath] = useState(value);
  const [mode, setMode] = useState<"summary" | "browse" | "type">("summary");
  if (isDesktopApp()) return <FolderPicker initialPath={value || undefined} selectedPath={value} onSelect={onChange} />;

  return <div className="folder-field">
    <div className="folder-field-heading">
      <label htmlFor={mode === "type" ? id : undefined}>{label}</label>
      <div className="flex gap-1">
        <button type="button" className="btn btn-ghost" aria-expanded={mode === "browse"}
          onClick={() => { setBrowsePath(value); setMode(mode === "browse" ? "summary" : "browse"); }}>浏览</button>
        <button type="button" className="btn btn-ghost" aria-expanded={mode === "type"}
          onClick={() => setMode(mode === "type" ? "summary" : "type")}>输入路径</button>
      </div>
    </div>
    {mode === "type" ? <input id={id} aria-label={label} className="field w-full font-mono text-sm"
      value={value} onChange={(event) => onChange(event.target.value)} autoFocus />
      : mode === "browse" ? <FolderPicker initialPath={browsePath || undefined} selectedPath={value} onSelect={onChange} />
        : <div className="folder-field-summary"><Folder size={16} aria-hidden="true" /><p>{value || "请选择文件夹"}</p></div>}
  </div>;
}
