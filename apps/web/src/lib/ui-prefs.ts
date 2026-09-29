export const LEFT_PINNED_KEY = "qingzhou.ui.leftPinned";
export const RIGHT_PINNED_KEY = "qingzhou.ui.rightPinned";
export const INSPECTOR_OPEN_KEY = "qingzhou.ui.inspectorOpen";
export const INSPECTOR_WIDTH_KEY = "qingzhou.ui.inspectorWidth";
export const BOARD_SHOW_ARCHIVED_KEY = "qingzhou.ui.boardShowArchived";
export const BUSY_SEND_MODE_KEY = "qingzhou.ui.busySendMode";

export type BusySendMode = "steer" | "followUp";

export const INSPECTOR_WIDTH_MIN = 320;
export const INSPECTOR_WIDTH_DEFAULT = 360;

function legacyUiKey(key: string): string | null {
  if (key.startsWith("qingzhou.")) return `mowen.${key.slice("qingzhou.".length)}`;
  return null;
}

export function readUiFlag(key: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(key) ?? (legacyUiKey(key) ? localStorage.getItem(legacyUiKey(key)!) : null);
    if (stored === "1") return true;
    if (stored === "0") return false;
  } catch {
    // localStorage can throw in private mode
  }
  return fallback;
}

export function writeUiFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // ignore quota / private mode
  }
}

export function readUiNumber(key: string, fallback: number): number {
  try {
    const stored = localStorage.getItem(key);
    if (stored == null) return fallback;
    const value = Number(stored);
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function writeUiNumber(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // ignore quota / private mode
  }
}

export function readBusySendMode(): BusySendMode {
  try {
    const stored =
      localStorage.getItem(BUSY_SEND_MODE_KEY) ??
      (legacyUiKey(BUSY_SEND_MODE_KEY) ? localStorage.getItem(legacyUiKey(BUSY_SEND_MODE_KEY)!) : null);
    if (stored === "followUp" || stored === "steer") return stored;
  } catch {
    // localStorage can throw in private mode
  }
  return "steer";
}

export function writeBusySendMode(value: BusySendMode): void {
  try {
    localStorage.setItem(BUSY_SEND_MODE_KEY, value);
  } catch {
    // ignore quota / private mode
  }
}

export function busySubmitKind(mode: BusySendMode, shiftKey: boolean): BusySendMode {
  if (!shiftKey) return mode;
  return mode === "steer" ? "followUp" : "steer";
}

export function clampInspectorWidth(width: number, viewport = typeof window === "undefined" ? 1280 : window.innerWidth): number {
  // Keep ~2/3 of the previous ~40% conversation floor so the chat pane can shrink further.
  const max = Math.max(INSPECTOR_WIDTH_MIN, Math.floor(viewport * (1 - (0.4 * 2) / 3)));
  return Math.min(max, Math.max(INSPECTOR_WIDTH_MIN, Math.round(width)));
}
