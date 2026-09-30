import { useLayoutEffect, useRef, type RefObject } from "react";

// Esc belongs to the newest layer; focus remains with the newest modal.
const layers: Array<{ id: symbol; modal: boolean }> = [];
export function hasDialogLayer(): boolean { return layers.length > 0; }
const activeModal = () => layers.findLast((layer) => layer.modal)?.id;
const focusable = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]';

export function useDialogLayer<T extends HTMLElement>(
  ref: RefObject<T | null>,
  onClose: (() => void) | undefined,
  enabled = true,
  modal = true,
) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useLayoutEffect(() => {
    if (!enabled) return;
    const id = Symbol("dialog");
    const root = ref.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    layers.push({ id, modal });
    const controls = () => Array.from(ref.current?.querySelectorAll<HTMLElement>(focusable) ?? [])
      .filter((element) => element.getClientRects().length > 0);
    const focusFirst = () => (controls()[0] ?? ref.current)?.focus();
    const frame = requestAnimationFrame(() => {
      if (modal && activeModal() === id && !ref.current?.contains(document.activeElement)) focusFirst();
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (layers.at(-1)?.id !== id) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current?.();
      } else if (modal && activeModal() === id && event.key === "Tab") {
        const elements = controls();
        const index = elements.indexOf(document.activeElement as HTMLElement);
        if (!elements.length || (event.shiftKey ? index <= 0 : index < 0 || index === elements.length - 1)) {
          event.preventDefault();
          (event.shiftKey ? elements.at(-1) : elements[0])?.focus();
        }
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (modal && activeModal() === id && ref.current && !ref.current.contains(event.target as Node)) focusFirst();
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocus);
    return () => {
      cancelAnimationFrame(frame);
      layers.splice(layers.findIndex((layer) => layer.id === id), 1);
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocus);
      // A newly opened editor/dialog may already own focus. Do not steal it back.
      if (previous?.isConnected && (document.activeElement === document.body || root?.contains(document.activeElement))) previous.focus();
    };
  }, [enabled, modal, ref]);
}
