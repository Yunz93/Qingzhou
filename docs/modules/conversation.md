# 对话与工作衔接

状态：当前主体实现在 `4bbada9` 中验证，历史验收与合入不由本文声明。

自由对话探索问题，选择片段和来源图片后可整理为需求；原对话代码和验证不自动变成交付。需求对话保持身份，在内嵌、专注和完整布局间共用文字、图片草稿与阅读位置。

只读讨论不启动实施；已确认 PRD 的实施或反馈按录入的轮次派发，等待启动和收束时不绕过运行状态。附图在队列中本地保留，过期时明确报错，不静默丢弃。当前需求的审批和提问关联项目与需求，其他需求的事项进入待处理；隐藏最近会话与归档需求分开。

## 源码与验证

- [工作区](../../apps/web/src/components/board/RequirementWorkroom.tsx)、[对话组件](../../apps/web/src/components/board/WorkConversationDrawer.tsx)、[完整布局](../../apps/web/src/layouts/WorkbenchLayout.tsx)。
- [共享草稿](../../apps/web/src/lib/conversation-draft.ts)、[来源转换](../../apps/web/src/components/board/ChatToRequirementDialog.tsx)、[工作动态](../../apps/web/src/components/app/WorkActivity.tsx)。
- [轮次控制](../../apps/server/src/tasks/work-item-controller.ts)、[来源上下文](../../apps/server/src/tasks/work-item-context.ts)。
- 验证：[前端交互](../../tests/e2e/frontend-interactions.spec.ts)、[编排 E2E](../../tests/e2e/project-workflow.spec.ts)、[运行时集成](../../tests/integration/workflow-runtime.test.ts)。

来源：[编排 PRD](../prd/project-work-orchestration.md)的交互补充；关联 [需求设计](requirement-design.md) 与 [Agent 执行](agent-runtime.md)。
