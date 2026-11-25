import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type WebPreviewAction = "open" | "back" | "forward" | "reload";
export type DesktopUiChange = { key: string; value: string | null };
type UpdateEvent = { event: "Started" | "Progress" | "Finished"; data?: { contentLength?: number; chunkLength?: number } };

export type QingzhouDesktopApi = {
  isDesktop: true;
  kind: "tauri";
  platform: "darwin" | "win32" | "linux" | string;
  ensureBackend?: (changes: DesktopUiChange[]) => Promise<boolean>;
  pickFolder: (defaultPath?: string) => Promise<string | null>;
  openPath?: (filePath: string) => Promise<string>;
  notify?: (payload: { title: string; body: string }) => Promise<void>;
  openExternal?: (url: string) => Promise<void>;
  previewNavigation?: (action: WebPreviewAction, url?: string) => Promise<void>;
  checkSignedUpdate?: () => Promise<{ version: string; body: string; canInstall: boolean } | null>;
  downloadSignedUpdate?: (version: string, onProgress: (event: UpdateEvent) => void) => Promise<void>;
  installSignedUpdate?: (version: string) => Promise<void>;
  onOpenSetup?: (callback: () => void) => () => void;
  onCheckUpdate?: (callback: () => void) => () => void;
};

export function systemPlatform(userAgent: string): "darwin" | "win32" | "linux" {
  if (/Mac/i.test(userAgent)) return "darwin";
  if (/Windows/i.test(userAgent)) return "win32";
  return "linux";
}

export function getDesktop(): QingzhouDesktopApi | null {
  return typeof window !== "undefined" && isTauri() ? tauriDesktop : null;
}

function subscribe(name: string, callback: () => void): () => void {
  let disposed = false;
  let unsubscribe: (() => void) | undefined;
  void listen(name, () => { if (!disposed) callback(); }).then((stop) => {
    if (disposed) stop();
    else unsubscribe = stop;
  }).catch((error: unknown) => console.warn("无法订阅桌面菜单", error));
  return () => {
    disposed = true;
    unsubscribe?.();
  };
}

const tauriDesktop: QingzhouDesktopApi = {
  isDesktop: true,
  kind: "tauri",
  get platform() { return systemPlatform(window.navigator.userAgent); },
  async ensureBackend(changes) {
    const response = await fetch("/api/session", { signal: AbortSignal.timeout(3000) }).catch(() => null);
    return invoke("ensure_backend", { renew: response?.status === 401, changes });
  },
  pickFolder: (defaultPath) => invoke("pick_folder", { defaultPath }),
  openPath: (path) => invoke("open_path", { path }).then(() => "", (error: unknown) => String(error)),
  openExternal: (url) => invoke("open_external", { url }),
  notify: (payload) => invoke("notify", payload),
  previewNavigation: (action, url) => invoke("preview_navigation", { action, url }),
  checkSignedUpdate: () => invoke("check_signed_update"),
  downloadSignedUpdate(version, onProgress) {
    const progress = new Channel<UpdateEvent>(onProgress);
    return invoke("download_signed_update", { version, progress });
  },
  installSignedUpdate: (version) => invoke("install_signed_update", { version }),
  onOpenSetup: (callback) => subscribe("qingzhou://open-settings", callback),
  onCheckUpdate: (callback) => subscribe("qingzhou://check-update", callback),
};

export function isDesktopApp(): boolean {
  return getDesktop() !== null;
}
