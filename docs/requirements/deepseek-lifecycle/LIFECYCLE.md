# 真实样例生命周期

2026-11-04，使用 productize-app 的完整主路径与风险验证配方。界面操作通过实际浏览器完成；状态和 Git 回读用于核对，没有手改确认、验收、固化或合入字段。此文仅记录独立样例，轻舟修复仍待用户确认。

## 环境与模型

- 轻舟：当前工作树源码，独立数据目录 `.qingzhou-test/deepseek-lifecycle/data`，服务 `http://127.0.0.1:4314`。
- Pi：复用现有官方包 `@earendil-works/pi-coding-agent` 1.3.0，不安装新浏览器或模型代理。
- 凭据：已有进程环境 `DEEPSEEK_API_KEY`，未复制或打印密钥。实际提供方 `deepseek`，模型 `deepseek-flash`；官方 `/models` 鉴权请求返回 HTTP 200，真实会话记录显示同一 provider/model。
- 官方接口依据：[DeepSeek API 文档](https://api-docs.deepseek.com/zh-cn/)、[模型列表接口](https://api-docs.deepseek.com/api/list-models/)。实际请求目的地为 `https://api.deepseek.com`。
- 会话 `a59cb7ed-d877-4fa1-8155-cfe3cb13c291`，114 条带正数用量的助手响应；记录 input 53,602、output 64,562、cacheRead 7,235,456、totalTokens 7,353,620。这是含缓存的会话用量，不能当作账单或独立请求计数。

## 样例与版本

“今天：极简待办工具”只保留标题、输入与添加、三种筛选、任务行、剩余数量和必要错误提示。无框架、后端、账户或外部服务。操作包含 Enter/按钮添加、空白拒绝、完成/恢复、筛选、删除、刷新恢复、文本安全、故障提示和 390px 布局。

| 对象 | 实际记录 |
| --- | --- |
| 项目 | `b73656f7-0e06-4923-ba4a-aaf3373cbcbb` |
| 需求 | `32980698-cd42-4ca4-a663-5fd31965b1a2` |
| 范围 v1 | `9f0d9c84-eb62-4fe9-bd6c-2b06669acd1c` |
| PRD v1 | `d940b385-4bbc-4c51-9456-7e8b64c5a6ec` |
| 样例代码基线 | `4a2422f34785590ce4b7ebcdc555e04089fe93d1` |
| 封存交付 | `21004467-b567-4221-b0b6-25c61ff76b5a`，commit `0a3369fe94bcdb4866dee1e0ea9f3d5b2b3ebdfd` |
| 样例验收 | `b396a92b-b9ac-4005-96f2-613402f86053`，五项证据逐条登记 |
| 候选与实际合入 | `9e7d66b2-38c9-4a2f-9a77-d369349ad6f7`，commit `bed777c9313ff650d63309f82d4d61b1c299219d` |
| 交付、候选和主线 tree | `26523b2826238449482babfd589efd28dc43cf2b`，候选相对交付无文件差异 |

## 实际经过

1. 创建独立 Git 项目并配置 main、真实检查 `npm run check && npm test`，创建具体需求及五条验收标准。
2. 只读讨论 `5f1e4b44-1a76-4c45-ae0a-1b1ca5fa2ee8` 暴露工具提示和提案识别问题。修复应用后，讨论 `3c9b673f-f197-4d20-a7a4-b411f627f5bc` 提交规范提案；明确损坏备份、失败重试、完成样式、筛选重置、200 字上限等取舍。
3. 在 UI 采用为草稿，分别确认范围和 PRD v1，未以“采用提案”代替确认。确认后真实执行 `1adceaf8-db0a-4a28-ab89-e39ef59ce903`。
4. 实施中发现永久写入阻断和重绘焦点丢失，反馈给同一真实 Agent 修复并补测试；通过实际浏览器走查存储失败与恢复。后续反馈执行 `33ec5c50-d625-4041-891e-23991a3d50fc` 只修正文弱对比度。
5. 审阅 28 个已归属变更文件并封存。交付版本独立执行 56 项检查，填写五项样例验收证据，点击验收并固化 PRD。
6. 准备候选，候选重新执行 56 项检查；核对精确 commit、tree、差异及语义后保存复审，勾选已复审并确认合入 main。
7. UI 显示“已合入”，Git main 指向候选 commit 且工作区干净；平台主线检查再次 56/56 通过。重载后历史继续保留范围确认、PRD 确认、封存、两次检查、验收和合入节点。
8. 最终预览 `http://127.0.0.1:4315/` 改为服务已合入的样例 main；刷新恢复此前任务，最终样式和真实 390px 视口再次核对。

全部四轮模型执行 succeeded。样例没有模块，不伪造模块版本；同模块并发、旧文档兼容、精确绑定等分支由仓库集成回归覆盖。

## 可核对证据

运行数据与原始日志保留在忽略目录，不提交个人运行资料：

- `data/work-items.json`、`data/workflow.json`、`data/workflow-transcripts/`：真实运行、提案、版本、确认与集成。
- `data/sessions/a59cb7ed-d877-4fa1-8155-cfe3cb13c291/*.jsonl`：真实 provider/model、工具执行和响应 usage。
- `logs/lifecycle-evidence.json`、`model-usage.json`：只选取必要字段的核对摘要；`probes/collect-evidence.mjs` 可从原始状态重建。
- `logs/proposal-after.json`：同一原始讨论中，合法提案从 null → 完整解析；坏 JSON 仍被拒绝。没有把后者记录为成功。
- `screenshots/10-acceptance-56-tests.png`、`11-candidate-reviewed.png`、`12-merged-history.png`：样例验收、确切候选复审、重开后的合入历史。
- `screenshots/13-final-sample-desktop.png`、`14-final-sample-mobile.png`：最终主线页面。

交付检查 `7ff88ce7-0f40-4347-b35f-fdfdd094696b`、候选检查 `d1651d23-af01-4060-926a-844b7f8f8bcb`、主线检查 `82821425-76ee-47f2-9bb3-d3a30313edbc` 均 exit 0，56 pass、0 fail、0 skipped。检查输出保留在 workflow.json 的各自 verification 内，不把 Agent 口头完成声明当作结果。
