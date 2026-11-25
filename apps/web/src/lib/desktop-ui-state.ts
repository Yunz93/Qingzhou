import { getDesktop, type DesktopUiChange } from "../desktop-bridge";

const route = "/api/desktop/ui";
let tail = Promise.resolve();
let persistenceError = "";
const listeners = new Set<() => void>();
const preparation = new Set<Promise<void>>();
const restored = new Map<string, string>();

function report(error: string) {
  if (error === persistenceError) return;
  persistenceError = error;
  for (const listener of listeners) listener();
}

export function subscribeDesktopUiError(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export const readDesktopUiError = () => persistenceError;

export async function flushDesktopUiState(): Promise<void> {
  while (preparation.size || sending) {
    await Promise.all([...preparation, tail]);
  }
  if (recovering || pending.size) throw new Error("桌面草稿正在恢复，请稍后重试。");
  if (persistenceError) throw new Error(persistenceError);
}

export function trackDesktopUiPreparation(work: Promise<void>): void {
  if (getDesktop()?.kind !== "tauri") return;
  preparation.add(work);
  void work.finally(() => preparation.delete(work));
}

export async function hydrateDesktopUiState(): Promise<void> {
  if (getDesktop()?.kind !== "tauri") return;
  try {
    const response = await fetch(route, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error();
    const snapshot = await response.json() as Record<string, string>;
    for (const [key, value] of Object.entries(snapshot)) {
      restored.set(key, value);
      const storage = key.startsWith("qingzhou.") ? localStorage : sessionStorage;
      try {
        if (storage.getItem(key) === null) storage.setItem(key, value);
      } catch {
        // Large image drafts are available from the in-memory snapshot.
      }
    }
    if (!failed.size) report("");
  } catch {
    report("无法读取桌面偏好或草稿，原文件已保留。请检查数据目录后重新连接。");
  }
}

export const restoredDesktopUiValue = (key: string) => restored.get(key);

const pending = new Map<string, string | null>();
const failed = new Map<string, string | null>();
let sending = false;
let recovering = false;

export async function reconnectDesktopUiState(connect: (changes: DesktopUiChange[]) => Promise<boolean>) {
  const root = document.getElementById("root");
  const previousInert = root?.inert ?? false;
  if (root) root.inert = true;
  recovering = true;
  let navigating = false;
  try {
    // Pause new HTTP saves and let the active request and image conversions finish.
    while (preparation.size || sending) await Promise.allSettled([...preparation, tail]);
    const changes = new Map([...failed, ...pending]);
    navigating = await connect(Array.from(changes, ([key, value]) => ({ key, value })));
    return navigating;
  } finally {
    if (!navigating) {
      if (root) root.inert = previousInert;
      recovering = false;
      if (pending.size) sendPending();
    }
  }
}

export function persistDesktopUiState(key: string, value: string | null): void {
  if (getDesktop()?.kind !== "tauri") return;
  if (!key.startsWith("qingzhou.") && !/^qingzhou:(shared-draft|shared-images|objective|feedback|rules|prd-draft|workroom-[\w-]+):/.test(key)) return;
  if (value === null) restored.delete(key);
  else restored.set(key, value);
  pending.set(key, value);
  failed.delete(key);
  sendPending();
}

export function retryDesktopUiState() {
  if (!failed.size) {
    void hydrateDesktopUiState();
    return;
  }
  for (const [key, value] of failed) if (!pending.has(key)) pending.set(key, value);
  failed.clear();
  sendPending();
}

function sendPending() {
  if (sending || recovering) return;
  sending = true;
  tail = tail.then(async () => {
    while (pending.size && !recovering) {
      const [key, value] = pending.entries().next().value!;
      pending.delete(key);
      const response = await fetch(route, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
        signal: AbortSignal.timeout(4000),
      }).catch(() => null);
      if (!response?.ok && !pending.has(key)) failed.set(key, value);
    }
    report(failed.size ? "桌面草稿或偏好暂时无法保存。请保留窗口并检查本地服务。" : "");
  }).finally(() => {
    sending = false;
    if (pending.size) sendPending();
  });
}
