# 需求索引

| 需求 | PRD 与当前状态 | 涉及模块 |
| --- | --- | --- |
| 轻舟产品化重构 | [PRD v1](productize-refactor/PRD.md)、[实施](productize-refactor/IMPLEMENTATION.md)、[验证](productize-refactor/VERIFICATION.md)，已实施并自测、待用户确认 | 工作流职责、草稿与异步操作、检查命令适配器 |
| 真实 DeepSeek 需求生命周期验证与修复 | [PRD v1](deepseek-lifecycle/PRD.md)、[实施](deepseek-lifecycle/IMPLEMENTATION.md)、[真实闭环](deepseek-lifecycle/LIFECYCLE.md)、[验证](deepseek-lifecycle/VERIFICATION.md)，独立样例已合入，轻舟修复待用户确认 | 凭据来源、只读提示、设计提案、精简对话、交付与集成 |
| 轻舟 UI 重设计与交互精简 | [PRD v1](mozi-ui-redesign/PRD.md)、[界面规范](mozi-ui-redesign/DESIGN.md)、[实施](mozi-ui-redesign/IMPLEMENTATION.md)、[走查](mozi-ui-redesign/AUDIT.md)、[验证](mozi-ui-redesign/VERIFICATION.md)，已实施并自测、待用户确认 | 最小页面元素、统一视觉、对话与需求、设置及焦点恢复 |
| 统一历史与分屏差异审阅 | [PRD v4](history-and-split-diff/PRD.md)、[实施](history-and-split-diff/IMPLEMENTATION.md)、[验证](history-and-split-diff/VERIFICATION.md)，自测通过待验收 | 需求五页签、模块设计变化、分层历史与统一左右 diff |
| 文档审阅与 Markdown 存储 | [PRD](document-review-simplification/PRD.md)、[实施](document-review-simplification/IMPLEMENTATION.md)、[验证](document-review-simplification/VERIFICATION.md)，实施验证中 | PRD、模块、目录配置、项目历史、安全合入 |
| 全量 UI 与交互检视 | [PRD](ui-experience-review/PRD.md)、[实施](ui-experience-review/IMPLEMENTATION.md)、[验证](ui-experience-review/VERIFICATION.md)，实施验证中 | 对话、详情、设置、向导、工作台与关键弹窗 |
| 工作流端到端与中断恢复 | [PRD](workflow-recovery-case/PRD.md)、[实施](workflow-recovery-case/IMPLEMENTATION.md)、[验证](workflow-recovery-case/VERIFICATION.md)，待确认 | 工作区创建、中断恢复、真实需求全链路 |
| 前端信息精简 | [PRD](frontend-simplification/PRD.md)、[实施](frontend-simplification/IMPLEMENTATION.md)、[验证](frontend-simplification/VERIFICATION.md)，待验收 | 项目总览、需求工作区、PRD、交付与集成 |
| Agent 工作流闭环补全 | [PRD](workflow-completeness/PRD.md)、[实施](workflow-completeness/IMPLEMENTATION.md)、[验证](workflow-completeness/VERIFICATION.md) | 候选复审、模块基线与文档、设计提案、自动验证修复 |
| 项目标准与 Agent 规范 | [PRD](project-standards/PRD.md)、[实施](project-standards/IMPLEMENTATION.md)、[验证](project-standards/VERIFICATION.md) | 需求设计、编排、Agent 执行 |
| 历史项目工作编排 | [原 PRD](../prd/project-work-orchestration.md)，保留历史路径 | 编排、对话、执行 |
| 历史需求设计与模块文档 | [原 PRD](../prd/requirement-design-lifecycle.md)，保留历史路径 | PRD、模块和交付 |

手工需求文档记录具体方案和实现，不补造平台范围确认或验收记录。后续新增需求使用稳定需求键；平台需求使用稳定 UUID。可通过父 PRD 和模块文档双向关联。
