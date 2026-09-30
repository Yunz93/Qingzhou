import { useRef, useState } from "react";
import { Archive, Pin, PinOff, Plus, Search, X } from "lucide-react";
import type { TaskRecord } from "@qingzhou/protocol";
import { PiStatusRing } from "../status/PiStatusRing";
import { folderName, taskStatusLabel } from "../../copy";
import { groupTasksByProject, moveTaskInGroup } from "../../lib/task-list";

type Props = {
  tasks: TaskRecord[];
  activeTaskId: string | null;
  query: string;
  onQuery: (value: string) => void;
  onSelect: (taskId: string) => void;
  onArchive: (taskId: string) => void;
  onRename?: (taskId: string, title: string) => void;
  onNew?: () => void;
  onClose?: () => void;
  pinned?: boolean;
  onPinToggle?: () => void;
  workTaskIds?: Set<string>;
  onOpenBoard?: () => void;
  onReorder?: (cwd: string, taskIds: string[]) => void;
};

const EMPTY_WORK_TASK_IDS = new Set<string>();

export function TaskSidebar({
  tasks,
  activeTaskId,
  query,
  onQuery,
  onSelect,
  onArchive,
  onRename,
  onNew,
  onClose,
  pinned = true,
  onPinToggle,
  workTaskIds = EMPTY_WORK_TASK_IDS,
  onOpenBoard,
  onReorder,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const skipCommitRef = useRef(false);

  function startRename(task: TaskRecord) {
    if (!onRename) return;
    skipCommitRef.current = false;
    setEditingId(task.id);
    setDraft(task.title);
  }

  function commitRename(task: TaskRecord) {
    if (skipCommitRef.current) {
      skipCommitRef.current = false;
      setEditingId(null);
      return;
    }
    const title = draft.trim().slice(0, 200);
    setEditingId(null);
    if (!title || title === task.title) return;
    onRename?.(task.id, title);
  }

  const filtered = tasks.filter((task) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return task.title.toLowerCase().includes(q) || task.cwd.toLowerCase().includes(q);
  });
  const groups = groupTasksByProject(filtered);

  return (
    <aside className="material-sidebar flex h-full w-[min(228px,90vw)] shrink-0 flex-col border-r border-line" aria-label="会话">
      <div className="traffic-inline app-drag flex h-[52px] items-center gap-1 px-3">
          <p className="flex-1 text-[12px] font-semibold tracking-tight text-ink">会话</p>
        {onNew ? (
          <button
            type="button"
            className="pressable app-no-drag icon-btn"
            aria-label="新对话"
            onClick={onNew}
          >
            <Plus size={15} />
          </button>
        ) : null}
        {onPinToggle ? (
          <button
            type="button"
            className="pressable app-no-drag icon-btn"
            aria-label={pinned ? "取消固定会话列表" : "固定会话列表"}
            aria-pressed={pinned}
            title={pinned ? "取消固定" : "固定在左侧"}
            onClick={onPinToggle}
          >
            {pinned ? <Pin size={14} /> : <PinOff size={14} />}
          </button>
        ) : null}
        {onClose ? (
          <button
            type="button"
            className="pressable app-no-drag icon-btn"
            aria-label="关闭会话列表"
            onClick={onClose}
          >
            <X size={15} />
          </button>
        ) : null}
      </div>
      <div className="px-3 pb-2">
        <label className="search-field">
          <Search size={12} className="text-mute" />
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="搜索"
            aria-label="搜索会话"
            className="h-7 w-full bg-transparent text-[12.5px] text-ink placeholder:text-mute"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {groups.length === 0 ? (
          <p className="px-2 py-4 text-[12px] leading-5 text-mute">点击 + 号开始对话</p>
        ) : (
          groups.map(([cwd, items]) => (
            <section key={cwd} className="mb-2">
              <h2 className="truncate px-2 pb-0.5 text-[11px] font-medium tracking-wide text-mute" title={cwd}>
                {folderName(cwd)}
              </h2>
              <ul>
                {items.map((task) => {
                  const active = task.id === activeTaskId;
                  return (
                    <li
                      key={task.id}
                      draggable={Boolean(onReorder) && items.length > 1 && editingId !== task.id}
                      onDragStart={() => setDragId(task.id)}
                      onDragEnd={() => setDragId(null)}
                      onDragOver={(event) => {
                        if (!onReorder || !dragId || dragId === task.id) return;
                        event.preventDefault();
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (!onReorder || !dragId) return;
                        const next = moveTaskInGroup(
                          items.map((item) => item.id),
                          dragId,
                          task.id,
                        );
                        setDragId(null);
                        if (next) onReorder(cwd, next);
                      }}
                    >
                      <div
                        className={`source-item group flex items-start gap-1 px-1 ${active ? "source-item-active" : "hover-fill"} ${dragId === task.id ? "opacity-50" : ""}`}
                      >
                        {editingId === task.id ? (
                          <form
                            className="flex min-h-7 min-w-0 flex-1 items-center gap-1.5 py-1"
                            onSubmit={(event) => {
                              event.preventDefault();
                              commitRename(task);
                            }}
                          >
                            <PiStatusRing status={task.status} size={11} />
                            <input
                              autoFocus
                              value={draft}
                              onChange={(event) => setDraft(event.target.value)}
                              onBlur={() => commitRename(task)}
                              onKeyDown={(event) => {
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  skipCommitRef.current = true;
                                  setEditingId(null);
                                }
                              }}
                              aria-label="重命名会话"
                              className="h-7 min-w-0 flex-1 rounded-md bg-fill-strong px-1.5 text-[13px] text-ink"
                            />
                          </form>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onSelect(task.id)}
                            onDoubleClick={() => startRename(task)}
                            className="pressable flex min-h-7 min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
                          >
                            <PiStatusRing status={task.status} size={11} />
                            <span className="min-w-0 flex-1">
                              <span className="flex min-w-0 items-center gap-1.5">
                                <span className="block min-w-0 truncate text-[12.5px] font-medium leading-snug text-ink">{task.title}</span>
                                {workTaskIds.has(task.id) ? (
                                  <span className="shrink-0 text-[10px] font-medium text-mute">任务</span>
                                ) : null}
                              </span>
                              <span className="block truncate text-[11px] text-mute">
                                {taskStatusLabel(task.status)}
                              </span>
                            </span>
                            {task.unreadCount > 0 && !active ? (
                              <span className="rounded-pill bg-accent px-1.5 text-[10px] leading-4 text-snow">
                                {task.unreadCount}
                              </span>
                            ) : null}
                          </button>
                        )}
                        <button
                          type="button"
                          className="pressable source-item-accessory mt-0.5 flex h-7 w-7 items-center justify-center rounded-md text-mute hover:text-ink"
                          aria-label={`归档 ${task.title}`}
                          onClick={() => onArchive(task.id)}
                        >
                          <Archive size={13} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
      {onOpenBoard && workTaskIds.size > 0 ? (
        <div className="border-t border-line px-3 py-2">
          <button
            type="button"
            className="pressable hover-fill flex h-8 w-full items-center justify-between rounded-md px-2 text-left text-[12px] text-mute"
            onClick={onOpenBoard}
          >
            <span>打开工作台</span>
          </button>
        </div>
      ) : null}
    </aside>
  );
}
