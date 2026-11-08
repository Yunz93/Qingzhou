# Agent 执行与权限

状态：当前主体实现在 `4bbada9` 中验证；本轮规范完善待验收。

## 职责与边界

服务端启动 Pi 子进程，维护会话、RPC、进程名额、运行状态、审批与交互。审批 ID 包含任务和进程代次，回复回到原 RPC ID，防止并行会话串线。过期进程的请求不带到新进程。

只读讨论以 ask / read_only 执行；实施在用户确认的轮次内推进，保留既有命令权限，新的外部副作用或产品语义由用户决定。完成说明不等于检查证据或人工验收。

Agent 默认连续承担沟通、规划、实施、复核、集成各阶段，只有明确要求委派或并行时才安排多个 Agent。规范来自用户指令、根和相关路径的 AGENTS.md、本轮上下文及确认的 PRD，不通过提示词笼统覆盖仓库规则。

## 源码与验证

- [进程监管](../../apps/server/src/pi/process-supervisor.ts)、[RPC](../../apps/server/src/pi/rpc-client.ts)、[任务入口](../../apps/server/src/tasks/task-service.ts)。
- [路径策略](../../apps/server/src/security/path-policy.ts)、[工作区文件边界](../../apps/server/src/tasks/workspace-files.ts)、[授权策略](../../packages/protocol/src/interaction-policy.ts)。
- 验证：[任务服务](../../tests/unit/task-service.test.ts)、[并行审批](../../tests/unit/parallel-approvals.test.ts)、[服务集成](../../tests/integration/agent.test.ts)。

规范详见 [Agent 工作流](../agents/workflow.md)、[职责](../agents/roles.md) 和 [验证方式](../project/verification.md)。

## 真实模型走查修订（已实施，待用户确认）

来源：[真实 DeepSeek 生命周期 PRD v1](../requirements/deepseek-lifecycle/PRD.md)，完成后提案见该需求 [runtime-and-design.md](../requirements/deepseek-lifecycle/modules/runtime-and-design.md)。问答、规划、审阅明确禁用任何命令并指向专用读取工具，与现有只读审批一致；兼容旧前缀的历史显示。向导复用来源感知凭据标签，环境密钥不再显示为已保存登录。没有放宽审批或路径根。

真实 Pi/DeepSeek 样例、独立 main 合入和主线检查见该需求生命周期；这是验证证据，不代表轻舟已验收或模块版本已确认。
