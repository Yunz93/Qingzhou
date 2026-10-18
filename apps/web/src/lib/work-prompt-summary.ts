import { AGENT_CONTEXT_MARKER } from "@qingzhou/protocol";

/** Keep the user's objective readable while retaining all Agent context in the expansion. */
export function workPromptSummary(text: string) {
  const discussion = text.startsWith("请讨论并完善需求「") && text.includes("用户问题：") && text.includes(AGENT_CONTEXT_MARKER);
  const structured = discussion || text.startsWith("请完成下面这个工作目标。") || text.includes("这是工作台补充要求后的新一轮：");
  if (!structured) return { structured, goal: text };
  const instruction = text.split(AGENT_CONTEXT_MARKER)[0]!;
  if (discussion) return { structured, goal: instruction.slice(instruction.indexOf("用户问题：") + "用户问题：".length).trim() };
  const goal = (instruction.split("标题：")[1] ?? instruction.split("本轮补充要求：")[1] ?? instruction).trim();
  // Earlier saved rounds have the same PRD heading but predate the explicit boundary marker.
  const boundary = goal.search(/\n\n(?:## (?:已确认|待确认)的 PRD v\d+|项目协作入口：)/);
  return { structured, goal: boundary < 0 ? goal : goal.slice(0, boundary).trimEnd() };
}
