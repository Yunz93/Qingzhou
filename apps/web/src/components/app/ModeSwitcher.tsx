import { useEffect } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Sailboat } from "lucide-react";
import { useAgentStore } from "../../stores/agent-store";
import { WorkActivity } from "./WorkActivity";

function saved(key: string, fallback: string) { try { return sessionStorage.getItem(key) || fallback; } catch { return fallback; } }
export function ModeSwitcher() {
  const location = useLocation();
  const activeId = useAgentStore((state) => state.activeTaskId);
  const tasks = useAgentStore((state) => state.tasks);
  const items = useAgentStore((state) => state.workItems);
  const linked = items.some((item) => item.taskId === activeId);
  useEffect(() => {
    try {
      if (location.pathname === "/board") sessionStorage.setItem("qingzhou:last-work-location", `${location.pathname}${location.search}`);
      else if (location.pathname === "/" && activeId && !linked) sessionStorage.setItem("qingzhou:last-free-conversation", activeId);
    } catch { /* Navigation remains available without persistence. */ }
  }, [location.pathname, location.search, activeId, linked]);
  return <div className="mode-navigation"><span className="app-wordmark" aria-hidden="true"><Sailboat size={20} strokeWidth={1.5} />轻舟</span><nav className="seg app-no-drag shrink-0" aria-label="模式">
    <NavLink to="/" end title="按会话组织的探索、问答和临时操作；执行权限由输入框设置决定" aria-label="对话" onClick={() => {
      if (location.pathname === "/board" || linked) {
        const last = saved("qingzhou:last-free-conversation", "");
        const available = tasks.filter((task) => !task.archivedAt && !items.some((item) => item.taskId === task.id));
        useAgentStore.getState().setActiveTask(available.find((task) => task.id === last)?.id ?? available[0]?.id ?? null);
      }
    }} className={({ isActive }) => `pressable btn ${isActive ? "seg-active" : "text-mute"}`}>对话</NavLink>
    <NavLink to={location.pathname === "/board" ? `${location.pathname}${location.search}` : saved("qingzhou:last-work-location", "/board")} aria-label="工作" title="按项目和需求组织，持续管理实施、交付、验收与合入" className={({ isActive }) => `pressable btn ${isActive ? "seg-active" : "text-mute"}`}>工作</NavLink>
  </nav><WorkActivity /></div>;
}
