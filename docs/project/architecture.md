# 轻舟架构与代码边界

## 目录与运行入口

| 路径 | 职责 | 主要入口 |
| --- | --- | --- |
| `packages/protocol/src/` | Zod 协议、共享类型和状态约束 | `client-commands.ts`、`workflow.ts`、`design.ts`、`project-standard.ts` |
| `apps/server/src/` | 本机 HTTP / WebSocket、会话、编排与持久化 | `index.ts`、`tasks/task-service.ts` |
| `apps/server/src/tasks/` | 需求、PRD、Git 工作区、验证和集成 | `workflow-service.ts`、`workflow-design.ts`、`project-standard.ts` |
| `apps/server/src/pi/` | Pi 子进程、RPC、状态、审批和提问 | `process-supervisor.ts`、`rpc-client.ts` |
| `apps/server/src/security/` | 访问、路径和敏感信息保护 | `path-policy.ts`、`session-cookie.ts` |
| `apps/web/src/` | React 页面、组件、状态与消息传输 | `pages/BoardPage.tsx`、`layouts/WorkbenchLayout.tsx` |
| `apps/desktop/` | Electron、安装、更新和打包 | 目录内 `package.json` 与 `scripts/` |
| `tests/unit/`、`tests/integration/`、`tests/e2e/` | 纯逻辑、真实 Git / 服务以及浏览器回归 | 根配置与项目验证文档 |

协议变更先在 `packages/protocol` 定义并构建，再更新服务端与前端。不要让页面自行生成审批、验收或合入事实。

## 数据与状态权责

`WorkItemStore` 保存项目、需求、执行和反馈；`WorkflowStore` 保存范围、PRD、模块版本、交付、检查、验收、集成和追加事件。服务端持久化保留事实，前端 `requirement-state.ts` 统一投影当前范围与历史状态。

独立工作区、封存提交、集成候选和真实检查绑定具体版本。重启中断不重放副作用，集成使用 Git 引用检查和 CAS；原项目目录有未提交改动时不覆盖它。

项目标准清单与模板由 `project-standard.ts` 生成；安全文件访问集中在 `workspace-files.ts`。`workflow-design-docs.ts` 提供需求的 Markdown 与只读快照，`workflow-design.ts` 将修改读回为新 PRD。JSON 与 Markdown 有不同修改时拒绝静默取舍。

## 主要模块

见 [模块索引](../modules/README.md)。跨模块契约或数据语义变化需要同步模块文档、需求 PRD 和必要的 ADR。渲染状态、过程记录、真实证据之间保持明确边界。
