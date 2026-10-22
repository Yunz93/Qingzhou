# 验证记录

状态：本轮实施与相关自测已完成，用户已明确授权合并。日期：2026-10-22，Linux / Node 24.19.0 / Chromium。此记录不替代平台验收或固化状态。

## 视觉来源

- YiMu：`21f7e9d9e80ddd0e6464849fed1cecdb61990776` 的 `docs/preview.png` 和 `dist/styles.css`。
- 浏览器插件连接在本轮未提供；使用仓库已有 Playwright 流程生成真实页面截图与交互证据，不声称完成插件独立审计。

## v2 对话阅读：本次结果

验证代码：`f448319` 加本需求的视觉与阅读改动；工作目录：`/workspace/qingzhou`。合入前已确认远端主线仍为同一基线，源码未再修改，仅同步授权和模块文档。

| 检查 | 实际结果 |
| --- | --- |
| 旧实现复现 | 新增用例在生成中未找到 Markdown 标题，按预期失败；保留改前流式与完成截图 |
| `pnpm lint`、`git diff --check` | 通过 |
| `pnpm typecheck` | protocol、server、web、desktop 通过 |
| `pnpm test` | 486 通过，3 个 Windows 专用用例在 Linux 跳过 |
| `pnpm test:e2e tests/e2e/conversation-rendering.spec.ts` | 2 通过；生成中标题、未闭合代码、安全链接 / HTML、代码复制、手机溢出及异步失败展开均通过 |
| `pnpm test:e2e` | 一次完整运行 56 / 56 通过（3.9 分钟），包括新增 2 项及全部既有用例 |
| E2E 自动执行的 `pnpm build` | 生产构建通过；保留已有 bundle 大小提示 |

完整浏览器回归还覆盖复制回复、搜索、生成中向上滚动、草稿、重连、媒体、工作模式内嵌对话、PRD 阅读编辑、交付及验收流程。未改服务端与协议，本次未额外运行集成套件。

日志：`/workspace/scratch/qingzhou-conversation-before.log`、`qingzhou-conversation-after.log`、`qingzhou-conversation-unit.log`、`qingzhou-conversation-e2e.log`。

截图位于 `/workspace/artifacts/conversation-reading/before/` 与 `after/`：

- `conversation-streaming.png`：相同合成内容在生成过程中的改前 / 改后排版。
- `conversation-desktop.png`：完成后标题、段落、代码与引用的改前 / 改后层次。
- 改后的 `conversation-533.png`、`conversation-375.png`、`conversation-dark.png`：手机、长路径、局部代码滚动与深色效果。

延后更新与生成阶段跳过高亮已实现，但未进行输入延迟基准测试。浏览器测试使用合成 Pi 事件，不代表真实模型质量、超长会话性能或原生桌面体验已验证。

## v1 风格改造：历史结果

以下保留首轮实施与修复过程；本次 v2 的完整 56 项结果已覆盖这些原有用例。

### 命令与结果

| 检查 | 实际结果 |
| --- | --- |
| `pnpm lint`、`git diff --check` | 最终改动通过 |
| `pnpm typecheck` | protocol、server、web、desktop 通过 |
| `pnpm test` | 486 通过，3 个 Windows 专用用例在 Linux 跳过 |
| E2E 中自动执行的 `pnpm build` | 生产构建通过；保留已有的 bundle 大小提示 |
| 改前与改后的 `visual workbench at required viewports` | 均通过；覆盖四档浅深色、触屏、横向溢出与顶栏遮挡 |
| `pnpm test:e2e` | 初轮 54 项中 52 项通过，2 项未通过，原因和补验见下文 |
| `pnpm test:e2e -g 'theme preference\|four requirement tabs\|visual workbench\|popover Esc\|settings fits narrow'` | 4 项通过；主题用例的最后一段焦点检查等待前提不足，再作补验 |
| `pnpm test:e2e tests/e2e/visual-theme.spec.ts` | 修正等待前提后通过；浅深色、持久化、主题背景 / meta、对比度及键盘焦点均通过 |

完整套件与关联补验覆盖了全部 54 个不同 E2E 用例；没有把分批结果表述为一次完整套件 54/54 通过。未修改服务端与协议，本轮未额外运行集成套件。

### 失败与处理

1. Node 24 默认输出 `✔`、`ℹ pass` 等 spec 格式，原验收证据用例配置 `node --test`，却断言 TAP 汇总。测试命令改为 `node --test --test-reporter=tap sample.test.cjs`；真实运行检查、用例数量、逐条验收和差异审阅断言均保留，补验通过。
2. 新增对比度检查最初把透明背景当成黑色，导致错误比值。现按实际有填充的祖先背景取色，并等待颜色过渡稳定，仍要求正常文字至少 4.5:1。深浅色主按钮和两种模式控件均通过。
3. 新主题测试在创建请求结束前就尝试移动背后的焦点，受到正常模态焦点约束。补充等待创建弹窗关闭、当前对话标题与就绪状态后，再使用键盘测试工具按钮；独立焦点轮廓通过，未绕过焦点约束。

### 视觉证据

改前：`/workspace/artifacts/yimu-refresh/before/`。改后：`/workspace/artifacts/yimu-refresh/after/`。完整首轮回归与重点补验截图分别保存在同目录下的 `regression/` 与 `focused/`。

- `viewport-1440-light.png`、`viewport-1280-dark.png`、`viewport-533-light.png`、`viewport-375-dark.png`、`viewport-375-touch.png`：相同视口的改前 / 改后对照。
- `home-light.png`、`home-dark.png`：独立测试数据下的真实空首页。
- `composer-keyboard-focus.png`：输入区域与“模式”按钮的独立键盘轮廓。
- `v3-design-light.png`、`v3-design-dark.png`：PRD 阅读与编辑入口。
- `acceptance-split-desktop.png`、`acceptance-split-390.png`、`acceptance-split-533.png`：验收、检查数量与代码差异在桌面和手机的呈现。

静态颜色复核：浅色主按钮约 6.47:1；深色主按钮约 8.13:1；浅色辅助文字在纸白 / 侧栏 / 浅绿 / 强填充上分别约 5.25 / 4.96 / 4.83 / 4.61:1。此记录不等同于全应用无障碍审计。

## 边界

- 浏览器业务由 fake Pi 驱动，未调用真实模型。
- 未运行原生 macOS / Windows 桌面；窗口交通灯通过既有模拟用例验证，Electron 源码通过类型检查。
- 中文宋体取决于操作系统本地字体，未引入远程字体或生成插画。
- 用户已明确授权本轮 Git 合并；实际提交与远端状态以 Git 为准。不生成平台验收、PRD 固化或发版记录。

## v0.1.27 本地发版检查

用户在合并后另行明确授权“发布新版本”。以 `122f3b6` 为源码基线，仅同步五个包的版本、更新日志、标签示例和本节记录。

| 检查 | 实际结果 |
| --- | --- |
| `pnpm exec tsx scripts/verify-release-version.ts v0.1.27` | 五个包的正式版本与标签一致 |
| `pnpm lint` | 通过 |
| `pnpm typecheck` | protocol、server、web、desktop 通过 |
| `pnpm test` | 486 通过，3 个 Windows 专用用例在 Linux 跳过 |
| `pnpm test:integration` | 101 通过，1 个 Windows 安装子进程专用用例在 Linux 跳过，共 5 个文件通过 |

日志位于 `/workspace/scratch/qingzhou-v0.1.27-{lint,typecheck,unit,integration}.log`。本次没有产品源码变化，沿用前述完整 56 项浏览器结果及 `122f3b6` 已通过的远端 CI，不额外重复本地 E2E。

原生 macOS arm64、macOS x64 与 Windows x64 的检查及打包由正式标签触发的 Release 工作流执行；真实状态以 [Actions](https://github.com/Yunz93/Qingzhou/actions/workflows/release.yml) 和 [v0.1.27 Release](https://github.com/Yunz93/Qingzhou/releases/tag/v0.1.27) 为准，本文不提前声明原生打包或发布成功。

后续结果：`v0.1.27` [发布工作流](https://github.com/Yunz93/Qingzhou/actions/runs/39806202291)已取消，未创建正式 Release。浏览器检查发现并复现了模式 / 审批的回写问题，修复后改用 `v0.1.28` 发布，实际验证见[关联修复记录](../policy-acknowledgement/VERIFICATION.md)。
