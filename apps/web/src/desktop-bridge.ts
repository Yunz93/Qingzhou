export type QingzhouDesktopApi = {
  isDesktop: true;
  platform: "darwin" | "win32" | "linux" | string;
  ensureBackend?: () => Promise<void>;
  pickFolder: (defaultPath?: string) => Promise<string | null>;
  openPath?: (filePath: string) => Promise<string>;
  notify?: (payload: { title: string; body: string }) => Promise<void>;
  restart?: (options?: { relaunch?: boolean }) => Promise<void>;
  onOpenSetup?: (callback: () => void) => () => void;
  onCheckUpdate?: (callback: () => void) => () => void;
};

declare global {
  interface Window {
    qingzhou?: QingzhouDesktopApi;
  }
}

/** Infer Electron shell platform when preload has not exposed `window.qingzhou` yet. */
export function platformFromUserAgent(userAgent: string): "darwin" | "win32" | "linux" | null {
  if (!/Electron/i.test(userAgent)) return null;
  if (/Mac/i.test(userAgent)) return "darwin";
  if (/Windows/i.test(userAgent)) return "win32";
  return "linux";
}

export function getDesktop(): QingzhouDesktopApi | null {
  if (typeof window === "undefined") return null;
  if (window.qingzhou?.isDesktop) return window.qingzhou;
  const platform = platformFromUserAgent(window.navigator.userAgent);
  if (!platform) return null;
  // Synthetic desktop marker: enough for titlebar inset CSS. IPC APIs stay unavailable
  // until the real preload bridge attaches.
  return { isDesktop: true, platform, pickFolder: async () => null };
}

export function isDesktopApp(): boolean {
  return getDesktop() !== null;
}

/** Apply `html.desktop` + `data-platform` so traffic-light inset CSS can run before React. */
export function applyDesktopDocumentAttrs(root: HTMLElement = document.documentElement): void {
  const desktop = getDesktop();
  root.classList.toggle("desktop", Boolean(desktop));
  if (desktop?.platform) root.dataset.platform = desktop.platform;
  else delete root.dataset.platform;
}
