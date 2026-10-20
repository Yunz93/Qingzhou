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

## 工作流补全（待验收）

新 PRD 的 `codeBaseline` 记录代码 commit 和模块版本映射，按 Git 祖先关系选择确切代码包含的设计；已验收未合入版本不替代此映射。独立同模块提案可以分别验收，后续合并通过集成候选复审处理。旧 PRD 保留原校验方式。

只读讨论的结构化提案绑定需求、范围与原 PRD，持久化后可对照正文、模块变更和待确认问题采用为草稿；保存仍使用原有乐观版本检查。格式错误、串需求或串项目的提案不被采用。

模块新增稳定仓库路径；历史模块在下一次使用新确认 PRD 实施时补齐路径，不覆盖手工文档。仓库文档随交付封存并核对提案；集成后的内容回读为带 integrationId 的独立模块修订。固化 PRD 不因此改写。

来源：[工作流闭环补全](../requirements/workflow-completeness/PRD.md)。代码：[模块文档同步](../../apps/server/src/tasks/workflow-module-docs.ts)。

## 信息呈现精简（待验收）

范围确认后折叠目标与验收标准；PRD 编辑突出正文、保存和确认。代码基线、工作区文档、备用草稿来源及未选择的模块按需展开。当前结构化提案默认展开，依据过期的提案保留在历史详情中，不能再次覆盖草稿。已保存的版本、未保存草稿和新版本冲突提示仍然独立。

模块页直接展示当前设计、对应代码状态、来源及主线设计；文档路径折叠，无进行中的提案时隐藏空栏目。确认、版本和固化规则未变化。来源：[前端信息精简](../requirements/frontend-simplification/PRD.md)。

## Markdown 存储与审阅（已实施，待验收）

来源：[文档审阅 PRD v1](../requirements/document-review-simplification/PRD.md)。默认阅读渲染正文，编辑与预览独立；模块默认展示主线对应设计，初始与未合入版本标明状态。路径支持复制，Electron 可打开文件。

新建模块与显式保存 PRD 即写入项目目录；`documentPaths` 配置只影响新绑定。正文以真实 Markdown 为唯一来源，不可变版本保存于 `.versions/`，状态保存路径和 hash，读取缺失或损坏时明确报错。外部编辑须显式同步成未确认的新版本；旧需求先预览再导入，保留原 ID、确认和封存工作区路径。未导入旧需求继续兼容双入口。

文件和状态通过持久化写入日志恢复；只回滚本次预期字节，外部修改保留。新工作区复制确认版本及模块快照。确认、开工和封存均检查原项目文档没有外部修改。合入只衔接精确登记的文档，人工暂存和未知改动保持阻挡。

代码：[项目文档服务](../../apps/server/src/tasks/project-documents.ts)、[绑定协议](../../packages/protocol/src/documents.ts)、[目录设置](../../apps/web/src/components/board/DocumentSettings.tsx)、[文档阅读](../../apps/web/src/components/board/DocumentReader.tsx)。验证覆盖自定义目录、文件占用与链接、外部冲突、迁移、中断和安全合入。


发布复核补充：目录长度与生成文件路径长度分别校验，外部同步复用协议正文限制。状态省略正文仅适用于有 Markdown 绑定的 PRD / 模块版本，讨论提案始终保存正文。导入绑定在文件成功后发布；旧 JSON-only 工作区及已提交的导入初始模块仍可继续实施。验收与合入共享项目文档锁，防止并发分配重复模块版本。
