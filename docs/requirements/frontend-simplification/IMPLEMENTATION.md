# 前端信息精简实施记录

状态：已实现并完成自检，待用户验收。不补写平台确认、固化或合入事实。

## 改前与改后

| 位置 | 改前 | 改后 |
| --- | --- | --- |
| 项目总览 | 五个常驻统计、两段运行说明、标准文件并列入口 | 三个核心统计，有排队再显示；运行详情折叠；标准文件归入设置 |
| 需求工作区 | 两套阶段进度、重复执行状态、常驻分支尾栏 | 顶部一套阶段进度和下一步；分支留在范围详情 |
| 需求设计 | 已确认范围和规则反复展开，技术路径占据正文上方 | 确认范围、技术信息按需展开，突出 PRD 正文和确认动作 |
| Agent 提案 | 已采用后仍展开过期警告和完整提案 | 当前提案展开；历史提案收起，保留问题和不可采用约束 |
| 模块文档 | 页面规则说明、常驻文档路径和空提案栏目 | 展示当前设计及代码状态；路径折叠，隐藏空提案栏目 |
| 交付 | 空风险、空产物占位，多组并列说明 | 有内容才展示风险和产物；补充封存信息按需展开 |
| 检查证据 | 环境配置与检查状态混排 | 状态直显，环境和日志分层展开 |
| 集成复审 | 保存结论后仍完整展开复审表单 | 已保存结论直显，修改表单折叠，独立确认合入 |
| 讨论、弹窗、待处理 | 选项与旁边说明重复、重复介绍页签用途 | 保留选项中的行为区别和实际副作用，删重复说明 |
| 弹窗键盘操作 | 折叠标题未纳入焦点循环，从标题按 Tab 会跳回开头 | 折叠标题参与正常 Tab 顺序，收起内容不参与循环 |
| 设置与项目规范衔接 | 项目规范作为总览独立入口 | 从设置打开项目规范，返回时保留未保存的设置，恢复原焦点 |

## 代码位置与行范围

- [项目总览、交付与集成](../../../apps/web/src/components/board/ProjectWorkflow.tsx)：75–168、286–411 行
- [需求工作区](../../../apps/web/src/components/board/RequirementWorkroom.tsx)：82–117 行；[PRD](../../../apps/web/src/components/board/RequirementDesign.tsx)：38–143 行
- [交付审阅](../../../apps/web/src/components/board/DeliveryReview.tsx)：10–17 行；[模块文档](../../../apps/web/src/components/board/ModuleDocuments.tsx)：25–40 行
- [需求对话](../../../apps/web/src/components/board/WorkConversationDrawer.tsx)、[待处理](../../../apps/web/src/components/board/AttentionInbox.tsx)
- [项目标准](../../../apps/web/src/components/board/ProjectStandard.tsx)、[新建需求](../../../apps/web/src/components/board/NewWorkItemDialog.tsx)、[对话转需求](../../../apps/web/src/components/board/ChatToRequirementDialog.tsx)
- [页面样式](../../../apps/web/src/styles/workflow.css)、[浏览器回归](../../../tests/e2e/project-workflow.spec.ts)
- [弹窗焦点循环](../../../apps/web/src/hooks/useDialogLayer.ts)：6 行
- [弹窗层级](../../../apps/web/src/components/board/WorkflowTabs.tsx)：26–43 行；子窗口打开时，父窗口保留草稿并退出交互与辅助技术访问，返回时恢复原控件焦点。

仅调整前端呈现，不改变服务端状态与权限。复审依据、旧提案、代码基线、文档路径与工作区分支继续可访问；设计保存、确认、文件归属、人工验收及合入的业务门槛保留。

此前工作流补全的未提交修改保留在工作区，本需求不自行提交或推送。
