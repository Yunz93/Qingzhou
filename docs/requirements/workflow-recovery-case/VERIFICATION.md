# 验证记录

日期：2026-10-19。以下为当时的未提交验证记录；2026-10-20 用户另行授权随本轮文档改造提交、推送与发布。最终人工确认另行记录。

## 真实端到端用例

使用独立生产 Web 实例 `http://127.0.0.1:4311`、独立数据目录 `.qingzhou-test/flow-audit/data/` 和独立 Git 项目 `.qingzhou-test/flow-audit/project/`。日常 Electron 实例使用的端口和需求数据保留。

- 项目：端到端中断恢复用例。
- 需求：问候函数支持中文并保持兼容，ID `0c807c3a-9edf-4288-aadd-4e20ad10482d`。
- 真实 Agent：Pi `0.99.1`，模型 DeepSeek V4.1 Flash；此用例未使用 fake Pi。
- 原始项目：`3301c277d05cfe93e28783aedcf3358d16569399`。
- PRD：`eb4f95dc-55b8-4208-ae4b-d4f7cd3c69dc`，v1。
- 交付：`398f3f58-5288-4d18-97d2-f740eabc24fe`，commit `56ce8a39d55ff7d5dc1ad4382500667f74b9d570`。
- 最终测试项目主线：`e16b3b568e20c4aad06d9228e9b65a2f9e519bbb`，工作树干净。

实际从界面完成：初始化 → 创建项目与真实检查命令 → 新建需求 → 真实只读讨论 → 采用结构化设计 → 确认范围与 PRD → 实施并验证 → 逐条验收与固化 → 准备候选 → 重新验证 → 记录候选复审 → 合入测试主线。

Agent 实际修改 `greeting.js` 与 `greeting.test.js`，补充实施与验证记录。新增中文问候、空白姓名回退、未支持语言回退和兼容用例；原英文用例保留。独立复跑需求工作区、候选和最终主线的 `node --test` 均为 6 通过、0 失败。候选相对源交付无文件差异，合入后主线 HEAD 与集成记录一致。

隔离用例里的确认和验收操作用于验证平台链路，不代表用户已验收轻舟本轮修复。

## 两次突然退出

1. 实施阶段：源码和测试产生改动后，强制终止独立服务器及其 Pi 子进程。重启后实施工单和自动轮次均标记 `interrupted`；原 PRD 仍已确认，源码改动与对话保留，没有自动重跑。通过界面明确继续，真实 Pi 完成原需求，平台自动封存并检查通过。
2. 集成验证阶段：监测到集成验证为 `running` 时强制终止独立服务器及其检查子进程。重启后验证为 `interrupted`，候选为 `failed`，旧证据不能用于合入。通过“封存候选并重新验证”取得新通过证据，再复审并合入。

现场证据位于 `.qingzhou-test/flow-audit/implementation-crash.json`、`verification-crash.json`、`data/workflow.json`、`server.log` 和 `e2e-completed.png`。只终止测试实例的进程，未强制终止日常 Electron 实例。

## 修复回归

新增测试位于 `tests/integration/workflow.test.ts`，使用真实临时 Git 仓库，模拟持久化工作区意图后、Git 创建前的中断。

- 修复前：重启后明确重试仍未启动，断言 `launched.length === 1` 失败；证据 `workspace-red.log`。
- 修复后：能够创建原分支并生成原确认 PRD 文档；证据 `workspace-green.log`。
- 已创建后被移动的工作区不会重建，原文件保留。
- 未完成创建的目录被无关文件占用时不会覆盖文件或创建分支。

```bash
pnpm test:integration tests/integration/workflow.test.ts -t 'workspace creation|completed workspace moved'
```

结果：3 通过。没有通过修改产品的确认、验收或固化元数据绕过检查。

## 项目检查

| 检查 | 结果 |
| --- | --- |
| `pnpm build` | 端到端前构建通过；修复后服务端单独构建通过 |
| `pnpm lint` | 通过 |
| `pnpm typecheck` | 所有包通过 |
| `pnpm test` | 448 通过，Windows 安装用例 3 跳过 |
| `pnpm test:integration` | 修复后 76 通过、1 跳过；包含新增 3 项恢复与保护回归 |
| `git diff --check` | 通过 |

本次没有修改 UI；浏览器回归由上述真实需求全链路操作验证，未将 fake Pi 测试冒充真实模型行为，也未调用占用日常 `4310` 端口的全量 Playwright 启动脚本。

## 限制

强制终止进程验证的是应用突然退出，不是物理断电或磁盘故障。已有异常 Git 分支、外部移动或占用的目录保留现场并报告错误，修复不会自动删除、重置或强制接管。模拟测试不能证明所有未知项目、模型和检查命令均无问题。
