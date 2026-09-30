import { useDialogLayer } from "../../hooks/useDialogLayer";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RuntimeState, SessionStats } from "@qingzhou/protocol";
import { Gauge, X } from "lucide-react";

type Props = {
  stats: SessionStats | null;
  runtime?: RuntimeState | null;
  onCompact?: (customInstructions?: string) => void;
  onRuntimeSet?: (payload: { autoCompaction?: boolean; autoRetry?: boolean }) => void;
  onRefresh?: () => void;
  messageCount?: number;
  toolCount?: number;
  compact?: boolean;
};

function compactNumber(value: number | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function ContextMeter({
  stats,
  runtime,
  onCompact,
  onRuntimeSet,
  onRefresh,
  messageCount = 0,
  toolCount = 0,
  compact,
}: Props) {
  const [open, setOpen] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [panelPos, setPanelPos] = useState<{ top: number; right: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogLayer(panelRef, () => setOpen(false), open, false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const usage = stats?.contextUsage;
  const percent = usage?.percent == null ? null : Math.max(0, Math.min(100, usage.percent));
  const tone = percent == null ? "text-mute" : percent >= 85 ? "text-danger" : percent >= 70 ? "text-warn" : "text-accent";
  const totalMessages = stats?.totalMessages ?? messageCount;
  const toolCalls = stats?.toolCalls ?? toolCount;

  useLayoutEffect(() => {
    if (!open) {
      setPanelPos(null);
      return;
    }
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPanelPos({
        top: Math.round(rect.bottom + 8),
        right: Math.round(Math.max(12, window.innerWidth - rect.right)),
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      const panel = document.getElementById("context-usage-panel");
      if (panel?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  const panel =
    open && panelPos
      ? createPortal(
          <div
            ref={panelRef}
            id="context-usage-panel"
            role="dialog"
            aria-label="上下文用量"
            className="context-usage-panel"
            style={{ top: panelPos.top, right: panelPos.right }}
          >
            <div className="dialog-head">
              <div className="dialog-head-text">
                <p className="dialog-title">上下文用量</p>
                <p className="mt-1 font-mono text-[11px] text-mute tabular">
                  {compactNumber(usage?.tokens)} / {compactNumber(usage?.contextWindow)} tokens
                </p>
              </div>
              <button
                type="button"
                className="pressable icon-btn -mr-1 -mt-1"
                aria-label="关闭"
                onClick={() => setOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="dialog-body">
              <div className="h-2 overflow-hidden rounded-full bg-canvas">
                <div
                  className={`h-full rounded-full transition-[width] duration-200 ${percent != null && percent >= 85 ? "bg-danger" : percent != null && percent >= 70 ? "bg-warn" : "bg-accent"}`}
                  style={{ width: `${percent ?? 0}%` }}
                />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 font-mono text-[11px] tabular">
                <div className="rounded-md bg-canvas p-3">
                  <dt className="text-mute">消息</dt>
                  <dd className="mt-1 text-ink">{totalMessages}</dd>
                </div>
                <div className="rounded-md bg-canvas p-3">
                  <dt className="text-mute">工具调用</dt>
                  <dd className="mt-1 text-ink">{toolCalls}</dd>
                </div>
              </dl>
              {onRuntimeSet ? (
                <div className="settings-card mt-3">
                  <div className="settings-row items-center">
                    <p className="text-[13px] text-ink">接近上限时自动压缩</p>
                    <label className="mac-toggle">
                      <input
                        type="checkbox"
                        checked={runtime?.autoCompaction !== false}
                        onChange={(event) => onRuntimeSet({ autoCompaction: event.target.checked })}
                        aria-label="接近上限时自动压缩"
                      />
                      <span />
                    </label>
                  </div>
                  <div className="settings-row items-center">
                    <p className="text-[13px] text-ink">出错时自动重试</p>
                    <label className="mac-toggle">
                      <input
                        type="checkbox"
                        checked={runtime?.autoRetry !== false}
                        onChange={(event) => onRuntimeSet({ autoRetry: event.target.checked })}
                        aria-label="出错时自动重试"
                      />
                      <span />
                    </label>
                  </div>
                </div>
              ) : null}
              {onCompact ? (
                <label className="mt-3 block text-sm text-mute" htmlFor="compact-instructions">
                  压缩时额外交代
                  <textarea
                    id="compact-instructions"
                    value={instructions}
                    onChange={(event) => setInstructions(event.target.value)}
                    className="field mt-1 min-h-16 w-full text-sm text-ink"
                    placeholder="可选，例如：保留这次改文件的结论"
                  />
                </label>
              ) : null}
            </div>
            {onCompact ? (
              <div className="dialog-actions">
                <button
                  type="button"
                  className="pressable btn btn-primary btn-block"
                  onClick={() => {
                    onCompact(instructions.trim() || undefined);
                    setInstructions("");
                    setOpen(false);
                  }}
                >
                  压缩上下文
                </button>
              </div>
            ) : null}
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        className={`pressable flex h-7 items-center gap-1.5 rounded-md px-2 font-mono text-[11px] tabular ${tone}`}
        aria-label="上下文用量"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen((value) => {
            const next = !value;
            if (next) onRefresh?.();
            return next;
          });
        }}
      >
        <Gauge size={14} />
        <span>{compact ? (percent == null ? "--" : `${Math.round(percent)}%`) : `上下文 ${percent == null ? "--" : `${Math.round(percent)}%`}`}</span>
      </button>
      {panel}
    </div>
  );
}
