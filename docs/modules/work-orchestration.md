# 项目工作编排

状态：主体能力在 `4bbada9` 中实现并验证；文档不补写平台验收或远端合入事实。

## 职责与流程

项目绑定 Git 仓库和集成分支；需求有稳定 ID、范围、对话和多轮执行。队列支持串行与并行、暂停、优先级和前置需求。需求使用独立工作区，源目录未提交改动不复制。

实施结束后明确选择文件封存提交，检查绑定准确代码树、配置版本和真实退出码。人工验收独立于检查；集成候选基于最新主线重新组合和验证，用户最终确认后通过 Git CAS 合入。A 先完成但未合入时，B 可先合入，再准备 A 的候选。

## 数据与约束

`WorkflowStore` 保存范围、工单、交付、检查、验收、候选及追加事件。重启打断执行，不自动重放副作用。资源锁与项目并发名额共同控制真实执行，当前范围和历史合入分别投影。过期候选、来源不一致、未封存文件和缺失证据不能被当作有效交付。

## 源码与验证

- [服务编排](../../apps/server/src/tasks/workflow-service.ts)、[事实存储](../../apps/server/src/tasks/workflow-store.ts)、[Git 边界](../../apps/server/src/tasks/workflow-git.ts)。
- [共享协议](../../packages/protocol/src/workflow.ts)、[工作区](../../apps/web/src/components/board/RequirementWorkroom.tsx)、[状态投影](../../apps/web/src/lib/requirement-state.ts)。
- [真实 Git 集成测试](../../tests/integration/workflow.test.ts)、[运行时回归](../../tests/integration/workflow-runtime.test.ts)、[浏览器流程](../../tests/e2e/project-workflow.spec.ts)。

依赖 [需求设计](requirement-design.md)、[Agent 执行](agent-runtime.md) 和 [对话衔接](conversation.md)。来源：[编排 PRD](../prd/project-work-orchestration.md)、[实现记录](../project-workflow.md)。
