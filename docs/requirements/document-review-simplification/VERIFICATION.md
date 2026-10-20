# 验证记录

环境：macOS，本地仓库与隔离测试数据。以下为前一轮验证记录；当时未提交、推送或发版。2026-10-20 用户已另行授权提交、推送和发布，当前发布复核见末尾补充。

| 检查 | 本轮结果 | 证据 |
| --- | --- | --- |
| pnpm lint | 通过 | .qingzhou-test/ui-lint-last.log |
| pnpm typecheck | 通过；最后服务与 desktop 构建也包含类型检查 | .qingzhou-test/ui-typecheck-verified.log |
| pnpm test | 467 通过，3 平台限定跳过；归档失败恢复的补充断言所在 12 项也复跑通过 | .qingzhou-test/ui-unit-verified.log、ui-archive-snapshot-final-green.log |
| pnpm test:integration | 最终完整运行 86 通过、1 跳过；新增中断历史 / 合入重试 2 项也单独通过 | .qingzhou-test/ui-integration-confirmed.log、ui-merge-retry-error-green.log |
| 完整 E2E（包含 visual workbench） | 连续运行 50 项全部通过 | .qingzhou-test/ui-all-e2e-confirmed.log |
| pnpm build / desktop build | 通过；最后 server 与 desktop 已重建，现有大 chunk 提示仍存在 | .qingzhou-test/ui-all-e2e-confirmed.log、ui-server-final-build.log、ui-desktop-final-build.log |

## 新增行为回归

自定义目录立即写 MD、仅状态元数据、稳定绑定与重启读回；外部编辑保护及显式未确认同步；旧历史完整导入且不改 ID；占用路径与符号链接拒绝；写入中断回滚并保留外部字节；CAS 前精确恢复平台暂存；合入保留其他需求草稿并拒绝人工暂存；新模块初始基线安全推进；无效路径配置仍可读历史并可修复，未知清单字段保留；封存前拒绝外部 PRD 修改。

## 实际 Electron 证据与未覆盖项

真实 Pi 实施 7 项 Node 测试通过，交付封存成功；故意中断正在运行的检查，重启后准确记录 interrupted，未重放命令。实际数据与日志位于 `.qingzhou-test/document-flow/data/workflow.json`、`electron-review.log`、`interrupt-check.mjs`。项目、模块、PRD 和运行 ID 见实施记录与隔离数据。

2026-10-20 原生 Electron 已完成显式重新检查、隔离测试需求的逐项验收与 PRD 固化、候选检查和针对确切候选的行为复审。截图 66 为中断恢复状态，68 为重新检查通过；67 只拍到提交等待态，不作为检查运行中的证据。两个检查均实际执行 7 项 Node 测试，全部通过。

合入尝试被旧 Electron 主进程包拒绝，原目录和 Git 主线未覆盖。已核对初始模块、候选提案的精确字节均符合当前衔接规则，发现 desktop 的 00:21 构建没有对应逻辑；已重建并重启隔离 Electron。Mac 再次锁屏，重试合入及合入后重启持久化仍未完成。截图 69 捕获失败，不存在有效证据；浏览器与集成测试不能替代原生流程。当前实现仍待用户最终确认。

## 最终补充

生成的项目目录 / 工作流 / 需求导航说明已同步 Markdown 单入口与旧需求兼容规则；项目标准单测 4 项通过。历史回放排除工具与系统消息，完整记录保留折叠；用户目标沿用现有提炼函数，执行上下文可展开。新增页面断言验证执行指令默认收起。`git diff --check` 通过。

截图 49 / 50 / 54 / 55 已复核历史说明、单文件差异、对话与里程碑；56 / 57 复核项目设置和实际自定义目录。390px / 533px 无整页横向溢出，51 / 53 已检查浅深主题；52 是主题切换动画中的瞬间，不作为选中态证据。

向导合并重复主操作后的针对性 E2E 1 项通过，最终前端与服务端构建通过。

## 2026-10-20 继续验证

- 目录输入错误由“请求无法识别”改为字段和具体原因；17 项目录单测、1 项目录页面回归通过，实际截图 65 / 70 为修正前后。探测没有更改项目已保存的自定义目录。
- 最终 lint、typecheck 通过；单测在允许监听 localhost 后为 467 通过、3 平台限定跳过。受限运行的一个代理用例报 EPERM，不是逻辑失败，记录于 ui-unit-final.log；有效重跑见 ui-unit-final-network.log。
- 早期连续页面回归为 49 通过、1 会话清理超时。清理辅助函数原先只等待列表乐观删除，后续操作仍用动态的首行定位；现绑定具体会话 ID，并等待归档成功提示后继续。最终 ui-all-e2e-confirmed.log 连续 50 项全通过，包括 375px 鼠标 / 触屏、533px Electron 最小窗口以及桌面浅深主题。
- 同时复现了迟到快照将归档中会话重新插回侧栏的独立问题；快照现在与 task.updated 共用相同归档保护。隔离复制旧 store 的回归实际失败（ui-archive-snapshot-isolated-red.log），当前 12 项通过；另确认归档失败解除保护后，快照仍可恢复会话。该保护修正本身没有解释全部清理超时，未将两者混写为一个根因。
- 集成检查里程碑缺少设计关联在截图 72 复现；已补候选 / 源交付关联，优先显示所选检查或候选检查。截图 73 已确认实际 PRD 排版恢复，新增页面断言覆盖设计、候选变化与对话，完整回归通过。候选相对源交付的组合差异包含先合入的需求 B，断言使用 b.txt。
- 重启中断检查新增 verification.interrupted 事件，只记录一次，不重放检查；真实 Git 回归通过。合入重试成功后残留上次错误也已红 / 绿验证，开始重试时清除旧错误，新的同步警告仍保留。

| PRD 验收项 | 当前证据与剩余项 |
| --- | --- |
| 1 Markdown 阅读与窄屏 | 已检查 PRD / 模块 / 历史实际截图及浅深主题；浏览器回归覆盖 |
| 2 草稿与确认 | 单元和页面测试覆盖元数据变化、编辑保存、切换与失败保留；外部修改由集成测试覆盖 |
| 3 立即落盘与重启读取 | 自定义目录实际文件、状态元数据和 Electron 重启已核对 |
| 4 配置与失败保护 | 目录协议、字段错误、占用 / 越界 / 符号链接 / 中断回滚由单元和 Git 集成覆盖 |
| 5 旧文档导入 | 集成覆盖预览、历史 ID / 关联不变、冲突拒绝及旧交付兼容 |
| 6 完整合入与用户文件保护 | Git 集成覆盖；原生 Electron 最后合入仍待解锁验证 |
| 7 中断恢复与显式重试 | 原生检查中断后不重放、显式重跑已通过；保存 / 导入 / 合入衔接由集成覆盖 |
| 8 简化历史 | 实际阅读、单文件差异和对话已检查；集成检查节点关联已通过页面回归与截图 73 |
| 9 完整测试与真实需求 | lint / 类型 / 467 单测、86 集成与 50 页面回归通过；原生最后合入和重启检查仍待解锁 |

最终 desktop 包已重建并重启至隔离实例；最后一次原生读取仍为 Mac 锁屏，自动解锁因物理输入暂停。没有改写操作系统锁屏设置，也没有用浏览器操作替代原生最后步骤。


## 2026-10-20 发布前复核

基线：远端 v0.1.24（1b1e002）；原工作区 HEAD 为 4c1166a，已有任务改动完整保留。深度复核包含安全、架构及假设、组合、有效操作序列、重复与并发四个角度；高风险问题另做独立反证。共确认并修正 13 类问题，详细实现见实施记录。

- 首批 7 项回归已实际复现失败并修复通过，另补已跟踪草稿的有效失败证据；日志 release-review-red.log、release-review-draft-red.log、release-review-green.log。
- 已导入旧模块提交后的完整实施至合入回归，修复前失败、修复后通过；release-import-module-red.log、release-import-module-green.log。
- 外部模块正文限长、完整绑定路径与其他需求快照 3 项回归实际失败，修复后与结构化提案共同 4 项通过；release-review-second-red.log、release-review-second-green.log。
- 结构化提案的序列化在隔离工作区替换旧序列化器后，明确失败于 proposals[0].moduleChanges[0].content 缺失；恢复修复版后通过。有效红 / 绿证据为隔离工作区 release-serializer-isolated-red.log、release-serializer-isolated-green.log。早期尝试受协议导出缺失和没有触发状态保存影响，不作为有效红灯证据。
- 完整浏览器需求流程实际复现合入节点错误显示 b.txt；修复后断言合入记录显示 a.txt、不包含 b.txt，并保留检查节点 b.txt，1 项完整流程通过；release-history-red.log、release-history-green.log。

隔离工作区：`/Users/yunz/.codex/worktrees/release-v0-1-25/MyPi`，使用独立锁文件安装与构建，基于远端最新提交应用本轮全部源码与新文件。完整测试和发布结果仍在补齐；Electron 最后合入与重启检查仍被 Mac 锁屏阻挡，不能以浏览器结果替代。


最后的同路径索引竞争改用私有索引准备，再持有 Git index.lock 并核对原索引全部字节后原子发布。恢复撤销暂存复用同一流程；不同路径、同路径并发暂存和外部锁都保留。对应新增两项回归，旧实现均实际失败，修复后在隔离工作区复测。此前捕获树校验仅阻止异路径暂存，不能作为同路径安全的证据。


## 最终隔离结果与发布边界

| 检查 | 实际结果 | 隔离日志 |
| --- | --- | --- |
| lint / typecheck | 均通过 | release-final-lint.log、release-final-typecheck.log |
| 单测 | 471 通过，3 项平台限定跳过 | release-final-unit.log |
| 集成 | 完整 100 通过、1 跳过；补回远端 Windows 长路径用例后单独 1 项通过 | release-final-integration.log、release-upstream-long-path-green.log |
| 完整页面回归 | 最后再次 50 项全部通过，含 visual workbench | release-final-e2e.log |
| 索引保护专项 | 同路径 / 异路径 / 外部锁 / 恢复与正常衔接共 6 项通过 | release-index-lock-green.log |
| v0.1.25 桌面构建 | pack:dir 通过；五处版本一致 | release-pack-dir-proxy.log |
| 应用包检查 | ASAR 219 个条目，主进程与构建输出字节一致；新文档保护、web、Pi 与搜索工具齐全，未混入本地数据；fd / rg 均为 arm64 | 实际包 apps/desktop/release/mac-arm64/Qingzhou.app |
| 实际包运行 | 独立数据和配置启动成功，health.ok=true，Pi 1.3.0 无错误，前端 HTTP 200；fd 10.2.0、rg 14.1.1 可执行 | package-smoke/runtime.log |

完整回归后核对 72 个任务文件，原目录与隔离候选的代码差异仅为待合并的远端 Windows 修复；这些修复及对应测试保留，不用旧本地版本覆盖。

GitHub 已改用核实后的 Qingzhou HTTPS 远端，并为本仓库 GitHub 访问配置现有本机代理，普通 ls-remote 成功。用户已授权提交、推送和正式发布；v0.1.25 发布说明与应用目录已准备。最后提交和 CI 以 Git / GitHub 记录为准。

隔离原生 Electron 已重建并重启，PID 80568，保留原待合入候选；Mac 仍锁屏。实际包启动 smoke 只证明安装包运行与资源，不替代 PRD 要求的原生合入和重启阅读流程。该流程完成前不创建 v0.1.25 正式标签，不宣称已发布。
