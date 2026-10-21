import { createPortal } from "react-dom";
import type { ReactNode } from "react";

/** Keep the selected page's actions outside its scrolling content. */
export function ReviewActions({ target, children }: { target?: HTMLElement | null; children: ReactNode }) {
  return target ? createPortal(<div className="review-actions">{children}</div>, target) : null;
}
