import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { ToolExecution } from "@qingzhou/protocol";
import { toolGroupLabel } from "../../lib/tool-groups";
import { ToolExecutionRow } from "./ToolExecutionRow";

type Props = {
  tools: ToolExecution[];
  taskId?: string | null;
  onOpen?: (path: string) => void;
};

export function ToolGroupRow({ tools, taskId = null, onOpen }: Props) {
  const [open, setOpen] = useState(tools.some((tool) => tool.status === "failed" || tool.isError));
  return (
    <div className="overflow-hidden rounded-[10px] bg-fill">
      <button
        type="button"
        className="pressable flex min-h-8 w-full items-center gap-2.5 px-3 py-1.5 text-left"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="text-xs text-ink">{toolGroupLabel(tools)}</span>
        <span className="flex-1" />
        <ChevronRight size={14} className={`text-mute transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open ? (
        <div className="space-y-1 border-t border-line p-1.5">
          {tools.map((tool) => (
            <ToolExecutionRow key={tool.toolCallId} tool={tool} taskId={taskId} onOpen={onOpen} compact />
          ))}
        </div>
      ) : null}
    </div>
  );
}
