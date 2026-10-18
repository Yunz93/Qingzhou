import { expect, it } from "vitest";
import { AGENT_CONTEXT_MARKER, workItemFeedbackPrompt, workItemPrompt } from "@qingzhou/protocol";
import { workPromptSummary } from "../../apps/web/src/lib/work-prompt-summary";

it("keeps the objective and criteria while folding generated Agent paths and PRD content", () => {
  const prompt = workItemPrompt({ title: "恢复入口", description: "保留用户编辑内容", acceptanceCriteria: "中断后可以继续" }) + AGENT_CONTEXT_MARKER + "工作区路径与模块基线";
  expect(workPromptSummary(prompt)).toEqual({ structured: true, goal: "恢复入口\n\n目标说明：\n保留用户编辑内容\n\n验收标准：\n中断后可以继续" });
});
it("preserves feedback and supports earlier saved PRD context without the marker", () => {
  const prompt = workItemFeedbackPrompt({ title: "恢复入口" }, "调整提示文案");
  expect(workPromptSummary(prompt + AGENT_CONTEXT_MARKER + "Agent 规则")).toMatchObject({ goal: "调整提示文案" });
  expect(workPromptSummary(prompt + "\n\n## 已确认的 PRD v2（版本 ID）\n很长的设计正文")).toMatchObject({ goal: "调整提示文案" });
});
it("does not hide freely entered conversation content that mentions Agent context or PRDs", () => {
  const text = "我们讨论一下\n\n## 已确认的 PRD v2\n这是用户自己输入的内容";
  expect(workPromptSummary(text)).toEqual({ structured: false, goal: text });
});
it("keeps the discussion question while folding proposal format and project instructions", () => {
  const text = "请讨论并完善需求「入口」的目标、边界和验收标准。\n用户问题：先讨论错误路径" + AGENT_CONTEXT_MARKER + "结构化协议与完整 Agent 上下文";
  expect(workPromptSummary(text)).toEqual({ structured: true, goal: "先讨论错误路径" });
});
