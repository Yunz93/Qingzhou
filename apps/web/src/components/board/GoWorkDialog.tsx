import { useDialogLayer } from "../../hooks/useDialogLayer";
import { useRef } from "react";
import { FolderOpen, Plus, X } from "lucide-react";
import type { WorkProject } from "@qingzhou/protocol";

type Props = {
  projects: WorkProject[];
  activeProjectId: string | null;
  onCancel: () => void;
  onSelect: (id: string) => void | Promise<void>;
  onCreate: () => void;
};

export function GoWorkDialog({ projects, activeProjectId, onCancel, onSelect, onCreate }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogLayer(panelRef, onCancel);

  return (
    <div className="dialog-scrim z-40">
      <button type="button" className="absolute inset-0" aria-label="关闭" onClick={onCancel} />
      <div
        ref={panelRef}
        className="dialog-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="go-work-title"
      >
        <div className="dialog-head">
          <div className="dialog-head-text">
            <h2 id="go-work-title" className="dialog-title">
              去工作
            </h2>
            <p className="dialog-copy">选择已有项目，或新建一个项目再进入工作台。</p>
          </div>
          <button type="button" className="pressable icon-btn -mr-1 -mt-1" aria-label="关闭" onClick={onCancel}>
            <X size={16} />
          </button>
        </div>
        <div className="dialog-body space-y-2">
          {projects.length === 0 ? (
            <p className="rounded-md bg-fill px-3 py-3 text-sm text-mute">还没有项目。先新建一个吧。</p>
          ) : (
            <ul className="max-h-64 space-y-1 overflow-auto">
              {projects.map((project) => (
                <li key={project.id}>
                  <button
                    type="button"
                    className={`pressable hover-fill flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left ${
                      project.id === activeProjectId ? "bg-fill" : ""
                    }`}
                    onClick={() => void onSelect(project.id)}
                  >
                    <FolderOpen size={14} className="mt-0.5 shrink-0 text-mute" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">{project.name}</span>
                      <span className="block truncate font-mono text-[11px] text-mute">{project.cwd}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="dialog-actions">
          <button type="button" className="pressable btn btn-ghost" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="pressable btn btn-primary" onClick={onCreate}>
            <Plus size={14} />
            新建项目
          </button>
        </div>
      </div>
    </div>
  );
}
