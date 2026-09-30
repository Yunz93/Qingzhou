import { useDialogLayer } from "../../hooks/useDialogLayer";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAgentStore } from "../../stores/agent-store";
import { socketClient } from "../../transport/socket-client";
import { shortcutLabel } from "../../lib/hotkeys";

type Props = {
  open: boolean;
  onClose: () => void;
  onNewTask: () => void;
  onRenameSession?: () => void;
  onFindInConversation?: () => void;
};

type PaletteItem = {
  id: string;
  label: string;
  shortcut?: string;
  run: () => void;
};

export function CommandPalette({ open, onClose, onNewTask, onRenameSession, onFindInConversation }: Props) {
  const tasks = useAgentStore((state) => state.tasks);
  const workProjects = useAgentStore((state) => state.workProjects);
  const activeTaskId = useAgentStore((state) => state.activeTaskId);
  const navigate = useNavigate();
  const location = useLocation();
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogLayer(panelRef, onClose, open);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setIndex(0);
    }
  }, [open]);

  const items = useMemo(() => {
    const commands: PaletteItem[] = [
      { id: "new", label: "新对话", shortcut: shortcutLabel("Mod+N"), run: onNewTask },
      { id: "board", label: "打开任务", shortcut: shortcutLabel("Mod+Shift+B"), run: () => navigate("/board") },
      { id: "settings", label: "打开设置", shortcut: shortcutLabel("Mod+Comma"), run: () => navigate("/settings", { state: { from: location.pathname + location.search } }) },
      ...(onRenameSession && activeTaskId
        ? [{ id: "rename", label: "重命名会话", run: onRenameSession }]
        : []),
      ...(onFindInConversation && activeTaskId
        ? [{ id: "find", label: "在对话中查找", shortcut: shortcutLabel("Mod+F"), run: onFindInConversation }]
        : []),
      {
        id: "compact",
        label: "压缩上下文",
        run: () => activeTaskId && void socketClient.send("session.compact", {}, activeTaskId),
      },
      {
        id: "abort",
        label: "停止回复",
        shortcut: shortcutLabel("Mod+Period"),
        run: () => activeTaskId && void socketClient.send("agent.abort", {}, activeTaskId),
      },
      {
        id: "clone",
        label: "复制对话",
        run: () => activeTaskId && void socketClient.send("session.clone", {}, activeTaskId),
      },
    ];
    const projectItems: PaletteItem[] = workProjects.map((project) => ({
      id: `project-${project.id}`,
      label: `切换到项目 ${project.name}`,
      run: () => {
        void socketClient.send("workProject.select", { id: project.id });
        navigate("/board");
      },
    }));
    const taskItems: PaletteItem[] = tasks.map((task) => ({
      id: task.id,
      label: `打开 ${task.title}`,
      run: () => void socketClient.send("task.activate", {}, task.id),
    }));
    const q = query.trim().toLowerCase();
    return [...commands, ...projectItems, ...taskItems].filter((item) => item.label.toLowerCase().includes(q));
  }, [location.pathname, location.search, activeTaskId, navigate, onFindInConversation, onNewTask, onRenameSession, query, tasks, workProjects]);

  const safeIndex = items.length === 0 ? 0 : Math.min(index, items.length - 1);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setIndex((current) => (items.length === 0 ? 0 : (current + 1) % items.length));
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setIndex((current) => (items.length === 0 ? 0 : (current - 1 + items.length) % items.length));
      }
      if (event.key === "Enter") {
        const item = items[safeIndex];
        if (!item) return;
        event.preventDefault();
        item.run();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, onClose, open, safeIndex]);

  if (!open) return null;

  return (
    <div className="dialog-scrim items-start pt-[12vh]">
      <button type="button" className="absolute inset-0" aria-label="关闭" onClick={onClose} />
      <div ref={panelRef} tabIndex={-1} className="dialog-panel dialog-panel-cmd" role="dialog" aria-modal="true" aria-label="命令面板">
        <input
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
          }}
          placeholder="搜索会话和命令"
          aria-label="命令面板"
          className="h-10 w-full bg-transparent px-3 text-[15px] text-ink placeholder:text-mute"
        />
        <ul className="mt-1 max-h-72 overflow-auto border-t border-line pt-1">
          {items.map((item, itemIndex) => (
            <li key={item.id}>
              <button
                type="button"
                className={`pressable flex h-8 w-full items-center justify-between rounded-md px-3 text-left text-[13px] text-ink ${itemIndex === safeIndex ? "bg-fill" : "hover-fill"}`}
                onMouseEnter={() => setIndex(itemIndex)}
                onClick={() => {
                  item.run();
                  onClose();
                }}
              >
                <span>{item.label}</span>
                {item.shortcut ? <kbd className="palette-key">{item.shortcut}</kbd> : null}
              </button>
            </li>
          ))}
          {items.length === 0 ? (
            <li className="px-3 py-3 text-sm text-mute">没有匹配的命令</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
