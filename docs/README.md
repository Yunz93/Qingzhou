# 轻舟项目文档

新接手项目先读 [项目概览](project/overview.md)、[架构](project/architecture.md)、[验证方式](project/verification.md) 和 [Agent 工作流](agents/workflow.md)。规范入口是根目录 [AGENTS.md](../AGENTS.md)。

| 文档 | 维护内容 |
| --- | --- |
| [项目标准结构](standards/project-layout.md) | 文件目录、编辑权、版本、生成与同步规则 |
| [Agent 职责](agents/roles.md) | 沟通、规划、实施、复核、集成的职责边界 |
| [模块设计索引](modules/README.md) | 各模块当前设计、代码入口、测试和来源 PRD |
| [需求索引](requirements/README.md) | 独立需求、设计迭代、交付和后续子需求 |
| [设计决策](decisions/README.md) | 跨模块和兼容性取舍 |
| [模板](templates/prd.md) | PRD、模块设计和验证记录的写作骨架 |
| [编排实现与验证记录](project-workflow.md) | 各轮改造的行为差异和验证结果 |

历史 PRD 保留原路径：[项目工作编排](prd/project-work-orchestration.md)、[需求设计与模块文档](prd/requirement-design-lifecycle.md)。历史文档不是当前状态的唯一来源，相关模块文档指向当前实现。

本轮需求见 [项目标准与 Agent 规范](requirements/project-standards/PRD.md)。应用编排出的需求保存在 `docs/qingzhou/requirements/<需求 ID>.json` 及同名目录；项目标准清单为 `docs/qingzhou/project.json`。实际审批、验收、PRD 固化和 Git 集成事实由服务端持久化，文档不能自行替代。
