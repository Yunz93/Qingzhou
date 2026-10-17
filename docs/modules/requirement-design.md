# 需求设计与模块文档

已有设计生命周期在 `4bbada9` 中实现并验证。本轮 [项目标准需求](../requirements/project-standards/PRD.md) 增加标准目录、Agent 规范和 Markdown 双向同步，待验收。

## 当前设计

需求先沟通并确认范围，再保存并确认具体 PRD。PRD 内容按版本追加，执行与交付绑定准确 PRD ID。实施后设计可继续调整；新 PRD 需重新确认和实施，旧交付不能代替新设计验收。最终人工验收固化对应 PRD，后续设计变更创建关联子需求。

PRD 可关联多个模块，每项包含模块 ID、依据版本和完成后的完整设计。验收先检查全部模块的版本，再统一发布模块设计。当前确认设计、进行中的提案及代码合入状态分别展示，防止并行需求覆盖已发布设计。

## 标准文件与同步

根 `AGENTS.md` 是协作入口，`docs/project/` 保存长期信息，`docs/modules/` 描述模块当前设计，需求目录保存独立变更。标准清单固定文档路径，初始化只补齐缺失文件。

需求执行目录保存 PRD.md、modules/、IMPLEMENTATION.md、VERIFICATION.md；CONTEXT.md 和 baselines/ 保留确切系统快照。保留原 JSON 路径，按原 PRD 合并 JSON 和 Markdown 修改；冲突拒绝同步。只读事实不允许被改写为用户确认，过程文档不等同于平台证据。详见 [目录和权责](../standards/project-layout.md)。

## 源码与验证

- [设计协议](../../packages/protocol/src/design.ts)、[标准路径](../../packages/protocol/src/project-standard.ts)。
- [PRD 服务](../../apps/server/src/tasks/workflow-design.ts)、[标准初始化](../../apps/server/src/tasks/project-standard.ts)、[Markdown 与快照](../../apps/server/src/tasks/workflow-design-docs.ts)、[安全文件访问](../../apps/server/src/tasks/workspace-files.ts)。
- [设计面板](../../apps/web/src/components/board/RequirementDesign.tsx)、[模块视图](../../apps/web/src/components/board/ModuleDocuments.tsx)。
- 回归涵盖版本确认、模块 CAS、文件同步、固化保护、标准初始化、路径和交付快照。

来源：[需求设计生命周期 PRD](../prd/requirement-design-lifecycle.md)、[项目标准需求](../requirements/project-standards/PRD.md)。依赖 [编排](work-orchestration.md) 与 [Agent 执行](agent-runtime.md)。
