import { useDialogLayer } from "../../hooks/useDialogLayer";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { WorkProject } from "@qingzhou/protocol";

type Props = {
  projects: WorkProject[];
  project?: WorkProject;
  onSelect: (id: string) => void;
  onCreate: () => void;
};

export function WorkProjectPicker({ projects, project, onSelect, onCreate }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useDialogLayer(rootRef, () => setOpen(false), open, false);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="work-project-picker app-no-drag">
      <button
        type="button"
        className="work-project-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="项目"
        title={project?.cwd}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="work-project-button-label">{project?.name ?? "选择项目"}</span>
        <ChevronDown size={16} className="work-project-button-caret" />
      </button>
      {open ? (
        <div className="composer-popover work-project-menu" role="menu" aria-label="项目">
          {projects.length === 0 ? (
            <p className="composer-popover-item text-mute">还没有项目</p>
          ) : (
            projects.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="menuitem"
                className={`pressable composer-popover-item ${entry.id === project?.id ? "composer-popover-active" : ""}`}
                onClick={() => {
                  setOpen(false);
                  if (entry.id !== project?.id) onSelect(entry.id);
                }}
              >
                {entry.name}
              </button>
            ))
          )}
          <div className="composer-popover-sep" />
          <button
            type="button"
            role="menuitem"
            className="pressable composer-popover-item"
            onClick={() => {
              setOpen(false);
              onCreate();
            }}
          >
            新项目…
          </button>
        </div>
      ) : null}
    </div>
  );
}
