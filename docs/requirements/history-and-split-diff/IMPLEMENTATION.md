# 实施记录

当前阶段：用户在已认可的 v3 结构上新增模块设计页签，PRD v4；已完成实现与自测，待用户验收。以下保留 v2、v3 及 v4 实施记录。

- 协议保留 Git 文件前后路径、模式与变化类型；公共左右行模型保持片段真实行号，替换块补空行对齐。
- 公共分屏组件与多文件包装替换工作流原始 patch、审批和 Git 详情单列展示，长内容可继续展开。
- 项目与需求分别投影唯一历史时间线，关键/全部筛选共用列表。
- 需求侧栏整理为设计、交付、验收、历史；验收依据实际交付测试变更和真实检查结果，不补造用例通过事实。

验证：lint、typecheck、481 项全量单测、78 项真实 Git 集成及14项工作流回归通过；最后缓存补充另有4项单测和3项界面用例通过，含新增缓存用例。详见 VERIFICATION.md。本文件不修改平台确认、验收、固化或集成事实。

## v3 实施差异

| 改前 | 改后 | 文件与位置 |
| --- | --- | --- |
| 七步进度、下一步横幅及多层状态 | 单一需求状态、更多菜单；审阅栏默认 61% | `apps/web/src/components/board/RequirementWorkroom.tsx:49–123`、`apps/web/src/styles/workflow.css:356–452` |
| PRD、范围、路径、模块工具纵向堆积 | PRD 正文优先；范围与来源进入设置，模块工具按需展开；保存、确认、实施固定底部 | `apps/web/src/components/board/RequirementDesign.tsx:42–166`、`apps/web/src/components/board/ProjectWorkflow.tsx:308–323` |
| 多个交付卡片依次展开 | 版本选择器；左文件导航、右旧/新分屏；说明和产物折叠 | `apps/web/src/components/board/ProjectWorkflow.tsx:324–347`、`apps/web/src/components/diff/PatchDiff.tsx:5–26` |
| 验收首屏以测试源码差异为主 | 真实统计、用例变更、人工标准；点击用例跳转对应交付文件 | `apps/web/src/components/board/AcceptanceEvidence.tsx:4–31`、`apps/web/src/lib/test-evidence.ts:31–67`、`apps/web/src/components/board/ProjectWorkflow.tsx:348–394` |
| 里程碑嵌套展开及重复过程 | 平铺单条历史，关键/全部筛选；按需打开记录 | `apps/web/src/components/board/WorkflowHistory.tsx:69–77` |
| 操作跟随正文上下移动 | 四页签底部固定当前操作，保留原有确认和禁止条件 | `apps/web/src/components/board/ReviewActions.tsx:1–7`、`apps/web/src/components/board/RequirementWorkroom.tsx:123`、`apps/web/src/styles/workflow.css:365–376` |

组件保持挂载以保留草稿和表单。交付版本切换会清除上次用例文件选择；旧交付不显示当前版本的验收入口。用例级匹配仅依据完整已结束的扁平 Node TAP，重复名称、嵌套套件、截断或未知日志不推断通过。

视觉复核将长路径列表调整为文件名与所属目录，完整路径保留在标题提示、无障碍名称和右侧文件头；UUID 仅在目录显示标签中省略，不改变实际路径。文件列表和代码区各自滚动，避免选择长列表末尾文件时把工具行挤走。未增加依赖或服务端协议。

四页签在浏览器与本轮 Electron 构建均已复核，包含最小窗口的固定底部操作。验证命令、实际截图及限制见 [VERIFICATION.md](VERIFICATION.md)。未修改人工验收、固化或合入事实，未提交、推送或发布。

## v4 模块设计页签

用户增加模块产品设计变化的独立页签，按此授权实现。原四页签内只有设计工具中的模块编辑和固化设计的嵌套阅读；现在“设计”之后新增“模块设计”，按关联模块切换，左右比较绑定基线与本次提案。固化设计中的重复模块全文阅读移至新页签，导出 PRD 保留。

设计与模块页共用 `PrdEditor` 的当前草稿，不增加缓存或重复持久化；新页签只有可见时才计算文本差异。返回设计调整、保存、放弃和新版本读回均沿用原生命周期。固化后依据 `prd.moduleChanges` 只读显示，左侧只按 `baseRevisionId` 读取确切版本，不用后来发布的模块版本替代。

| 文件 | 改前 → 改后 |
| --- | --- |
| `apps/web/src/components/board/RequirementWorkroom.tsx:18–120` | 四页签 → 增加 modules 页签、直达和阅读位置 |
| `apps/web/src/components/board/RequirementDesign.tsx:21–163` | 单一设计正文 → 在同一草稿状态下切换设计与模块对照 |
| `apps/web/src/components/board/RequirementModuleChanges.tsx:1–32` | 新增模块选择器、准确基线分屏、草稿/固化标记、空状态及错误提示 |
| `apps/web/src/components/board/ProjectWorkflow.tsx:272–276` | 工作区视图类型扩展 modules，原交付/验收动作保持所属页签 |
| `apps/web/src/styles/workflow.css:453–462` | 新页沿用工具行、正文间距和固定动作；五个页签适配窄屏 |
| `tests/e2e/project-workflow.spec.ts:628–946` | 五页签浏览；新增多模块、草稿、保存、直接打开、键盘及窄屏回归；固化回归核对原基线 |

lint、typecheck 和 5 项相关页面回归通过，截图复核后修正窄屏选择器的容器宽度并复跑 1 项通过。实际截图与原生窗口复核结果见 VERIFICATION.md；未改协议、服务端状态或人工确认事实。

## v0.1.26 发布修正与交付

用户明确要求正式发布；在既有设计内修正四项复核发现。候选复审保留更新动作，编辑后清最终确认并阻止合入；name-only TAP 不再冒充已执行的变更用例；Git hunk 显式携带偏移；全文 diff 同文快速返回、剥离共同前后缀并限制矩阵预算，超预算仍完整保留两侧内容，渲染缓存复用。

涉及 ProjectWorkflow.tsx、AcceptanceEvidence.tsx、DiffView.tsx、split-diff.ts、test-evidence.ts、protocol/diff.ts 及对应回归。五包版本从 0.1.25 升为 0.1.26，CHANGELOG 和 README 发布示例同步。发布前 lint、typecheck、486 单测、101 集成和 52 页面回归通过，独立复核的四项均已修复。提交及正式发布遵循本轮用户新授权，不依据旧文档推断授权。
