# 验证记录

2026-10-21（Asia/Shanghai）。当前需求 PRD v4，实施及自测已完成，待用户验收。先保留 v2、v3 复核记录，v4 本轮结果见文末。下列结果不替代平台确认、人工验收或合入事实。

## 代码与环境

- 工作目录：`/Users/yunz/Code/VibeCoding/MyPi`，HEAD `c7211cd4ad0168e11e6b11df979192831f591655` 加本轮未提交修改。
- 最终源码与测试共 21 个变更文件，按路径排序、以 NUL 分隔路径及内容计算 SHA-256：`5fd4b59034832964a48047874d6c3d3b38f8b3ab2aa9dbcffb652ae17d6d80e3`。该摘要不包含文档和构建输出。
- macOS；使用项目配置的 Node / pnpm 与 Chromium，服务来自 Playwright 构建的生产 web/server。协议先构建，随后接入 web。

## 实际命令与结果

| 命令 | 实际结果 |
| --- | --- |
| `pnpm --filter @qingzhou/protocol build` | 通过，含路径元信息与转义解析 |
| `pnpm lint` | 最终通过 |
| `pnpm typecheck` | 最终通过，protocol / server / web / desktop |
| `pnpm test` | 481 项通过、3 项 Windows 安装用例在 macOS 跳过 |
| `pnpm exec vitest run --config vitest.unit.config.ts tests/unit/prd-draft.test.ts` | 最后补充缓存逻辑后，4/4 通过；全量单测后新增的 1 项亦通过 |
| `pnpm exec vitest run --config vitest.integration.config.ts tests/integration/workflow.test.ts` | 78/78 真实 Git 集成通过 |
| `pnpm exec playwright test tests/e2e/project-workflow.spec.ts` | 14/14 通过 |
| `pnpm exec playwright test tests/e2e/project-workflow.spec.ts --grep 'reopening design|four requirement tabs|PRDs iterate'` | 最后补充缓存逻辑后 3/3 通过，包含新增第 15 项独立界面用例及两个已有流程复跑 |
| Playwright 前置 `pnpm build` | 最终通过；保留现有大于 500 kB chunk 提示，未新增依赖 |
| `git diff --check` | 通过 |

第一次定向单测误把文件参数放到 `--` 之后，实际执行全量；代理用例因沙箱拒绝监听本地端口而失败。允许本地测试端口后该用例及全量通过。首轮页面失败来自旧入口断言和新夹具内容；后续还修正了新建范围确认的测试等待竞态、折叠范围导航，最终结果如上，没有以失败轮次充当通过证据。

## 行为证据

- 单测覆盖替换行对齐、空侧新增/删除、多片段真实行号、正文中类似 hunk 的文本、中文 Git 八进制路径、重命名、模式变化、字面反斜杠、分层历史去重和事件顺序。
- 验收逻辑区分真实检查状态与用例计数：完整单一 Node TAP / Vitest / Jest 摘要可显示，截断、未结束、多个摘要和未知结果不冒充用例通过。
- 页面回归完整经过真实临时 Git 的封存、检查、人工验收、固化、候选复审与合入；项目历史只含项目与合入事件，单条列表的关键/全部筛选可用，合入文件差异沿用准确基线。
- 新四页签用例实际运行 `node --test sample.test.cjs`，核对 1 项用例通过、测试文件差异和右侧新增内容；fake Pi 的 WRITE 附带执行上下文，因此测试在封存前写入准确的 Node 测试夹具，不将 fake Pi 回复当作测试结果。
- 设计草稿切换页签不丢失；未保存 PRD 阻止验收；固化后无编辑入口。文档读回跟随新版本；关闭后重新打开时，无修改的旧缓存更新到最新 PRD，真正编辑过的旧草稿保留并显示冲突。
- 检查桌面、533px 与 390px，无整页横向溢出；分屏在自身区域横向滚动。已查看最终浅色、深色、窄屏及固化设计截图。界面沿用原主题与排版，没有引入新视觉系统。

## 截图与限制

最终截图保存在 `.qingzhou-test/history-and-split-diff/`：`acceptance-split-desktop.png`、`acceptance-split-dark.png`、`acceptance-split-533.png`、`acceptance-split-390.png`、`frozen-prd-history.png`。该目录为本地测试证据，不作为平台验收记录。

本轮浏览器回归验证了工作流主线、设计、交付、验收和历史；审批与 Git 详情共用的分屏核心通过解析与行模型回归，但未逐项在 Electron 原生窗口现场操作，也未验证真实模型理解。未新增通用的逐用例结构化结果协议；未提供可靠摘要的检查继续显示真实检查状态和日志。未执行原生安装、提交、推送或发版，用户验收待确认。

## v3 结构实施复核

用户明确同意 STRUCTURE-v3.md 后，完成四页签结构修改。当前 HEAD 仍为 `c7211cd4ad0168e11e6b11df979192831f591655`，加本轮未提交修改；23 个源码与测试变更文件按前述路径、内容及 NUL 分隔规则计算 SHA-256：`378e37a11cdaf4022a491f0c35842b93a5b28e99de733ed6019869a829eb5edb`。

| 命令 | v3 实际结果 |
| --- | --- |
| `pnpm lint` | 通过，最终窄屏断言补充后再次通过 |
| `pnpm typecheck` | 通过，protocol / server / web / desktop |
| `pnpm test` | 484 项通过，3 项 Windows 安装用例在 macOS 跳过 |
| `pnpm exec vitest run --config vitest.unit.config.ts tests/unit/test-evidence.test.ts tests/unit/split-diff.test.ts tests/unit/diff.test.ts tests/unit/prd-draft.test.ts tests/unit/history-projection.test.ts` | 21/21 通过 |
| `pnpm exec playwright test tests/e2e/project-workflow.spec.ts` | 15/15 通过，3.8 分钟 |
| `pnpm exec playwright test tests/e2e/project-workflow.spec.ts --grep 'four requirement tabs'` | 最后修复窄屏裁切并增加边界断言后，1/1 通过 |
| Playwright 前置 protocol / web / server 生产构建 | 通过，保留原有大 chunk 提示，无新增依赖 |
| `pnpm --filter @qingzhou/desktop build` | 通过，当前源码构建 main / preload |

页面回归涵盖真实 Git 封存、检查、逐条验收、PRD 固化、候选复审、最终合入，以及设置弹窗、关闭后焦点恢复、键盘、分栏调整、草稿保留和 Markdown 读回。新版四页签回归实际执行 Node 测试，检查第一版 1/1 与第二版 2/2 结果，旧版只读，点击用例跳转准确交付文件。验收页没有源码 diff，交付页左右内容和真实行号可见。

完整回归初轮有三个测试适配失败：设置关闭后未切回设计的旧入口、检查统计被拆为语义元素后的字符串空格、文档路径迁入设置后仍读取原位置。修正后完整 15/15 通过；未删减其业务断言。截图另发现长文件路径与 390px 底部裁切，分别改为文件名和所属目录、文件区独立滚动，并修复 flex 子区最小高度；最后四页签复跑核对 533px 和 390px 的底部边界及无整页横向溢出。

最新生产前端截图保存在 `.qingzhou-test/history-and-split-diff/actual-v3/`，已逐页查看四个深色页签、浅色设计和交付，以及 390px 验收。截图来自隔离测试项目、实际生产构建与真实 Node 检查；fake Pi 仅提供执行夹具，截图中的 WRITE 文本是该夹具需求正文，不是正式产品占位内容。未验证真实模型理解。

四页截图：`v3-design-dark.png`、`v3-delivery-dark.png`、`v3-acceptance-dark.png`、`v3-history-dark.png`；浅色为 `v3-design-light.png`、`v3-delivery-light.png`；窄屏为 `acceptance-split-533.png`、`acceptance-split-390.png`。不把本地截图或自测声明为用户验收。

### Electron 实际窗口补充

使用当前 `pnpm --filter @qingzhou/desktop build` 产物，在隔离的 e2e 数据、独立 Electron profile 和本地服务中启动原生窗口；原生标记为 `desktop: true, platform: darwin`。实际内容尺寸为 1440×770、533×770、1440×600、533×600，四页签各检查一次，共 16 次，底部操作在视口内、整页无横向溢出。请求的 1000px 高度由 macOS 当前工作区限制为 770px，未将请求尺寸当作实际尺寸。

脚本为 `.qingzhou-test/history-and-split-diff/native-v3.mjs`。首次等待固定端口超时，因为 Electron 后端遇到端口占用自动使用备用端口；脚本改为读取窗口实际 origin 后通过。没有连接或写入用户项目数据，核对后关闭测试 Electron。该复核针对四页签布局与原生标题栏，不执行真实模型任务。

16 张原生截图位于 `actual-v3/electron-{design,delivery,acceptance,history}-{1440x1000,533x1000,1440x600,533x600}.png`，文件名保留请求尺寸，实际尺寸以上述记录为准。已查看正常尺寸四页签、最小窗口验收和历史截图；交付截图选中真实测试文件。原有审批与 Git 详情共用差异核心已通过解析和行模型回归，本次未逐一在原生窗口操作其所有入口。

最终 `git diff --check` 通过；人工验收待用户确认，未提交、推送或发版。

## v4 模块产品设计变化

2026-10-21，用户明确要求增加模块产品设计变化页签。当前 HEAD 不变，加本轮修改；24 个源码与测试变更文件按路径、内容和 NUL 分隔规则计算 SHA-256：`076a5dc9b47f32a99d7933af2cf52f0f3e69637f9f75dd3eada6a5cc0788c344`。

- `pnpm lint`、`pnpm typecheck` 通过。Playwright 前置 protocol / web / server 生产构建通过，仍有既有 chunk 大小提示。
- `pnpm exec playwright test tests/e2e/project-workflow.spec.ts --grep 'module design tab|PRDs iterate|four requirement tabs|workspace preserves|reopening design'`：5/5 通过。五页签浏览用例保留原测试名，实际断言已包含“模块设计”。
- 截图发现窄屏模块选择器被网格内容最小宽度挤出；对子区设置 `min-width: 0`，新增选择器与差异容器的视口边界断言。最终 `pnpm exec playwright test tests/e2e/project-workflow.spec.ts --grep 'module design tab'`：1/1 通过，核对 533px、390px 的真实选择和底部边界。
- 首次新增用例停在项目模块页，未返回需求列表就查找“新建需求”，因此超时；调整测试导航后通过，未放宽业务断言。

实际回归建立两个模块与独立需求，核对无关联空状态、键盘进入页签、多模块切换、旧/新正文、未保存草稿、放弃后恢复、保存确认和 `panel=modules` 直接进入。固化回归在模块已发布新版本之后仍比较原 v1 基线与固化 PRD v2 提案，确认没有用后来版本替代旧依据，且页签内没有编辑框。

未改服务端、协议和持久化流程，本轮没有重复执行全部单测或真实 Git 集成；相关生命周期页面回归使用真实临时 Git、检查与人工验收交互，不等同于用户验收或真实模型理解。

截图位于 `.qingzhou-test/history-and-split-diff/actual-v4/`：`module-changes-draft.png`、`module-changes-dark.png`、`module-changes-light.png`、`module-changes-533.png`、`module-changes-390.png`、`frozen-module-changes.png`。已查看浅深主题、390px 和固化截图；数据来自隔离测试项目的实际生产前端。

最终原生复核使用 `native-v4.mjs`，加载本轮最新 web 构建和独立 e2e 数据与 Electron profile。`desktop: true, platform: darwin`；实际尺寸 1440×770、533×770、1440×600、533×600，均切换两个模块并核对基线、选择器和底部操作边界，4/4 通过。请求的 1000px 高度受 macOS 工作区限制为 770px。已查看正常及最小窗口截图，文件为 `electron-modules-{1440x1000,533x1000,1440x600,533x600}.png`，文件名保留请求尺寸。测试窗口已关闭，未连接用户项目数据。

最终 `git diff --check` 通过；实现和自测完成，待用户确认。未提交、推送或发布。

## v0.1.26 发布候选验证

用户明确要求正式发布。相对最新正式版 v0.1.25（ef165fe），HEAD c7211cd 加本轮改动，版本号 0.1.26 已同步五个 package.json 与 CHANGELOG。28 个源码、测试及包清单变更文件的 NUL 分隔 SHA-256：`325f6891690e15d73821e9cdeef4ce5ef19fb6c5f1762239ae13e5c29da73e9c`。

独立只读复核覆盖架构、安全及假设违反、组合失败、操作级联和大输入四个角度，发现四项问题，均已修复并复核：候选复审不能更新、无文件归属的用例误关联、正文误判为 Git hunk、长文矩阵无界分配。新增两项单测及两项现有页面流程断言先在修复前失败，再在修复后通过；完整页面回归包含复审通过后改为设计变化、保存、改回兼容并重新确认合入的序列。

| 发布前检查 | 真实结果 |
| --- | --- |
| protocol build | 通过，先于 web 接入 |
| pnpm lint | 通过 |
| pnpm typecheck | protocol / server / web / desktop 全部通过 |
| pnpm test | 486 通过，3 项 Windows 安装测试在 macOS 跳过 |
| pnpm test:integration | 101 通过，1 项平台限定测试跳过；含 78 项真实 Git 工作流 |
| pnpm test:e2e --grep-invert 'visual workbench' | 52/52 通过，5.8 分钟 |
| pnpm --filter @qingzhou/desktop build | 通过，main/preload 已按当前候选重建 |
| verify-release-version.ts v0.1.26 | 五个包的正式标签校验通过 |
| git diff --check | 通过 |

仅修改版本号即触发 pnpm 11 的依赖状态刷新，原依赖与 lockfile 未改变；本地验证设置 `pnpm_config_verify_deps_before_run=warn` 避免不必要的重新安装，远端 CI 仍按 frozen-lockfile 全新安装。首次 tsx 标签校验因沙箱 IPC 权限失败，允许本地 IPC 后通过；GitHub API 经仓库既有的本机 Git 代理访问。

发布面为 GitHub latest 正式版，预期产物包含 macOS arm64/x64、Windows x64 安装包、SHA256SUMS.txt 和 latest.json。用户已授权提交、推送与发布；本记录不代替平台人工验收或合入事实。最终远端 CI、正式发布及包内版本、校验回读以实际发布回执为准。
