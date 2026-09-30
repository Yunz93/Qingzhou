import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { sanitizeToolResultText, type ToolExecution } from "@qingzhou/protocol";
import { Ban, Check, CircleAlert, LoaderCircle, Shield } from "lucide-react";
import { toolNameLabel, toolStatusLabel } from "../../copy";
import { toneClass } from "../../lib/status-tone";
import { isWorkspaceMediaPath } from "../../lib/assistant-markdown";
import { WorkspaceMediaPreview } from "./WorkspaceMediaPreview";

const ICONS = {
  pending: LoaderCircle,
  waiting_approval: Shield,
  running: LoaderCircle,
  succeeded: Check,
  failed: CircleAlert,
  blocked: Ban,
  aborted: Ban,
} as const;

const FILE_TOOLS = new Set(["write", "edit", "read"]);
const UNDO_TOOLS = new Set(["write", "edit"]);

type Props = {
  tool: ToolExecution;
  taskId?: string | null;
  onOpen?: (path: string) => void;
  onUndo?: (path: string) => void;
  compact?: boolean;
};

function toolTone(status: ToolExecution["status"]): "idle" | "busy" | "wait" | "ok" | "danger" {
  if (status === "failed" || status === "blocked" || status === "aborted") return "danger";
  if (status === "waiting_approval") return "wait";
  if (status === "running" || status === "pending") return "busy";
  if (status === "succeeded") return "ok";
  return "idle";
}

export function ToolExecutionRow({ tool, taskId = null, onOpen, onUndo, compact }: Props) {
  const displayResult = tool.resultText ? sanitizeToolResultText(tool.resultText) : "";
  const [open, setOpen] = useState(Boolean(tool.isError) || tool.status === "failed");
  const Icon = ICONS[tool.status];
  const duration =
    typeof tool.durationMs === "number" ? `${Math.max(1, Math.round(tool.durationMs / 100) / 10)}s` : "";
  const label = toolNameLabel(tool.toolName);
  const target = tool.target?.trim() ?? "";
  const canOpen = Boolean(onOpen && target && FILE_TOOLS.has(tool.toolName));
  const canUndo = Boolean(onUndo && target && UNDO_TOOLS.has(tool.toolName) && tool.status === "succeeded");
  const showMedia =
    tool.status === "succeeded" && FILE_TOOLS.has(tool.toolName) && isWorkspaceMediaPath(target);
  const tone = useMemo(() => toolTone(tool.status), [tool.status]);

  return (
    <div className={`overflow-hidden rounded-[10px] bg-fill ${toneClass(tone)}`}>
      <div className="flex min-h-8 items-center gap-1 px-1.5">
        <button
          type="button"
          className="pressable flex min-h-8 min-w-0 flex-1 items-center gap-2.5 px-1.5 py-1.5 text-left"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <Icon
            size={14}
            className={
              tool.status === "running" || tool.status === "pending" ? "text-accent" : "text-mute"
            }
          />
          <span className="text-xs text-ink">{label}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-mute">{target}</span>
          {compact ? null : <span className="text-[11px] text-mute">{toolStatusLabel(tool.status)}</span>}
          {duration ? <span className="text-[11px] text-mute">{duration}</span> : null}
          <ChevronRight size={14} className={`text-mute transition-transform ${open ? "rotate-90" : ""}`} />
        </button>
        {canOpen || canUndo ? (
          <span className="tool-row-actions">
            {canOpen ? (
              <button
                type="button"
                className="pressable h-6 rounded-md px-1.5 text-[11px] text-accent"
                onClick={() => onOpen?.(target)}
              >
                打开
              </button>
            ) : null}
            {canUndo ? (
              <button
                type="button"
                className="pressable h-6 rounded-md px-1.5 text-[11px] text-ink"
                onClick={() => onUndo?.(target)}
              >
                撤回这次
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
      {showMedia ? (
        <div className="border-t border-line bg-canvas px-3 py-2">
          <WorkspaceMediaPreview src={target} alt={target.replaceAll("\\", "/").split("/").pop()} taskId={taskId} />
        </div>
      ) : null}
      {open && displayResult ? (
        <pre className="max-h-64 overflow-auto border-t border-line bg-canvas px-3 py-2 font-mono text-xs leading-5 text-mute fade-in">
          {displayResult}
        </pre>
      ) : null}
    </div>
  );
}
