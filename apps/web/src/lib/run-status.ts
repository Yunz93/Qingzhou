import type { RuntimeState, TaskStatus, ToolExecution } from "@qingzhou/protocol";

export type RunStatusKind = "spin" | "wait" | "queue" | "error" | "done";

export function runStatusStage(
  status: TaskStatus,
  tools: ToolExecution[],
  hasChanges: boolean,
  runtime?: RuntimeState | null,
  errorMessage?: string | null,
  sending?: boolean,
): { label: string; detail: string; kind: RunStatusKind } | null {
  const current = [...tools].reverse().find((tool) => tool.status === "running" || tool.status === "waiting_approval");
  if (runtime?.compacting) {
    return { label: "正在压缩上下文", detail: runtime.compactionReason ?? "把旧内容收成摘要", kind: "spin" };
  }
  if (runtime?.retrying) {
    const attempt = runtime.retryAttempt != null ? `第 ${runtime.retryAttempt} 次` : "自动重试";
    return { label: "正在重试", detail: runtime.retryError ?? attempt, kind: "spin" };
  }
  if ((runtime?.steering.length ?? 0) > 0) {
    return { label: "已排队补充", detail: runtime?.steering[0] ?? "下一条会马上送出", kind: "queue" };
  }
  if ((runtime?.followUp.length ?? 0) > 0) {
    return { label: "下一条已排队", detail: runtime?.followUp[0] ?? "回复结束后发送", kind: "queue" };
  }
  if (status === "waiting_approval") {
    return { label: "等待确认", detail: current?.toolName ?? "请查看这次操作", kind: "wait" };
  }
  if (status === "queued") return { label: "排队中", detail: "正在等待空闲的 AI 进程", kind: "queue" };
  if (status === "booting") return { label: "正在启动", detail: "正在准备 AI 引擎", kind: "spin" };
  if (status === "aborting") return { label: "正在停止", detail: "正在结束当前操作", kind: "spin" };
  if (sending && (status === "idle" || status === "stopped" || status === "error")) {
    return { label: "正在发送", detail: "", kind: "spin" };
  }
  if (status === "error") {
    return { label: "对话异常停止", detail: errorMessage || "这次运行没有完成", kind: "error" };
  }
  if (status === "running") {
    const toolName = current?.toolName ?? "agent";
    const normalized = `${toolName} ${current?.target ?? ""}`.toLowerCase();
    const label = /test|check|lint|build/.test(normalized)
      ? "正在检查"
      : /write|edit/.test(normalized)
        ? "正在改文件"
        : "正在处理";
    // Command text already appears on the tool row in the transcript.
    return { label, detail: "", kind: "spin" };
  }
  if (hasChanges) return { label: "查看改动", detail: "这次对话改了项目里的文件", kind: "done" };
  return null;
}

/** Prominent copy for an abnormal task stop shown inside the conversation pane. */
export function abnormalStopNotice(errorMessage?: string | null): string {
  const detail = errorMessage?.trim();
  if (!detail) return "对话异常停止，请重试发送或检查设置。";
  if (/对话异常停止|这次运行没有完成/.test(detail)) return detail;
  return `对话异常停止：${detail}`;
}
