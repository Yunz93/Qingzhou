# 验证记录

日期：2026-11-08，macOS arm64 / Node 22.22.0。PRD v1 已实施并自测，待用户确认。源码和测试的精确内容见 [SOURCE-MANIFEST.md](SOURCE-MANIFEST.md)。

## 检查结果

日志根目录为 .qingzhou-test/productize-refactor/logs。没有安装新依赖或再次运行模型生成；下表均为本轮实际结果。

| 检查 | 实际结果 | 日志 |
| --- | --- | --- |
| 损坏草稿修复前 E2E | 1 failed，旧编辑器不能继续或显示恢复入口 | draft-red.log |
| 第一批草稿规则与浏览器回归 | 9 unit passed；3 E2E passed | draft-unit.log、draft-e2e.log |
| pnpm lint | exit 0，末次新增用例后复查通过 | lint.log、final-lint.log |
| pnpm typecheck | protocol/server/web/desktop 通过 | typecheck.log |
| pnpm test | 499 passed / 3 Windows-only skipped | unit.log |
| 工作流与运行时集成 | 80 passed，单次完整通过，165.98s | integration.log |
| 完整界面回归（排除 visual workbench） | 59 passed，4.7min | e2e.log |
| 末次空字符串草稿边界 | 9 unit passed | empty-draft-unit.log |
| 末次浏览器补验 | 4 passed，30.6s，含重新构建 | final-e2e.log |
| 重建服务读取真实历史 | 协议校验通过，冻结 PRD、已合入候选与原检查完整，仍为 4 轮真实执行 | history-readback.json |
| 文档、源文件与 diff | 协议正文限制、本地链接、源码 hash 和 git diff --check 已复核 | 本轮终端及 SOURCE-MANIFEST.md |

完整 E2E 命令为 pnpm test:e2e --grep-invert 'visual workbench'。集成命令为 pnpm exec vitest run --config vitest.integration.config.ts tests/integration/workflow.test.ts tests/integration/workflow-runtime.test.ts --testTimeout 60000。依据上轮已记录的本机耗时方差，本轮使用 CLI 60s 上限，仓库默认超时不变。

完整检查后自复核补充空字符串草稿拒绝，并增加迟到项目响应用例。末次执行 pnpm exec vitest run --config vitest.unit.config.ts tests/unit/prd-draft.test.ts，以及 pnpm test:e2e --grep 'corrupt PRD drafts|PRD saves reject duplicate|reopening design follows|late project responses'。这 4 项包括前面已覆盖的用例，不加成新的一套“63 项 E2E”。完整 59 项与末次补验的源码差异和时序见源码清单。

首次补验有 2 处测试操作/定位问题：窄屏需先切换到“需求与交付”，需求标题同时存在 h2 与正文 h1。按真实页面修正操作和标题级别后 4 项重验通过；该轮没有改产品源码。原失败输出保留为 final-e2e-initial.log，不冒充产品缺陷或删掉失败记录。

## 关键行为证据

- JSON null、数组、缺字段、坏模块和空字符串不会变成可使用的草稿。原始值保持，下载内容逐字一致；备份失败不能重建，恢复存储后备份读回成功才能继续。已有不同恢复副本不覆盖。
- 保存挂起期间继续输入正文与原因，回执后新输入保留；同帧三次提交只发一次请求。失败显示错误、保留草稿，后续提交可成功。
- A 项目请求挂起后选择 B，再返回 A 的成功或错误，B 的需求及工作区保持，旧错误不显示；不是只检查 helper 的调用次数。
- 原有完整闭环回归通过：独立需求乱序合入、自动验证停在人为验收前、PRD 与模块迭代、准确版本与候选失效、历史回放、文档保护、队列和中断恢复。
- 检查进程使用真实 Node 子进程，核对工作目录/环境、非零退出、输出脱敏与上限、超时后恢复、启动失败及 POSIX 子孙进程组清理。5 项新增进程用例通过。
- 新建草稿恢复区域使用既有主题和控件，无新增页面。390×844 视口能切至审阅并完成恢复，整页无横向溢出。

截图在 .qingzhou-test/productize-refactor/screenshots：project-list.png、workflow-desktop.png、workflow-mobile.png、module-changes-light.png、module-changes-dark.png、draft-recovery-0.png、draft-recovery-mobile.png 等。已实际查看代表性桌面与窄屏恢复截图；截图来源为真实 Chromium E2E，不是生成图片。

## 旧数据与真实模型边界

已有真实 DeepSeek 样例只进行只读回读。重建后的 4314 服务通过实际带会话的 WebSocket workflow.state 返回并通过协议校验：PRD d940b385-4bbc-4c51-9456-7e8b64c5a6ec 仍固化，正文可读；合入仍为 bed777c9313ff650d63309f82d4d61b1c299219d；历史交付、候选与主线检查记录通过，事件 35 条、原执行 4 轮。样例 Git main/tree 保持原值；没有修改其验收和固化事实，也没有重新执行旧检查。

本轮自动化使用仓库 fake Pi，证明交互和编排，不证明真实模型的理解质量。上轮真实 DeepSeek 证据仍见 [deepseek-lifecycle](../deepseek-lifecycle/LIFECYCLE.md)，不把旧结果当成本轮新调用。

## 限制与状态

CUA 返回电脑锁屏、浏览器控制关闭，无法进行交互式原生窗口走查。Chromium E2E 不能替代 Electron 原生窗口验收。未重打安装包、替换安装版、发布或验证 Windows/macOS x64 真机；没有以这些限制伪造通过。

服务集成限于本次相关的 workflow 与 workflow-runtime 两个文件，不宣称所有服务集成文件通过。用户最终验收和主仓库合入尚未发生；当前工作区未提交，等待用户确认。
