import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal, X } from "lucide-react";
import { useDialogLayer } from "../../hooks/useDialogLayer";

export function WorkflowTabs<T extends string>({ label, tabs, value, onChange, id }: {
  label: string; tabs: { id: T; label: string; count?: number }[];
  value: T; onChange: (value: T) => void; id: string;
}) {
  return <div className="workflow-tabs" role="tablist" aria-label={label}>
    {tabs.map((tab, index) => <button key={tab.id} type="button" role="tab"
      id={`${id}-tab-${tab.id}`} aria-controls={`${id}-panel-${tab.id}`}
      aria-selected={value === tab.id} tabIndex={value === tab.id ? 0 : -1}
      onClick={() => onChange(tab.id)} onKeyDown={(event) => {
        let next = index;
        if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
        else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = tabs.length - 1;
        else return;
        event.preventDefault(); onChange(tabs[next]!.id);
        (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();
      }}>{tab.label}{tab.count !== undefined ? <span className="workflow-tab-count">{tab.count}</span> : null}</button>)}
  </div>;
}

export function WorkflowModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const id = useId();
  useDialogLayer(ref, onClose);
  return <div className="dialog-scrim z-40">
    <button className="absolute inset-0" aria-label="关闭设置" onClick={onClose} />
    <section ref={ref} className="workflow-modal" role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}>
      <header><h2 id={id}>{title}</h2><button className="icon-btn" aria-label="关闭" onClick={onClose}><X size={18} /></button></header>
      <div className="workflow-modal-body">{children}</div>
    </section>
  </div>;
}

export function WorkflowMenu({ label, actions }: { label: string; actions: { label: string; disabled?: boolean; run: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDialogLayer(ref, () => setOpen(false), open, false);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus());
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("pointerdown", outside); };
  }, [open]);
  return <div ref={ref} className="workflow-item-menu">
    <button className="icon-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><MoreHorizontal size={17} /></button>
    {open ? <div role="menu" aria-label={label} onKeyDown={(event) => {
      const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled)')];
      const current = buttons.indexOf(document.activeElement as HTMLElement);
      const next = event.key === "ArrowDown" ? (current + 1) % buttons.length : event.key === "ArrowUp" ? (current - 1 + buttons.length) % buttons.length : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : -1;
      if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
    }}>{actions.map((action) => <button key={action.label} role="menuitem" disabled={action.disabled} onClick={() => { setOpen(false); action.run(); }}>{action.label}</button>)}</div> : null}
  </div>;
}
