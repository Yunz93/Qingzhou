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

## 信息呈现精简（待验收）

工作区保留顶部一套阶段进度和右侧下一步，连续对话不重复显示执行状态。发送前通过“本轮目的”选项明确只读讨论或实施，不再并列重复解释。工作区分支与路径保留在“范围 → 工作区与基线”。来源转换保留“不会自动实施”的操作结果提示。

来源：[前端信息精简](../requirements/frontend-simplification/PRD.md)。

## UI 与反馈修订（已实施，待验收）

来源：[全量 UI 检视](../requirements/ui-experience-review/PRD.md)。待回答问题显示独立等待状态，空回答不能通过回车提交；仅成功的写入操作提示文件已改变。模式与思考设置显示短说明，审批记忆标签说明准确目标。弹窗使用实色背景，会话恢复和来源片段按需展开，约定文件显示目录来源，差异长行支持横向阅读。设置保留返回入口，导航在内容滚动时可达。

## 需求审阅侧栏与分屏（已实施，待验收）

来源：[统一历史与分屏差异 PRD v2](../requirements/history-and-split-diff/PRD.md)。侧栏仅保留设计、交付、验收、历史，连续对话和现有主题继续沿用。范围编辑、前置依赖及工作区细节从设计页的“需求范围与执行设置”进入；旧 `panel=scope` 链接映射至设计并展开该详情。

设计组件保持挂载，切换页签不会重置未保存正文或编辑状态；没有本地修改时跟随 PRD 版本刷新，冲突保留草稿，固化后只读。审批和 Git 详情与工作流共用 `DiffView.tsx` 左右行模型，多个片段使用真实行号，长内容有继续展示入口，窄屏在差异区域内滚动。

相关代码：`RequirementWorkroom.tsx`、`RequirementDesign.tsx`、`components/diff/`、`lib/split-diff.ts`；回归见 `project-workflow.spec.ts` 与 `split-diff.test.ts`。测试及截图记录不替代人工验收。

## v3 审阅结构（已实施，待验收）

需求头只显示标题、简短状态与更多菜单，去掉七步导航和常驻下一步横幅。默认审阅栏宽度为 61%，可拖动调整；专注模式、需求设置从更多菜单进入。四个页签共用工具行、主体和固定底部操作区，连续对话继续保留。旧范围链接打开设计及需求设置。

来源：[PRD v3](../requirements/history-and-split-diff/PRD.md)、[结构修订稿](../requirements/history-and-split-diff/STRUCTURE-v3.md)。此节记录本轮实现，不声明平台模块版本已确认或人工验收已通过。

## v4 模块设计审阅（已实施，待验收）

需求工作区新增“模块设计”，顺序为设计、模块设计、交付、验收、历史。按本需求关联模块切换，左右比较准确绑定的基线与本次产品设计；本地草稿与设计页共享状态，保存和放弃立即反映，固化后使用固化 PRD 的提案。基线缺失不退回最新设计，明确提示无法比较。此页仅审阅，调整返回设计，确认与模块发布规则保持原契约。

来源：[PRD v4](../requirements/history-and-split-diff/PRD.md)。

发布复核补充：Git hunk 元数据与正文分离，形似片段头的正文不会重置行号；全文比较限制矩阵分配并复用未变化文本。超预算时保留完整前后正文，以块替换展示。

## 共享视觉与对话阅读

来源：[YiMu 风格视觉改造与对话阅读 PRD v2](../requirements/yimu-visual-refresh/PRD.md)。本节随用户授权的 Git 合并同步当前实现，不声明平台模块版本或验收状态。

对话、侧栏和输入区使用纸白、鼠尾草绿与森林绿，深色使用墨绿灰；品牌和少量页面标题使用本机宋体回退。用户轮次、助手正文、思考与工具过程分别呈现，正文标题、段落、列表、引用和表格保留独立间距。窄屏优先保留主要操作，长路径换行，宽代码和表格在各自区域滚动。

流式和完成正文使用同一套稳定 Markdown 组件，生成阶段延后更新正文并跳过代码高亮，完成后高亮。代码块展示语言并支持复制原始代码。思考与成功只读操作按需展开，异步收到失败时自动展示输出，用户仍可收起。安全 URL、HTML 转义、工作区媒体边界和既有草稿、滚动、搜索及审批契约继续保留。

代码入口：`components/timeline/AssistantMarkdown.tsx`、`ConversationTimeline.tsx`、`ToolExecutionRow.tsx`、`ToolGroupRow.tsx`、`lib/clipboard.ts` 和 `styles/app.css`。验证入口：`conversation-rendering.spec.ts`、`visual-theme.spec.ts` 及既有前端交互 / 工作台 E2E；完整结果和真实模型、原生桌面边界见[验证记录](../requirements/yimu-visual-refresh/VERIFICATION.md)。
