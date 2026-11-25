import { useEffect, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { FolderGit2, MessageSquare, Settings } from "lucide-react";
import { WorkActivity } from "../app/WorkActivity";
import { useAgentStore } from "../../stores/agent-store";

type Section = "conversation" | "projects" | "settings";

export function WorkspaceRail({ section, children }: { section: Section; children?: ReactNode }) {
  const location = useLocation();
  const currentLocation = `${location.pathname}${location.search}`;
  const activeTask = useAgentStore((state) => state.activeTaskId);
  const tasks = useAgentStore((state) => state.tasks);
  const items = useAgentStore((state) => state.workItems);
  const linked = items.some((item) => item.taskId === activeTask);
  useEffect(() => {
    if (section === "projects") saveNavigation("last-work-location", currentLocation);
    else if (section === "conversation" && activeTask && !linked) saveNavigation("last-free-conversation", activeTask);
  }, [section, currentLocation, activeTask, linked]);

  function restoreConversation() {
    if (section === "conversation" && !linked) return;
    const available = tasks.filter((task) => !task.archivedAt && !items.some((item) => item.taskId === task.id));
    const remembered = readNavigation("last-free-conversation", "");
    useAgentStore.getState().setActiveTask(available.find((task) => task.id === remembered)?.id ?? available[0]?.id ?? null);
  }

  const lastProject = readNavigation("last-work-location", "/board");
  const boardLocation = /^\/board(?:\?|$)/.test(lastProject) ? lastProject : "/board";
  return (
    <aside className="flex h-full w-[min(240px,85vw)] shrink-0 flex-col border-r border-divider bg-canvas" aria-label="轻舟导航">
      <Link to="/" className="flex min-h-12 items-center px-4 text-base font-semibold text-ink">轻舟</Link>
      <nav className="grid gap-1 px-2.5" aria-label="工作区">
        <RailLink to="/" onClick={restoreConversation} icon={<MessageSquare size={14} />} selected={section === "conversation"}>对话</RailLink>
        <RailLink to={section === "projects" ? currentLocation : boardLocation} icon={<FolderGit2 size={14} />} selected={section === "projects"}>项目</RailLink>
        <div className="px-1 empty:hidden"><WorkActivity /></div>
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      <div className="p-2.5">
        <RailLink to="/settings" state={{ from: currentLocation }} icon={<Settings size={14} />} selected={section === "settings"}>设置</RailLink>
      </div>
    </aside>
  );
}

function RailLink({ to, state, onClick, icon, children, selected }: { to: string; state?: object; onClick?: () => void; icon: ReactNode; children: ReactNode; selected: boolean }) {
  return <Link to={to} state={state} onClick={onClick} aria-current={selected ? "page" : undefined}
    className={`flex min-h-10 items-center gap-2.5 rounded-md px-2.5 text-sm ${selected ? "bg-accent-soft font-medium text-accent" : "text-ink hover:bg-fill"}`}>
    <span aria-hidden="true">{icon}</span>{children}
  </Link>;
}

function readNavigation(key: string, fallback: string) {
  try { return sessionStorage.getItem(`qingzhou:${key}`) ?? fallback; } catch { return fallback; }
}

function saveNavigation(key: string, value: string) {
  try { sessionStorage.setItem(`qingzhou:${key}`, value); } catch { /* Navigation remains available. */ }
}

export function WorkspaceToolbar({ children }: { children: ReactNode }) {
  return <header className="flex min-h-12 shrink-0 items-center gap-2 bg-canvas px-3 sm:px-5">{children}</header>;
}
