import type { WorkflowEvent } from "@qingzhou/protocol";

/** Keep the default replay small; a file is selected before its patch is displayed. */
export function splitWorkflowPatch(patch: string): Array<{ path: string; patch: string }> {
  return patch.split(/(?=^diff --git )/m).filter((part) => part.startsWith("diff --git ")).map((part) => ({
    path: part.split("\n", 1)[0]?.match(/ b\/(.+)$/)?.[1] ?? "文件差异", patch: part,
  }));
}

const milestones = new Set(["scope.confirmed", "prd.confirmed", "delivery.created", "verification.finished", "delivery.accepted", "delivery.rejected", "main.merged"]);
export const isHistoryMilestone = (event: WorkflowEvent) => !event.itemId || milestones.has(event.type) || /(?:failed|interrupted|paused)$/.test(event.type);

export function historyEvents(events: WorkflowEvent[], itemId?: string, all = false): WorkflowEvent[] {
  const unique = new Map<string, WorkflowEvent>();
  for (const event of events) {
    const belongs = itemId ? event.itemId === itemId : !event.itemId || event.type === "main.merged";
    if (belongs && (all || isHistoryMilestone(event))) unique.set(event.id, event);
  }
  return [...unique.values()].sort((a, b) => b.sequence - a.sequence);
}
