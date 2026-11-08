# 验证记录

状态：轻舟修复已自测；独立真实样例已完成闭环；待用户最终确认。源码精确内容见 [SOURCE-MANIFEST.md](SOURCE-MANIFEST.md)。2026-11-04，macOS arm64 / Node 22.22.0。

## 轻舟自动检查

所有日志位于 `.qingzhou-test/deepseek-lifecycle/logs/`。

| 检查 | 实际结果 | 日志 |
| --- | --- | --- |
| 新增协议回归，修复前 | 3 failed / 9 passed，证明旧提案边界和只读提示问题 | `regression-red.log` |
| 环境凭据向导 E2E，修复前 | 1 failed，收到 env 却未显示环境来源 | `setup-red.log` |
| 修复后协议、交互策略和凭据标签定向单测 | 19 passed | `regression-green.log` |
| `pnpm lint` | exit 0 | `lint.log` |
| `pnpm typecheck` | protocol/server/web/desktop 全部通过 | `typecheck.log` |
| `pnpm test` | 489 passed / 3 Windows-only skipped，94 文件通过 / 1 跳过 | `unit.log` |
| 工作流与运行时集成，默认 20s 单用例上限 | 80 项中 63 passed / 17 timeout；无断言失败，不记为完整绿灯 | `workflow-integration.log` |
| 上述 17 项逐项重验，CLI `--testTimeout 60000` | 17 passed / 61 unselected skipped；未修改仓库默认超时 | `workflow-integration-recheck.log`、`timed-out-tests.txt` |
| 最终相关 E2E | 6 passed；包含生产构建，exit 0 | `ui-final.log` |
| `git diff --check` | 通过 | 最终终端结果 |
| 文档与证据复核 | 本需求本地链接有效、29 个源码 hash 与清单一致；选取摘要无 API 密钥；样例交付与最终 main 无文件差异 | 最终终端结果 |

集成实际命令为 `pnpm exec vitest run --config vitest.integration.config.ts tests/integration/workflow.test.ts tests/integration/workflow-runtime.test.ts`；重验以 `-t` 匹配日志中的 17 个用例并提高 CLI 超时。80 个用例均已有通过记录，但没有宣称“单次全套 80/80 通过”。

最终 E2E 命令：`pnpm test:e2e --grep 'setup distinguishes|structured discussion proposals|requirement workspace preserves|conversation conversion|compact project controls|settings groups retain'`。覆盖环境密钥来源、结构化提案采用但不确认、PRD 草稿跨页保留与键盘导航、转需求原处建项目、紧凑筛选与队列恢复、设置输入及主题窄窗。构建只有既有大 chunk 提示，无新增构建错误。

前述 Vitest / Playwright 使用仓库模拟 Pi 以保证稳定复现；它们不充当真实 DeepSeek 证据。此前 UI 改版完整 E2E 的历史结果仍见父需求，不覆盖其快照。

## 真实模型与样例检查

真实调用、执行与 Git 证据见 [LIFECYCLE.md](LIFECYCLE.md)。Pi 1.3.0 使用已有环境密钥直连官方 DeepSeek，四轮真实执行成功。封存、候选和合入主线各自执行 `npm run check && npm test`，均为 56 pass / 0 fail / 0 skipped，分别绑定确切 commit/tree。

样例回归额外对比实际修改前检查点 `mw0xefj7-d0vpw5` 与最终 app：`sample-regression-red.log` 在焦点和保存重试上出现 6 条断言失败；`sample-regression-green.log` 同一探针全部通过。探针只在忽略目录复制源码，处理缺失存储值为失败断言以便列出全部错误，没有改写封存交付或原始检查点。

## 实际浏览器走查

通过 CUA 驱动真实页面；无额外浏览器安装。正常样例使用 4315，故障注入使用独立 4316 origin，避免污染正常列表。

| 操作 | 观察 |
| --- | --- |
| Enter 和按钮添加、空白提交 | 两种添加路径一致，空白不新增；添加后输入框可继续输入 |
| 完成/恢复、三种筛选、删除 | 行状态、显示子集、剩余数量正确；重绘后焦点回到同一复选框或筛选，删除后回输入框 |
| 刷新恢复及安全文本 | 任务/完成状态恢复，筛选回全部；HTML 标签按字面显示，没有注入元素 |
| 首次保存抛错，下一次恢复 | 首次明确未保存，内存任务继续可用；下一次操作保存两项并清除提示，刷新恢复。截图 04、05 |
| 损坏载荷且备份写入失败 | 常驻仅本次会话提示；继续添加不覆盖原值；检查页读到原坏 JSON、backup=null。截图 06、07 |
| 最终文字样式 | 完成项与辅助文字 `rgb(116,107,98)`；画布 4.89:1；完成项删除线保留。截图 13 |
| 最终 390×844 视口 | innerWidth=390、scrollWidth=390，无整页横向溢出；已重置临时视口。截图 14 |
| 样例合入与重新打开 | UI 已合入、历史节点完整，Git main 与候选一致且干净；4315 最终服务 main。截图 12 |
| 轻舟提案简化 | 两条有效历史提案显示短标题；原因/全文/原始回复均默认折叠，三个 details 无 open；待答问题可见 |

## 限制

本次不是所有服务集成文件的全量回归；未重新打包、安装或发布桌面版，未在 Windows/macOS x64 真机验证。真实样例覆盖一条完整主路径与明确失败分支，不代表任何模型回复格式都可自动采用。无效 JSON 继续明确拒绝；未绕开权限或确认解决阻挡。

样例平台验收为授权走查步骤；轻舟产品改动尚未提交、合入或得到用户最终验收。
