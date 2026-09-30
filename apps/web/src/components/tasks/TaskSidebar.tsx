import { useDialogLayer } from "../../hooks/useDialogLayer";
import { useEffect, useRef, useState } from "react";
import { Archive, ChevronRight, MoreHorizontal, Pencil, Pin, PinOff, Plus, Search, X } from "lucide-react";
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
  onShowArchived?: () => void;
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
  onShowArchived,
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
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(sessionStorage.getItem("qingzhou:collapsed-projects") ?? "[]") as string[]); } catch { return new Set(); }
  });
  const [menuId, setMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useDialogLayer(menuRef, () => setMenuId(null), menuId !== null, false);
  useEffect(() => {
    if (!menuId) return;
    const closeOutside = (event: MouseEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenuId(null); };
    document.addEventListener("mousedown", closeOutside);
    return () => document.removeEventListener("mousedown", closeOutside);
  }, [menuId]);
  const searching = Boolean(query.trim());
  function toggleProject(cwd: string) {
    const next = new Set(collapsed);
    if (next.has(cwd)) next.delete(cwd); else next.add(cwd);
    setCollapsed(next);
    try { sessionStorage.setItem("qingzhou:collapsed-projects", JSON.stringify([...next])); } catch { /* Optional preference. */ }
  }
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
        {onShowArchived ? <button type="button" className="pressable app-no-drag icon-btn" aria-label="已归档会话" title="已归档会话" onClick={onShowArchived}><Archive size={14} /></button> : null}
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
      {searching ? <p className="px-4 pb-2 text-[10px] text-mute">搜索时不能调整顺序</p> : null}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {groups.length === 0 ? (
          <div className="px-2 py-4 text-[12px] leading-5 text-mute"><p>{searching ? "没有匹配的会话" : "点击 + 号开始对话"}</p>{searching ? <button type="button" className="pressable mt-2 text-accent" onClick={() => onQuery("")}>清空搜索</button> : null}</div>
        ) : (
          groups.map(([cwd, items]) => (
            <section key={cwd} className="mb-2">
              <h2><button type="button" className="pressable sidebar-project" title={cwd} aria-expanded={searching || !collapsed.has(cwd)} onClick={() => toggleProject(cwd)}><ChevronRight size={11} className={searching || !collapsed.has(cwd) ? "rotate-90" : ""} /><span className="min-w-0 flex-1 truncate">{folderName(cwd)}</span><span className="tabular">{items.length}</span></button></h2>
              <ul hidden={!searching && collapsed.has(cwd)}>
                {items.map((task) => {
                  const active = task.id === activeTaskId;
                  return (
                    <li
                      key={task.id}
                      className="relative"
                      draggable={!searching && Boolean(onReorder) && items.length > 1 && editingId !== task.id}
                      onDragStart={() => setDragId(task.id)}
                      onDragEnd={() => setDragId(null)}
                      onDragOver={(event) => {
                        if (searching || !onReorder || !dragId || dragId === task.id) return;
                        event.preventDefault();
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (searching || !onReorder || !dragId) return;
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
                            title={task.title}
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
                        <div ref={menuId === task.id ? menuRef : undefined} className="sidebar-row-actions">
                          <button type="button" className="pressable source-item-accessory icon-btn" aria-label={`会话操作 ${task.title}`} aria-expanded={menuId === task.id} onClick={() => setMenuId(menuId === task.id ? null : task.id)}><MoreHorizontal size={14} /></button>
                          {menuId === task.id ? <div className="sidebar-row-menu" role="menu" aria-label="会话操作">
                            {onRename ? <button type="button" role="menuitem" className="pressable hover-fill" onClick={() => { setMenuId(null); startRename(task); }}><Pencil size={12} />重命名</button> : null}
                            <button type="button" role="menuitem" className="pressable hover-fill" aria-label={`归档 ${task.title}`} onClick={() => { setMenuId(null); onArchive(task.id); }}><Archive size={12} />归档</button>
                          </div> : null}
                        </div>
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
