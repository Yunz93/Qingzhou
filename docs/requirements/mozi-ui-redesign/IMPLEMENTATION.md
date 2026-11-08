# 实施记录

依据：PRD v1 及用户关于最小元素集的继续指令。状态：代码已实现并完成自测，待用户确认。

## 改前与改后

| 区域 | 改前 | 改后 | 文件 |
| --- | --- | --- | --- |
| 全局视觉 | 冷灰画布、蓝色强调、多种表面与阴影 | 暖白/金属灰同色画布、系统字体、陶土动作与清晰语义色 | apps/web/src/styles/app.css、workflow.css |
| 进入产品 | 品牌介绍、三种入口和示例按钮并列 | 首页一个新建对话入口，沿用全局工作导航 | layouts/WorkbenchLayout.tsx |
| 目录选择 | 默认展开完整目录浏览器 | 已选目录摘要，按需浏览或手输；切换取消旧请求 | setup/FolderField.tsx、FolderPicker.tsx；新建对话/项目表单 |
| 输入设置 | 两条滑杆与重复按钮、闲置时显示发送策略 | 明确单选，权限语义保留；回复中才显示追加/排队 | composer/ComposerCapsules.tsx、PromptComposer.tsx |
| 项目页 | 总览统计、分支栏、运行说明、独立筛选多行 | 直接进入项目导航和任务工具行，低频信息放进更多 | board/ProjectWorkflow.tsx、WorkflowTabs.tsx |
| 需求列表 | 每行范围版本及多种未完成状态 | 一个当前关键状态，单个需求隐藏批量选择 | board/ProjectWorkflow.tsx |
| 需求审阅 | 单个需求仍显示翻页、重复区域名与 PRD 工具 | 保留对象、状态、五页签和双栏；仅展示当前可执行操作 | RequirementWorkroom.tsx、RequirementDesign.tsx、WorkConversationDrawer.tsx |
| 消息 | 复制、重试常驻；字距偏紧 | 指针环境按需显露操作，键盘/触摸可达，反馈持续可见 | timeline/ConversationTimeline.tsx |
| 设置 | 所有分组纵向堆叠 | 分组按需显示，组件保持挂载并保留输入 | pages/SettingsPage.tsx |
| 转需求 | 没有项目时必须退出表单创建 | 原处创建项目，保留来源、草稿和返回焦点 | board/ChatToRequirementDialog.tsx |

## 复核与修正

- 旧目录请求晚回可能覆盖手输值：浏览请求在切换、卸载或新请求时取消，旧响应不会继续回写。
- 嵌套项目弹窗关闭时，父层 inert 尚未解除会使原生焦点恢复失效：在解除后由父层恢复至原入口，新增行为回归。
- 原陶土文字在米色选中底上的对比度为 3.86:1：动作色保留，强调文字使用参考产品的深陶土；浅色语义文字同步增强。
- 去掉已确认 PRD 的重复“可开始实施”提示，避免实施已结束时仍作错误引导；实际开始按钮继续由原状态规则决定。
- 现有滚动回归依赖短文恰好溢出：改用明确的长需求说明，继续检查滚动和返回最新行为。
- 删除两个与旧界面形态绑定的源码字符串断言；新增及修订浏览器回归验证真实操作结果。

## 边界

现有协议、服务状态机、确认、封存、验收、固化和 Git 安全规则保持。原目录包体改动未修改；没有提交、推送、发版或替换安装应用。

当前自测结果及限制见 VERIFICATION.md，截图走查见 AUDIT.md。文档不代替平台执行证据或人工验收。

## 改动位置

以下为当前未提交工作区行范围，可点击起始行；新旧行为见上表，确切文件内容见 SOURCE-MANIFEST.md。

| 改动 | 文件与当前行范围 |
| --- | --- |
| 共享主题、文字与控件 | [app.css](../../../apps/web/src/styles/app.css#L5) 5–120、482–569、1597–1612、2687–2705；[workflow.css](../../../apps/web/src/styles/workflow.css#L364) 364–386、464–475 |
| 首页单一入口、对话转需求图标 | [WorkbenchLayout.tsx](../../../apps/web/src/layouts/WorkbenchLayout.tsx#L837) 837、993–995 |
| 目录摘要及请求取消 | [FolderField.tsx](../../../apps/web/src/components/setup/FolderField.tsx#L6) 6–35；[FolderPicker.tsx](../../../apps/web/src/components/setup/FolderPicker.tsx#L48) 48–82 |
| 模式单选与上下文发送策略 | [ComposerCapsules.tsx](../../../apps/web/src/components/composer/ComposerCapsules.tsx#L39) 39–62、178–203；[PromptComposer.tsx](../../../apps/web/src/components/composer/PromptComposer.tsx#L468) 468–487 |
| 项目导航、单状态、筛选与批量入口 | [ProjectWorkflow.tsx](../../../apps/web/src/components/board/ProjectWorkflow.tsx#L83) 83–113、224–259 |
| 单需求导航和 PRD 工具、动作栏 | [RequirementWorkroom.tsx](../../../apps/web/src/components/board/RequirementWorkroom.tsx#L97) 97–110；[RequirementDesign.tsx](../../../apps/web/src/components/board/RequirementDesign.tsx#L110) 110、153–160 |
| 转需求原处创建项目及焦点恢复 | [ChatToRequirementDialog.tsx](../../../apps/web/src/components/board/ChatToRequirementDialog.tsx#L10) 10–18、31–50 |
| 消息操作与设置分组 | [ConversationTimeline.tsx](../../../apps/web/src/components/timeline/ConversationTimeline.tsx#L166) 166、253；[SettingsPage.tsx](../../../apps/web/src/pages/SettingsPage.tsx#L27) 27–28、342–703 |

## 后续真实模型走查

用户进一步要求真实 DeepSeek 完整需求生命周期，结果见 [deepseek-lifecycle](../deepseek-lifecycle/IMPLEMENTATION.md)。该后续修复调整提案呈现、向导凭据来源及相关协议与回归；本需求原快照及历史验证记录保留，叠加后的当前源码以其 SOURCE-MANIFEST.md 为准。独立样例的验收与合入不代表用户已验收本轮 UI 改动。

2026-11-08 后续 [产品化重构](../productize-refactor/IMPLEMENTATION.md) 拆分项目与需求组件，整理草稿和检查进程边界；此处保留此前文件位置与历史证据，最新工作区源码以该后续需求的 SOURCE-MANIFEST.md 为准。
