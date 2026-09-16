import { Moon, Sun } from "lucide-react";
import { toggleTheme } from "../../lib/theme";
import { useTheme } from "../../hooks/useTheme";

export function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const next = toggleTheme(theme);
  const label = next === "light" ? "切换到浅色" : "切换到深色";

  return (
    <button
      type="button"
      className="pressable app-no-drag icon-btn"
      aria-label={label}
      title={label}
      onClick={() => setTheme(next)}
    >
      {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
