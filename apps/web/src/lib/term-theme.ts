import type { Theme } from "./theme";

export type TermPalette = {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
};

/** xterm paints this on every default cell; keep it clear so the inspector material shows through. */
export const TERM_TRANSPARENT_BG = "#00000000";

const DARK_TERM: TermPalette = {
  background: TERM_TRANSPARENT_BG,
  foreground: "#e6eddf",
  cursor: "#a0c4a7",
  cursorAccent: "#e6eddf",
  selectionBackground: "rgba(160, 196, 167, 0.38)",
  black: "#1c1c1e",
  red: "#ff6b6b",
  green: "#63d48e",
  yellow: "#e6c36a",
  blue: "#7eb6ff",
  magenta: "#c792ea",
  cyan: "#7ad4d4",
  white: "#ececf1",
  brightBlack: "#8e8e93",
  brightRed: "#ff8a80",
  brightGreen: "#80e0a7",
  brightYellow: "#f0d48a",
  brightBlue: "#9ec6ff",
  brightMagenta: "#d7a8f0",
  brightCyan: "#95e0e0",
  brightWhite: "#ffffff",
};

const LIGHT_TERM: TermPalette = {
  background: TERM_TRANSPARENT_BG,
  foreground: "#29362e",
  cursor: "#426650",
  cursorAccent: "#29362e",
  selectionBackground: "rgba(66, 102, 80, 0.28)",
  black: "#2a2a33",
  red: "#c23b3b",
  green: "#1a7f4c",
  yellow: "#9a6b12",
  blue: "#2f62c4",
  magenta: "#7a4bb8",
  cyan: "#1f7a7a",
  white: "#f3f3f6",
  brightBlack: "#6e6e78",
  brightRed: "#d45353",
  brightGreen: "#2a9a5f",
  brightYellow: "#b07c1a",
  brightBlue: "#4b7ad6",
  brightMagenta: "#9260cc",
  brightCyan: "#2d9090",
  brightWhite: "#1c1c1e",
};

export function resolveCssColor(value: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const probe = document.createElement("div");
  probe.style.color = value;
  probe.style.position = "fixed";
  probe.style.left = "-9999px";
  document.documentElement.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return resolved && resolved !== "rgba(0, 0, 0, 0)" ? resolved : fallback;
}

export function termTheme(theme: Theme): TermPalette {
  const base = theme === "dark" ? DARK_TERM : LIGHT_TERM;
  return {
    ...base,
    background: TERM_TRANSPARENT_BG,
    foreground: resolveCssColor("var(--color-ink)", base.foreground),
    cursor: resolveCssColor("var(--color-accent)", base.cursor),
    cursorAccent: resolveCssColor("var(--color-ink)", base.cursorAccent),
    selectionBackground: resolveCssColor(
      "color-mix(in oklch, var(--color-accent) 38%, transparent)",
      base.selectionBackground,
    ),
  };
}
