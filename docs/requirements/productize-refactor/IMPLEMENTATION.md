# 实施记录

状态：PRD v1 已获用户实施授权，三批均已实施与自测，最终效果待用户确认。

已读取仓库约定、现有配置、前两轮 PRD 与记录、核心页面及编排代码、相关回归和 productize-app 的产品/工程/交互/验证配方。发现职责耦合与草稿结构校验风险；目前属于源码分析，尚未运行本轮回归或将风险写为已复现缺陷。

## 第一批：状态和草稿

- 项目订阅从 ProjectWorkflow 提取到 useProjectWorkflow，保留连接与 5 秒可见轮询；成功和错误均检查项目身份、请求代次，并在失效时清理。
- PRD 草稿读取、结构校验、版本跟随和保存回执移入 usePrdDraft / prd-draft。保存只确认提交的快照，保留期间的新正文、原因和模块修改。
- 损坏缓存原先可让页面崩溃；新增就地恢复，先保留原文下载或创建并读回独立恢复副本，备份失败保留原值。无法写入的正常草稿保留内存副本，可再次写入；验收守卫读取同一缓存入口。
- useWorkflowAction 以对象身份和同步入口锁保护动作，旧页面的回执不应用到新对象，同帧重复提交只发一次，失败解锁后可重试。

验证：修复前损坏草稿 E2E 失败；修复后 9 项草稿单测、Web 类型检查及 3 项真实 Chromium E2E 通过（旧版草稿重开、损坏/备份失败恢复、延迟/重复/失败保存）。详细日志见验证记录。

## 第二批：按业务对象组织界面

ProjectWorkflow 原先同时定义项目订阅、设置、列表、交付、验收、集成复审和证据。现在项目入口只组合导航、运行摘要与项目视图；WorkflowSettings、WorkflowDashboard、RequirementWorkflow、DeliveryAcceptanceActions、IntegrationReview、VerificationDetails 分别拥有自身呈现。版本判断移入 requirement-planning，检查标签与时间格式集中在 workflow-presentation。

主要业务函数按原内容移动，保留 key、hidden 页签与 ReviewActions 挂载方式；没有用条件卸载改变草稿生命周期。项目设置、批量动作、验收与集成调用共用同步入口锁和对象身份保护；候选及验收规则继续使用原服务状态和精确版本，不把 UI 重构变成数据迁移。

## 第三批：检查命令适配器

WorkflowCommandRunner 只拥有实际进程、检查环境、输出上限与脱敏、超时和进程树清理。WorkflowService 保留名额/资源锁、检查状态、commit/tree/config 校验、持久化事件与后续轮次。退出先关闭适配器，不接受退出后的新命令。

5 个实际子进程用例覆盖工作目录与隔离环境、真实非零退出、日志脱敏与截断、超时后继续检查、启动失败和 POSIX 子孙进程组清理。相关工作流及运行时集成 80/80 通过，使用 CLI 60s 单用例上限，不修改仓库默认上限。

## 自复核补充

空字符串缓存也属于损坏草稿。验收守卫原先把空字符串等同于没有缓存，现改为仅 null 代表无缓存；增加对应回归。完整界面回归运行后，对这一末次修改和项目切换的迟到响应做定向补验。

保留所有原有未提交修改；本轮不更改历史验收事实、依赖或桌面分发。

## 改动位置与差异

下列行号对应 SOURCE-MANIFEST.md 的当前源码。

| 改前 → 改后 | 文件与行范围 |
| --- | --- |
| 页面内项目读取 → 专用订阅、双向失效检查 | [useProjectWorkflow.ts](../../../apps/web/src/hooks/useProjectWorkflow.ts#L6) 6–32；[BoardPage.tsx](../../../apps/web/src/pages/BoardPage.tsx#L12) 12–14 |
| 页面内缓存强制转换 → 校验、保护原文、恢复副本、保存快照 | [usePrdDraft.ts](../../../apps/web/src/hooks/usePrdDraft.ts#L5) 5–43；[prd-draft.ts](../../../apps/web/src/lib/prd-draft.ts#L3) 3–63；[RequirementDesign.tsx](../../../apps/web/src/components/board/RequirementDesign.tsx#L58) 58–104 |
| 多份 busy / catch → 对象内同步防重和失效回执保护 | [useWorkflowAction.ts](../../../apps/web/src/hooks/useWorkflowAction.ts#L7) 7–29；用于设置、列表、设计、交付与队列 |
| ProjectWorkflow 同时定义多种职责 → 项目导航只做组合 | [ProjectWorkflow.tsx](../../../apps/web/src/components/board/ProjectWorkflow.tsx#L18) 18–97；[WorkflowSettings.tsx](../../../apps/web/src/components/board/WorkflowSettings.tsx#L9) 9–58；[WorkflowDashboard.tsx](../../../apps/web/src/components/board/WorkflowDashboard.tsx#L12) 12–90 |
| 交付/验收/候选和证据混在项目文件 → 各自明确组件 | [RequirementWorkflow.tsx](../../../apps/web/src/components/board/RequirementWorkflow.tsx#L19) 19–118；[DeliveryAcceptanceActions.tsx](../../../apps/web/src/components/board/DeliveryAcceptanceActions.tsx#L9) 9–42；[IntegrationReview.tsx](../../../apps/web/src/components/board/IntegrationReview.tsx#L10) 10–53；[VerificationDetails.tsx](../../../apps/web/src/components/board/VerificationDetails.tsx#L4) 4–12 |
| 服务编排内启动与清理 shell → 薄检查进程适配器 | [workflow-command-runner.ts](../../../apps/server/src/tasks/workflow-command-runner.ts#L8) 8–54；[workflow-service.ts](../../../apps/server/src/tasks/workflow-service.ts#L122) 122–125、782 |

复用约束：保留既有技术栈、状态投影、协议、主题和焦点机制；采用 skill 的编辑会话、精确对象身份、受控异步、失败后重试和实际进程验证配方。没有引入新的状态框架、持久化格式或依赖。

最终结果：499 项单测、80 项集成、59 项完整 E2E，加末次 9 项单测及 4 项 E2E 补验通过。原生窗口未补验；原因、模拟边界和日志见 VERIFICATION.md。没有提交、推送、发版或用户验收。
