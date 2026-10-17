import { useCallback, useSyncExternalStore } from "react";
import type { ComposerImage } from "../components/composer/PromptComposer";
import { readComposerDraft } from "./composer-drafts";

type Draft = { text: string; images: ComposerImage[] };
const drafts = new Map<string, Draft>();
const previews = new Map<string, string>();
const listeners = new Set<() => void>();
const empty: Draft = { text: "", images: [] };
function read(key: string, itemId?: string, taskId?: string | null): Draft {
  if (!key) return empty;
  if (!drafts.has(key)) {
    let text = readComposerDraft(taskId ?? key);
    let images: ComposerImage[] = [];
    try {
      const saved = sessionStorage.getItem(`qingzhou:shared-draft:${key}`);
      const legacy = itemId ? sessionStorage.getItem(`qingzhou:conversation:${itemId}`) : null;
      if (saved !== null) text = saved;
      else if (legacy) text = (JSON.parse(legacy) as { text: string }).text || text;
      const savedImages = JSON.parse(sessionStorage.getItem(`qingzhou:shared-images:${key}`) || "[]") as ComposerImage[];
      if (Array.isArray(savedImages)) images = savedImages.filter((image) => typeof image.id === "string" && typeof image.name === "string" && typeof image.previewUrl === "string" && /^data:image\/(png|jpeg|gif|webp);base64,/.test(image.previewUrl));
    } catch { /* Storage failures leave the live editor usable. */ }
    drafts.set(key, { text, images });
  }
  return drafts.get(key)!;
}
async function saveImages(key: string, images: ComposerImage[]) {
  try {
    const saved = await Promise.all(images.map(async (image) => {
      let previewUrl = previews.get(image.id) ?? image.previewUrl;
      if (previewUrl.startsWith("blob:")) {
        const blob = await fetch(previewUrl).then((response) => response.blob());
        previewUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); });
        previews.set(image.id, previewUrl);
      }
      return { ...image, previewUrl };
    }));
    if (drafts.get(key)?.images.map((image) => image.id).join() === images.map((image) => image.id).join()) sessionStorage.setItem(`qingzhou:shared-images:${key}`, JSON.stringify(saved));
  } catch { /* File previews remain in memory if storage is full. */ }
}
function update(key: string, next: Draft) {
  if (!key) return;
  const previous = drafts.get(key);
  drafts.set(key, next);
  try { sessionStorage.setItem(`qingzhou:shared-draft:${key}`, next.text); } catch { /* Keep the live draft. */ }
  if (previous?.images !== next.images) void saveImages(key, next.images);
  listeners.forEach((listener) => listener());
}
/** Requirement identity stays stable before a session exists and across every layout. */
export function useConversationDraft(taskId: string | null | undefined, itemId?: string) {
  const key = itemId ? `requirement:${itemId}` : taskId ?? "";
  const draft = useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => read(key, itemId, taskId));
  const setText = useCallback((text: string | ((current: string) => string)) => { const current = read(key, itemId, taskId); update(key, { ...current, text: typeof text === "function" ? text(current.text) : text }); }, [key, itemId, taskId]);
  const setImages = useCallback((value: ComposerImage[] | ((images: ComposerImage[]) => ComposerImage[])) => {
    const current = read(key, itemId, taskId);
    update(key, { ...current, images: typeof value === "function" ? value(current.images) : value });
  }, [key, itemId, taskId]);
  const clear = (text: string, images: ComposerImage[]) => {
    const current = read(key, itemId, taskId);
    update(key, { text: current.text === text ? "" : current.text, images: current.images.filter((image) => !images.some((sent) => sent.id === image.id)) });
    for (const image of images) { URL.revokeObjectURL(image.previewUrl); previews.delete(image.id); }
  };
  return { text: draft.text, images: draft.images, setText, setImages, clear };
}
