export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "qingzhou.theme";
export const LEGACY_THEME_STORAGE_KEY = "mowen.theme";
export const LEGACY_OHMYPI_THEME_STORAGE_KEY = "ohmypi.theme";
export const THEME_EVENT = "qingzhou-theme";

const DARK_THEME_COLOR = "#18211c";
const LIGHT_THEME_COLOR = "#f7f8f5";

export function readTheme(): Theme {
  try {
    const stored =
      localStorage.getItem(THEME_STORAGE_KEY) ??
      localStorage.getItem(LEGACY_THEME_STORAGE_KEY) ??
      localStorage.getItem(LEGACY_OHMYPI_THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // localStorage can throw in private mode
  }
  if (typeof window !== "undefined") {
    try {
      if (window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
    } catch {
      // matchMedia can be missing in tests / older webviews
    }
  }
  return "light";
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  const color = theme === "dark" ? DARK_THEME_COLOR : LIGHT_THEME_COLOR;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  root.style.background = color;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", color);
}

export function persistTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // ignore quota / private mode
  }
  applyTheme(theme);
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function toggleTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}
