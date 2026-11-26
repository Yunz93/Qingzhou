import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useDialogLayer } from "../../hooks/useDialogLayer";

export function ConversationImage({ src, label, imageClassName = "my-2 max-h-[360px] max-w-full rounded-md border border-line object-contain" }: { src: string; label: string; imageClassName?: string }) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const title = useId();
  useDialogLayer(panel, () => setOpen(false), open);

  return <>
    <button type="button" className="block max-w-full cursor-zoom-in rounded-md" aria-label={`查看图片：${label}`}
      aria-haspopup="dialog" onClick={() => setOpen(true)}>
      <img src={src} alt={label} className={imageClassName} />
    </button>
    {open && createPortal(
      <div className="dialog-scrim z-[70]" onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
        <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={title} className="flex max-h-[92dvh] max-w-full flex-col overflow-hidden rounded-lg border border-line bg-elevated">
          <div className="flex items-center justify-between gap-4 px-4 py-1">
            <h2 id={title} className="min-w-0 truncate text-sm font-medium text-ink">{label}</h2>
            <button type="button" className="icon-btn shrink-0" aria-label="关闭图片" onClick={() => setOpen(false)}><X size={18} /></button>
          </div>
          <img src={src} alt={label} className="min-h-0 max-w-full object-contain" />
        </div>
      </div>, document.body)}
  </>;
}
