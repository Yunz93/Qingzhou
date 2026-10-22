# 项目工作编排

状态：主体能力在 `4bbada9` 中实现并验证；文档不补写平台验收或远端合入事实。

## 职责与流程

项目绑定 Git 仓库和集成分支；需求有稳定 ID、范围、对话和多轮执行。队列支持串行与并行、暂停、优先级和前置需求。需求使用独立工作区，源目录未提交改动不复制。

实施结束后明确选择文件封存提交，检查绑定准确代码树、配置版本和真实退出码。人工验收独立于检查；集成候选基于最新主线重新组合和验证，用户最终确认后通过 Git CAS 合入。A 先完成但未合入时，B 可先合入，再准备 A 的候选。

## 数据与约束

`WorkflowStore` 保存范围、工单、交付、检查、验收、候选及追加事件。重启打断执行，不自动重放副作用。资源锁与项目并发名额共同控制真实执行，当前范围和历史合入分别投影。过期候选、来源不一致、未封存文件和缺失证据不能被当作有效交付。

工作区创建意图已持久化、但尚未创建目录时，明确重试会按原分支和基线补完创建。已完成后缺失的工作区和被占用的目录保留现场。端到端与中断证据见 [工作流恢复用例](../requirements/workflow-recovery-case/VERIFICATION.md)；本轮修复待用户确认。

## 源码与验证

- [服务编排](../../apps/server/src/tasks/workflow-service.ts)、[事实存储](../../apps/server/src/tasks/workflow-store.ts)、[Git 边界](../../apps/server/src/tasks/workflow-git.ts)。
- [共享协议](../../packages/protocol/src/workflow.ts)、[工作区](../../apps/web/src/components/board/RequirementWorkroom.tsx)、[状态投影](../../apps/web/src/lib/requirement-state.ts)。
- [真实 Git 集成测试](../../tests/integration/workflow.test.ts)、[运行时回归](../../tests/integration/workflow-runtime.test.ts)、[浏览器流程](../../tests/e2e/project-workflow.spec.ts)。

依赖 [需求设计](requirement-design.md)、[Agent 执行](agent-runtime.md) 和 [对话衔接](conversation.md)。来源：[编排 PRD](../prd/project-work-orchestration.md)、[实现记录](../project-workflow.md)。

## 工作流补全（待验收）

自动轮次记录授权请求、范围、PRD、检查配置与最大修复次数。真实检查失败时把失败命令和日志带入原需求的修复轮次；达到上限、设计/配置变化、执行失败或重启后停止推进。通过只进入待人工验收，不自动固化或合入。

集成候选必须包含源交付与目标主线，保持需求快照完整。每次重新验证清除原复审；复审绑定候选 commit、tree 和来源 PRD，设计变化阻止合入并转关联子需求。最终合入仍有独立确认与 Git CAS。

来源：[工作流闭环补全](../requirements/workflow-completeness/PRD.md)。

## 信息呈现精简（待验收）

总览默认展示未归档需求、执行名额和待处理事项；仅有排队时增加排队统计。运行计数放入“运行详情”，项目标准文件入口位于“编排设置”。历史合入仍通过“演进与回放”访问。

交付审阅隐藏没有内容的未完成项和产物栏目；封存补充信息、验证环境和检查日志按需展开。文件归属、实际风险、失败原因、逐条验收和合入确认直接保留。候选复审记录后显示结论，可展开“修改复审”；保存复审与最终合入保持两个独立动作。

来源：[前端信息精简](../requirements/frontend-simplification/PRD.md)。

## 项目历史精简（已实施，待验收）

项目历史按需求分组，展开关键里程碑后查看变更说明、单文件差异与当时对话；完整事件与工具记录按需展开，主线版本比较独立打开。历史检查明确对应当时版本。实现位于 `WorkflowHistory.tsx`，来源：[文档审阅 PRD](../requirements/document-review-simplification/PRD.md)。


发布复核补充：封存与候选复核保护不可变版本及其他需求的实际快照目录。合入仅信任已核对的完整索引树，全部变更路径、文件模式和 blob 必须属于本次受控文档；并发人工暂存保留并阻止合入。候选未涉及的已跟踪草稿不暂存。历史文件视图区分源交付到候选的组合差异和合入前主线到候选的实际合入差异。


索引衔接与恢复均先在独立索引准备结果，再持有 Git index.lock，确认原索引全部字节未改变后原子发布；同一路径的人工部分暂存也不能被覆盖。原索引变化或已有外部锁时保留现场并拒绝操作。

## 分层历史与需求四页签（已实施，待验收）

来源：[统一历史与分屏差异 PRD v2](../requirements/history-and-split-diff/PRD.md)。项目历史只展示无需求归属的项目事件及主线合入；需求历史只展示当前需求事件。关键/全部筛选共用一条按事件序号排列的列表，以事件 ID 去重，证据随节点回放。

需求侧栏为设计、交付、验收、历史。交付集中代码差异与候选；验收集中确切交付的测试文件变化、真实检查结果与人工验收。准备集成后返回交付审阅候选。现有封存、验证、验收和 Git 安全规则保持。

主线、相邻交付、封存、候选及历史差异统一通过 `PatchDiff.tsx` 与 `DiffView.tsx` 左右展示，保留各自基线含义。测试统计只从完整结束的单一日志摘要提取，多个摘要不擅自相加或选最后一份。代码入口另见 `AcceptanceEvidence.tsx`、`test-evidence.ts`、`workflow-history.ts`。验证覆盖 `split-diff.test.ts`、`history-projection.test.ts`、`test-evidence.test.ts` 和 `project-workflow.spec.ts`；实际结果见需求验证记录。

## v3 审阅结构（已实施，待验收）

交付与验收共用所选交付版本，单次查看一个版本；交付使用文件导航与左右差异，验收使用真实统计、变更用例清单和人工标准。只有完整扁平 Node TAP 且名称唯一时关联逐用例结果，其他情况明确未关联；点击用例进入相同交付的对应文件。历史版本保持只读，封存、验收、候选复审与最终合入的约束继续保留。历史平铺为单条时间线。

来源：[PRD v3](../requirements/history-and-split-diff/PRD.md)、[结构修订稿](../requirements/history-and-split-diff/STRUCTURE-v3.md)。此节记录本轮实现，不声明平台模块版本已确认或人工验收已通过。

发布复核补充：缺少文件归属的 TAP 用例结果只作为日志和总体统计，不与变更清单按名称关联。候选复审修改后可重新保存；未保存修改清除最终确认并阻止合入，保存设计变化结论后不能合入。

## 共享工作台视觉

来源：[YiMu 风格视觉改造 PRD v2](../requirements/yimu-visual-refresh/PRD.md) 的共用视觉部分，随用户授权的 Git 合并同步。项目总览、需求卡片、工作区、文档、差异和设置采用纸白、森林绿与细边框，选中和键盘焦点保持清晰；深色及手机布局共用语义变量。项目与文档标题使用本机宋体回退，密集工具区保持紧凑。

工作模式内嵌对话与自由对话共用阅读排版，具体规则见[对话模块](conversation.md)。现有五页签、PRD 确认、验收、集成及历史来源不变。实现位于 `styles/workflow.css`、`styles/app.css` 及共用主题入口；回归见 `project-workflow.spec.ts`、`visual-theme.spec.ts`，实际结果见本需求[验证记录](../requirements/yimu-visual-refresh/VERIFICATION.md)。本节不创建平台确认或验收事实。
