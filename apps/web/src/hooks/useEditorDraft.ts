import { useEffect, useState } from "react";

// Keep drafts across unmounts even when browser storage is unavailable or full.
const memoryDrafts = new Map<string, string>();
function storedDraft(key: string): string | null {
  if (memoryDrafts.has(key)) return memoryDrafts.get(key)!;
  try { return sessionStorage.getItem(key); } catch { return null; }
}
export function readEditorDraft<T extends Record<string, string>>(key: string, baseline: T): T {
  try {
    const value: unknown = JSON.parse(storedDraft(key) ?? "null");
    if (value && typeof value === "object" && Object.keys(baseline).every((field) =>
      typeof (value as Record<string, unknown>)[field] === "string")) return value as T;
  } catch { /* A corrupted draft must not prevent the editor from opening. */ }
  return baseline;
}

export function useEditorDraft<T extends Record<string, string>>(key: string, baseline: T) {
  const serialized = JSON.stringify(baseline);
  const [draft, setDraft] = useState(() => readEditorDraft(key, baseline));
  useEffect(() => {
    setDraft(readEditorDraft(key, JSON.parse(serialized) as T));
  }, [key, serialized]);

  function clear(expected?: T) {
    // A slow save may finish after the user has reopened and revised this editor.
    if (expected && storedDraft(key) !== JSON.stringify(expected)) return;
    memoryDrafts.delete(key);
    try { sessionStorage.removeItem(key); } catch { /* The in-memory copy is cleared. */ }
  }
  function update(next: T) {
    setDraft(next);
    const value = JSON.stringify(next);
    if (value === serialized) { clear(); return; }
    memoryDrafts.set(key, value);
    try { sessionStorage.setItem(key, value); } catch { /* Keep the in-memory copy. */ }
  }
  return { draft, update, clear, discard: () => update(baseline) };
}
