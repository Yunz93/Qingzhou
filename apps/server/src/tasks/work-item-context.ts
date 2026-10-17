import type { WorkItem } from "@qingzhou/protocol";

/** Selected historical discussion is background; the confirmed scope remains authoritative. */
export function workItemContext(item: Pick<WorkItem, "description" | "acceptanceCriteria" | "source">): string {
  const excerpt = item.source?.excerpt?.trim();
  if (!excerpt) return item.description;
  const budget = Math.max(0, Math.min(4000, 26000 - item.description.length - item.acceptanceCriteria.length));
  if (!budget) return item.description;
  return `${item.description}\n\n用户选定的历史讨论依据（仅作背景，当前目标和验收标准优先）：\n${excerpt.slice(0, budget)}${excerpt.length > budget ? "\n[背景片段已节选，完整依据保存在需求来源中]" : ""}`;
}
