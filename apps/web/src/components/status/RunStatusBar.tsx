import type { RuntimeState, TaskStatus, ToolExecution } from "@qingzhou/protocol";
import { AlertTriangle, CheckCircle2, Clock3, LoaderCircle, ShieldAlert } from "lucide-react";
import { runStatusStage } from "../../lib/run-status";

type Props = {
  status: TaskStatus;
  tools: ToolExecution[];
  hasChanges: boolean;
  runtime?: RuntimeState | null;
  errorMessage?: string | null;
  sending?: boolean;
};

const ICONS = {
  spin: LoaderCircle,
  wait: ShieldAlert,
  queue: Clock3,
  error: AlertTriangle,
  done: CheckCircle2,
} as const;

export function RunStatusBar({ status, tools, hasChanges, runtime, errorMessage, sending }: Props) {
  const current = runStatusStage(status, tools, hasChanges, runtime, errorMessage, sending);
  if (!current) return null;
  const Icon = ICONS[current.kind];
  const active =
    status === "running" ||
    status === "booting" ||
    status === "aborting" ||
    Boolean(sending) ||
    Boolean(runtime?.compacting || runtime?.retrying);

  return (
    <div
      className={`flex min-h-8 items-center gap-2.5 border-b border-line px-4 py-1.5 text-[12px] ${
        current.kind === "error"
          ? "bg-[color-mix(in_oklch,var(--color-danger)_10%,var(--color-surface))]"
          : "bg-surface"
      }`}
      role={current.kind === "error" ? "alert" : undefined}
    >
      <Icon
        size={14}
        className={
          current.kind === "error"
            ? "text-danger"
            : active
              ? "animate-spin text-accent motion-reduce:animate-none"
              : status === "waiting_approval"
                ? "text-warn"
                : "text-mute"
        }
      />
      <span className={`font-medium ${current.kind === "error" ? "text-danger" : "text-ink"}`}>{current.label}</span>
      {current.detail ? (
        <span
          className={`min-w-0 flex-1 truncate font-mono text-[11px] ${current.kind === "error" ? "text-danger" : "text-mute"}`}
        >
          {current.detail}
        </span>
      ) : (
        <span className="flex-1" />
      )}
      {tools.length > 0 ? (
        <span className="font-mono text-[11px] text-mute tabular">{tools.length} 个操作</span>
      ) : null}
    </div>
  );
}
