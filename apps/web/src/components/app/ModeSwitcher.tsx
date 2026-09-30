import { NavLink } from "react-router-dom";

export function ModeSwitcher() {
  return (
    <nav className="seg app-no-drag shrink-0" aria-label="模式">
      <NavLink
        to="/"
        end
        className={({ isActive }) => `pressable btn ${isActive ? "seg-active" : "text-mute"}`}
      >
        对话
      </NavLink>
      <NavLink
        to="/board"
        className={({ isActive }) => `pressable btn ${isActive ? "seg-active" : "text-mute"}`}
      >
        工作
      </NavLink>
    </nav>
  );
}
