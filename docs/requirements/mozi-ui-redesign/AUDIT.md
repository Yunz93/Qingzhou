# 界面与功能走查

依据 PRD v1，在当前运行界面先截图，再核对源码、操作结果与真实检查。状态：已完成本轮走查和修正，待用户确认。以下样例验收及合入只属于隔离项目，不代表本 UI 需求已经人工验收。

## 参考与证据位置

- 参考：markdown-press 当前源码、设计验收记录和本轮原生窗口实拍；[参考截图](../../../.qingzhou-test/mozi-ui-redesign/screenshots/00-markdown-press-reference.png)。参考文档内容中包含历史截图，外层当前工具栏与最新源码优先。
- 改前：同一轮采集的 `01`–`20` 截图，覆盖对话、工具、设置、项目和需求审阅。
- 最终：`26`–`41` 截图；`21`–`24` 为过程和原生检查，`25` 含旧手工夹具的目录限制提示，不用作最终健康状态证据。
- 全部截图位于 [.qingzhou-test/mozi-ui-redesign/screenshots](../../../.qingzhou-test/mozi-ui-redesign/screenshots/)。应用界面截图没有生成或重绘。

## 发现、处理和保留的功能

| 走查区域 | 改前问题 | 当前结果与证据 |
| --- | --- | --- |
| 首页 | 介绍、多个入口和示例并列 | 只留新建对话，全局工作导航保留。[改前](../../../.qingzhou-test/mozi-ui-redesign/screenshots/01-home.png) → [改后](../../../.qingzhou-test/mozi-ui-redesign/screenshots/26-minimal-home-dark.png) |
| 新建对话/项目 | 每次打开完整目录浏览器 | 目录摘要优先，浏览与手输按需打开，迟到的旧请求不能覆盖手输。[新建项目](../../../.qingzhou-test/mozi-ui-redesign/screenshots/27-compact-new-project.png) |
| 输入、模式与消息 | 滑杆和选项重复，发送策略与消息工具常驻 | 明确单选，权限说明保留；回复中才出现追加/排队；复制/重试支持悬停、聚焦和触摸。E2E 覆盖发送、IME、Esc、审批、问题、失败和焦点返回 |
| 工具与资源 | 全局视觉不连续 | 现有详情、文件、Git、终端、浏览器和资源入口保留，共享主题。改前 [详情](../../../.qingzhou-test/mozi-ui-redesign/screenshots/05-details.png)、[终端](../../../.qingzhou-test/mozi-ui-redesign/screenshots/06-terminal.png)、[资源](../../../.qingzhou-test/mozi-ui-redesign/screenshots/07-resources.png) 用于功能定位；终端的宿主 zsh 补全报错不是本轮应用错误 |
| 转需求 | 无项目时必须退出再回来，草稿流程中断 | 原处新建项目，取消返回焦点，保留目标、标准与来源；仍需确认后保存，不自动实施。新增真实交互回归 |
| 项目 | 总览、统计、分支、筛选占据多行 | 直接显示导航与需求工具行；运行详情放进更多；一个新建入口、六类筛选、一个关键状态。[改前](../../../.qingzhou-test/mozi-ui-redesign/screenshots/12-project-dashboard.png) → [浅色](../../../.qingzhou-test/mozi-ui-redesign/screenshots/36-minimal-project-final.png) / [深色](../../../.qingzhou-test/mozi-ui-redesign/screenshots/38-minimal-project-dark.png) |
| 需求设计与模块 | 重复区域标题、模式空操作和固定空栏 | 保留对象、状态、五页签和双栏；单需求无翻页；当前可执行的编辑/阅读切换；无操作时收起底栏。[改前](../../../.qingzhou-test/mozi-ui-redesign/screenshots/14-requirement-design.png) → [可执行状态](../../../.qingzhou-test/mozi-ui-redesign/screenshots/30-minimal-design-ready.png) / [固化只读](../../../.qingzhou-test/mozi-ui-redesign/screenshots/37-design-final-light.png) |
| 交付、验收、候选和历史 | 高后果流程必须保持清楚 | 保留文件归属确认、真实检查、逐条验收、候选复审与最终合入文字动作。[真实差异](../../../.qingzhou-test/mozi-ui-redesign/screenshots/32-delivery-split-review.png)、[验收证据](../../../.qingzhou-test/mozi-ui-redesign/screenshots/33-acceptance-evidence.png)、[候选复审](../../../.qingzhou-test/mozi-ui-redesign/screenshots/34-candidate-review.png)、[合入历史](../../../.qingzhou-test/mozi-ui-redesign/screenshots/35-workflow-history.png) |
| 设置 | 各组表单同时堆叠 | 一次显示当前分组，输入组件持续挂载，切换分组和主题保留未保存值。[设置](../../../.qingzhou-test/mozi-ui-redesign/screenshots/23-redesign-settings-light.png)，窄窗双主题与草稿保留由 E2E 覆盖 |

## 可达性与窗口

- 控件保留名称、tooltip、禁用语义和键盘焦点；页签方向键循环、菜单首项聚焦、Esc 和弹窗焦点返回均有行为验证。
- 浅色原陶土文字在选中底上只有 3.86:1，已改深陶土文字；输入边界改为专用强边界，浅/深约 3.64:1、3.38:1。普通文本与各语义文字的 token 已核对，不把这当作完整 WCAG 认证。
- 浏览器覆盖常规桌面、1440×900、1280×520、533×600 与 390×844；完整工作流回归包含长中文说明、分栏、五页签、双主题及局部差异滚动。
- 最终手工核对 533×600 与 390×844，页面 `scrollWidth` 分别为 533 与 390；窄窗以连续对话/需求与交付切换保留任务。[533×600](../../../.qingzhou-test/mozi-ui-redesign/screenshots/40-design-dark-533x600.png)、[390×844](../../../.qingzhou-test/mozi-ui-redesign/screenshots/41-design-dark-390x844.png)。检查后恢复正常视口。
- 实际 Electron 普通窗口已经运行和截图：[原生深色](../../../.qingzhou-test/mozi-ui-redesign/screenshots/31-native-current.png)。原生最小窗口调整因用户改变窗口而中断，本轮仅确认相同 CSS 尺寸的浏览器布局；没有据此宣称原生最小窗口通过。
- 本轮未完成真实浏览器 200% 缩放、Windows 宿主和屏幕阅读器全流程验证，保留为验收限制。

## 隔离流程结果

预览 `http://127.0.0.1:4313/board` 使用独立数据和模拟 Pi。样例“生成一份交付记录”完成范围及 PRD v1 确认、模拟实施、23 个文件的归属确认与封存、真实 Node 文件检查、逐条样例验收、候选检查与复审、明确合入以及历史查看。

样例交付 commit `22849b64f699962598d344f258c153095d3b1736`，候选/合入 commit `5d82f587`，目标 `integration`，原基线 `26c5410`。文件检查执行真实命令、退出码为 0，Git 日志与界面历史一致。模拟 Pi 的 `WRITE` 指令产物不能证明真实模型代码质量；没有对用户日常项目实施或合入。
