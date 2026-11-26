# 墨问桌面迁移与界面重设计 · 验证记录

验证依据为 [PRD v2](PRD.md)、[页面设计](DESIGN.md)和基线 `f76ee5488c1f98ede475ce3a785743afafcb66a7`。本记录对应隔离工作区的 0.1.28 候选，人工验收仍待确认。

## 墨问品牌验收

- 核对 Mozi 和 Modu 的实际图标。墨问使用同色圆角底和独立的白色对话字形。Tauri 由网页 SVG 源生成桌面与窗口图标。
- 已通过 49 项针对性单测和 6 项 Chromium 回归，覆盖浏览器标题及标志、项目导航、窄屏布局、便携更新提示、Mac 新安装至 `Mowen.app` 和已有 `Qingzhou.app` 原位替换。
- 墨问候选通过 lint、类型检查和 67 项全量 Chromium E2E。集成测试通过 103 项，跳过 1 项。归档修复后，本机单测通过 508 项，Windows 专用 ZIP 用例另外通过原生验证。系统 WebView 通过启动、断线恢复、AppKit 组字、原生文件选择及重启回归。用正式 arm64 ZIP 一致的网页资源与随包 Pi，在原生窗口完成两轮实际本机模型流式对话并重启回读。
- arm64 DMG 和 Intel ZIP 完成隔离首装、签名校验与原生启动。两套架构的历史 0.1.26 更新器使用墨问 ZIP 拒绝错误摘要，再从原 `Qingzhou.app` 路径原位替换。各四份会话和项目资料逐字节保留，应用元数据读出「墨问」，升级后原路径可启动。
- 两种 macOS 架构从 0.1.27 设置页拒绝修改过的下载，随后安装以 `Mowen.app` 为根的正确签名包并重启。主程序和 7 个网页文件与成品一致，主题、中文草稿和已确认 PRD 历史保留。Apple Silicon 使用独立标识重建同版本测试夹具，解决历史夹具启动时未取得桌面会话的问题。
- 三套墨问 ZIP 的全部 7 个网页文件与同次构建逐字节一致，归档修复后的服务资源一致。macOS 两份 ZIP 的新显示名称、原应用标识和旧归档入口均已核对。两份 DMG 通过磁盘校验。Finder 自定义窗口步骤在本机失败，最终本地 DMG 沿用安装内容、卷图标和 Applications 链接。候选完整哈希在 `.qingzhou-test/mowen-windows-migration.CXZJMw/release-artifacts.json`。

## 功能对照

| 旧版入口 | 新版验收操作 | 旧版回归依据 |
| --- | --- | --- |
| `/` 会话、输入、消息、详情 | 新建、恢复、重命名、归档与撤销，搜索和导出。发送文本和图片，切换模型、思考级别和权限，验证流式输出、排队追加、中止重试、Markdown、工具展开和阅读位置。 | `workbench.spec.ts`、`conversation-rendering.spec.ts`、`frontend-interactions.spec.ts` |
| `/board` 项目、需求与待处理 | 新建项目和需求，转入自由对话来源，设置依赖和并行队列。并行需求中的审批及问题返回正确对象。旧项目、需求和页签深链仍可用。 | `project-workflow.spec.ts`、`workflow.test.ts`、`workflow-runtime.test.ts` |
| 需求设计、交付和历史 | 确认范围及绑定 PRD，运行实施，封存选择的文件，执行检查，独立完成逐项验收、候选复审与合入。以真实 Git 核对分支、提交、差异和历史证据。检查旧草稿、损坏草稿、迟到响应、更新后的 PRD 与模块基线。 | `project-workflow.spec.ts`、`workflow.test.ts`、`workflow-runtime.test.ts` |
| 文件、Git、终端、浏览器与 Pi 资源 | 切换项目或会话后仍绑定正确工作区。看文本及媒体文件、Git 状态及差异，验证仅对授权路径执行恢复、提交及推送。真实 PTY 执行并调整大小，网页预览可导航且隔离，规则和技能等资源保持可操作。 | `workbench.spec.ts`、`frontend-interactions.spec.ts`、`task-shell.test.ts`、`file-browser-media.test.ts`、`browser-url.test.ts` |
| `/settings` 与首次运行 | 从窗口和原生菜单进入同一设置。配置凭据、模型、工作区、信任、外观及更新。中文输入法确认不误发，选择目录可取消；代理配置与真实模型请求有效。 | `frontend-interactions.spec.ts`、`visual-theme.spec.ts`、`settings-auth.test.ts`、`pi-oauth-login.test.ts`、`http-proxy.test.ts` |
| 桌面桥接、进程生命周期 | 从正式包启动、重复启动、崩溃重试、退出重开。验证原生对话框、菜单、通知、复制、打开路径、HTTP 下载、WebSocket 恢复和保存失败保护。测试独立预览无桌面命令或应用会话权限。 | `desktop-bridge.test.ts`、`desktop-menu.test.ts`、`desktop-paths.test.ts`；需 Tauri 原生验证 |
| 安装程序与更新 | 在隔离资料上验证全新安装、Electron → Tauri、Tauri → Tauri、坏摘要或坏签名的中止、更新失败后重试。检查 Windows 便携启动和 WebView2，并记录三个架构各自的证据。 | `qingzhou-update.test.ts`、`.github/workflows/release.yml`；需候选包和实际宿主 |

现有 E2E 中依赖 Electron 标记、旧标题栏或旧布局的断言，迁移时按新版交互改写。服务端与前端的行为断言继续覆盖同一结果。模拟 Pi 测试证明事件和编排链路，真实包另外核对内置 Pi、PTY、平台 WebView 及升级。

## 本机验证

- 对话、项目看板和需求审阅的视觉层级通过 Chromium 实拍复核。检查普通对话的标题栏入口、复制、克隆、消息操作区、鼠标悬停、键盘聚焦、触控目标与 375 px 无横向溢出。看板覆盖明暗主题、533 × 600 视口和紧凑空泳道。需求页在 533 px 和 390 px 对齐标题及页签。截图在 `.qingzhou-test/hierarchy-screens/`。同一界面构建通过 macOS WKWebView 启动、AppKit 组字、最小窗口、断线恢复和重启回归，证据在 `.qingzhou-test/tauri-native-LJm1iZ/`。配合同一界面和本机真实模型，再次验证两轮流式对话和重启恢复，截图在 `.qingzhou-test/native-live-model.ex3rG1/`。
- 本轮 lint、类型检查和 506 项单测通过。集成测试通过 103 项，跳过 1 项。首次完整浏览器回归中 66 项通过，审批策略用例在模拟请求发出后立即刷新，有一轮未等到服务端确认。测试改为等待 `task.updated` 事件后刷新，三次定向复验均通过，随后全量 Chromium E2E 67 项在同一轮通过。日志在 `.qingzhou-test/hierarchy-full-e2e-final.log`。
- 用 `PORT=4378 pnpm dev` 启动隔离工作区，Vite 从 5173 转发健康检查、会话 API、已认证 WebSocket 和上传路径。默认及自定义端口有单测。另用仓库的 Tauri 调试入口启动系统 WebView，验证它使用独立的动态端口、完成认证并写入窗口偏好。使用覆盖端口重新生成 Vite 生产文件，所有文件均与三个桌面候选包的前端资源逐字节一致。

- 在新目录用冻结锁文件及本机包缓存完成离线依赖安装。类型检查、lint、版本一致性检查和 506 项单测通过。Windows 安装脚本的 6 项夹具用例由 macOS 上的 PowerShell 运行。全量集成通过 103 项，跳过 1 项，包含源码入口及生产 bundle 的单实例、认证、WebSocket、图片和文本草稿、损坏数据保留与重启恢复。macOS 宿主 Rust 单测通过 3 项，Windows x64 的 Rust 源码、测试和桌面自动化功能完成交叉检查。
- 完整 Chromium E2E 共 67 项通过，命令为 `QINGZHOU_E2E_PORT=4372 pnpm test:e2e`。覆盖新导航、设置、草稿、组合输入、交付、依赖、过期快照和终端入口，并用真实 Git 验证封存、验收与乱序合入。多尺寸视觉用例保存桌面、533 px、375 px、明暗和触控截图。当前源码重建的 WKWebView 测试包通过认证、WebSocket、独立预览、原生设置与目录选择、AppKit 组字、重连和草稿恢复、533 × 600 视口及正常退出重开，截图在 `.qingzhou-test/tauri-native-3vCoMP/`。
- 从实际对话截图复现单行气泡被隐藏操作栏撑高。调整后，WKWebView 中的单行文字高 24 px、气泡高 40 px。533 × 600 窗口中两行文字高 48 px、气泡高 64 px，操作栏位于气泡下方，两种窗口均无页面横向溢出。Chromium 检查悬停、键盘聚焦、触控、按钮高度和 375 px 布局。另以延迟的 `/api/setup` 复现新对话的默认目录未回填，修复后自动补上默认路径，并保留用户手动输入以抵抗迟到的目录查询。最新原生截图和几何数据在 `.qingzhou-test/native-live-model.wE8f3p/`。
- 本轮全量 Chromium E2E 中 66 项直接通过。一项需求页签用例在缩窄窗口后立即读取双栏状态，造成选择器超时。调整用例等待双栏分隔消失，再与消息气泡和默认目录用例一起各跑两遍，6 项均通过。实际运行日志在 `.qingzhou-test/layout-final-e2e.log` 和 `.qingzhou-test/layout-final-e2e-focused.log`。
- 用最终源码及调整后的测试重新启动隔离服务，完整 Chromium E2E 共 67 项在同一次运行中通过，包含窄屏需求页签、气泡操作和默认目录回填。日志在 `.qingzhou-test/tauri-current-full-e2e.log`。本次生成的 6 个生产前端文件与三套候选 ZIP 的网页资源逐字节一致，六个候选包的 SHA256 和版本校验重新核对通过。
- `tauri:dev` 从源码启动独立标识的开发宿主，以指定资料目录完成本机服务和 WebView 握手。两种最终 macOS 成品均完成单服务启动和认证。arm64 含重复实例检查约 3.2 秒，Intel 在 Rosetta 约 20.0 秒。两份 DMG 和 ZIP 的归档校验均通过，ZIP 内的 HTML 与引用资源齐全。用解包后的 arm64 成品再次启动，第二次启动复用原服务。
- 两套 macOS 架构的成品包均启动过。Intel 候选在 Rosetta 下运行。分别用包内 Node 执行了真实 Pi 1.6 RPC `get_state` 和原生 PTY，检查了 Intel Node、fd、rg 的架构。
- 复现了 macOS 安装脚本成功退出后仍残留解包目录的问题。修复后，从空目录用脚本安装成品 arm64 DMG 和 Intel ZIP。两者通过本机签名严格校验，启动原生 WebView 并完成会话鉴权，Intel 使用 Rosetta。`--local` 在两套包同时存在时选中 arm64 ZIP 并启动。三次安装均清空临时目录，DMG 已卸载。新增本机回归覆盖 ZIP、DMG、架构选择、下载成功和摘要不符，下载用例使用测试资源。实测使用隔离目录及无管理员权限流程，日志为 `.qingzhou-test/native-first-install.log`。
- 用 PowerShell 夹具复现旧 Windows 一键安装脚本在安装器退出码为 23 时仍报告成功并遗留下载目录。修复后，退出码为 0 时报告成功，非零退出时显示原安装器退出码并让脚本报错，校验不匹配时不会启动安装器。三条路径均清理本次下载的临时目录。夹具模拟下载和安装器返回值，实机的 NSIS、WebView2 及升级继续使用 Windows 作业验证。结果在 `.qingzhou-test/install-windows-before-result.log` 和 `.qingzhou-test/win-installer-unit-verified.log`。
- 在真实 WKWebView 的隔离包中移走工作台入口，验证启动页显示中文提示和重试按钮，日志记录缺失资源且服务尚未启动。恢复入口后启动一个服务。终止该服务，工作台显示断开，点重新连接后仅启动一个新服务并收到认证 WebSocket 快照。日志未出现会话票据。复测继续通过预览隔离、533 × 600、正常退出及主题恢复。截图在 `.qingzhou-test/tauri-native-WEN5Sz/`。
- 在系统 WKWebView 中复现断线时输入的草稿随工作台重载丢失。修复后，单独制造桌面偏好文件损坏，验证重连失败会保留原窗口、草稿及损坏文件原字节。还原文件再次重连，验证仅启动一个新服务、草稿已落盘，且原对话中的草稿可以继续编辑。侧车集成覆盖换行文本、图片和删除记录。当前截图在 `.qingzhou-test/tauri-native-vEByFA/`。
- 侧车退出用例暂停读取 WebSocket 并提交未发送完的 HTTP 请求。修复前，两种连接分别导致超时。修复后，源码与生产 bundle 均能保存数据，终止连接并正常退出。Windows 的源码构建原缺少图标资源，补齐后带桌面自动化编译特性的 x64 Rust 检查通过。
- macOS 测试包通过 AppKit 菜单键盘等效事件 `⌘,` 打开设置，并从窗口内入口打开同一设置。新对话的文件夹入口打开真实 `NSOpenPanel`，取消返回 `null` 并保留已选路径。执行这些操作后，退出与重开回归通过。原生测试入口仅编入测试包，当前截图在 `.qingzhou-test/tauri-native-gqsXqi/`。
- macOS 测试包通过真实 `NSTextInputClient` 进入组字并提交中文。WKWebView 收到可信的组字开始与结束事件。组字期间注入回车时未发送消息，提交后保留光标两侧文本且焦点留在输入框，关闭重开后可回读原草稿。另复跑 Chromium 的 229 键码、`Shift+Enter` 排队和新对话焦点回归。此用例不依赖系统输入法切换，截图在 `.qingzhou-test/tauri-native-LMckSI/`。
- 在最终 arm64 包中，用内置 Node 和真实 Pi 1.6，经过本机 HTTP 会话认证、WebSocket 对话和 OpenAI 兼容的本机端点，验证真实流式请求和中文回复。端点返回固定测试内容。
- 用 llama.cpp 和 SmolLM2-135M-Instruct 在 macOS 上实际生成两轮回复。通过原生 WKWebView 创建对话、选用问答模式并发送两条消息。随包 Pi 的两次流式回复分别收到 16 和 14 段内容，窗口显示相同文本和两次流式状态，第二次请求带上原对话。关闭并重启窗口后，两条回复从隔离资料恢复，未重新调用模型。Pi 测试配置声明 16K 上下文，以留出其预留的安全余量。模型服务器的实际单槽仍是 8192，最长请求及回复约 7.1K。测试使用本机回环端点，未用服务商账号。日志和截图在 `.qingzhou-test/native-live-model.rfwcbv/`。测试包的服务、Node、页面入口和 Pi 入口与 arm64 成品 ZIP 逐字节一致。
- 在 macOS WKWebView 测试包中，新建对话并选择「每次确认」。由本机模型端点驱动随包 Pi 1.6 两次调用 `write`。选择「拒绝」后目标文件未落盘，Pi 将拒绝结果返回模型。选择「允许这次」前目标同样未落盘，批准后写入隔离工作区，文件内容与预期逐字节一致。测试包的服务、审批扩展、Pi 入口、Node 和页面入口已与 arm64 成品 ZIP 对比，字节一致。代理拒绝外部连接。截图及结果在 `.qingzhou-test/native-pi-approval.WdYvAQ/`。
- 用重新构建的 WKWebView 测试包启动隔离资料，只为原生宿主配置 `ALL_PROXY`。本机代理记录到随包 Pi 发起的单次模型 CONNECT，WebSocket 收到中文流式更新和完整回复。代理拒绝其他目标，模型端点未访问公网。macOS 的 Rust 用例从本机 HTTP 读取 PAC，在 CFNetwork 中验证返回代理和返回直连。Windows 的 WinHTTP 解析和本机 PAC 用例通过交叉编译，已加入发布工作流，待 Windows 运行器执行。
- 代理改动后的桌面侧车源码与生产 bundle 集成通过，代理单测通过 3 项，macOS 宿主 Rust 单测通过 2 项。重新执行 WKWebView 原生回归，工作区约 1.1–1.2 秒就绪，缺失资源重试、断线草稿恢复、原生菜单和选择器、独立预览、最小窗口与正常退出均通过。截图在 `.qingzhou-test/tauri-native-zapjyL/`。
- macOS 将 0.1.26 的实包复制到隔离路径，运行旧包创建会话，再用该版本的升级代码、真实候选 zip 和本机清单执行原位替换。错误摘要被拒绝。通过摘要的候选原位替换后启动并读写隔离资料，安装未改变旧状态文件的字节。最终 arm64 候选重新通过摘要拒绝、原路径启动和验证旧会话保留。验证未修改实际安装目录或用户资料。
- arm64 和 Intel 旧版实包分别创建了 Git 项目、需求和已确认 PRD，并留下项目编排、需求范围及 PRD 确认事件。Intel 使用按 0.1.26 发布清单验过 SHA256 的 x64 安装包，通过 Rosetta 运行。两种架构使用 `v0.1.26` 更新代码分别拒绝错误摘要并原位换入最终候选。项目资料、编排历史、设置和 PRD 文档的原始字节保留，原路径候选完成认证启动。共享同架构成品服务及前端资源的 WKWebView 测试包进一步打开同一项目和需求，在项目历史回放旧编排设置，并在需求历史回放原 PRD。前后事件 ID 和正文一致。截图在 `.qingzhou-test/legacy-project.KE5Xn9/` 与 `.qingzhou-test/legacy-project-intel.bXnngg/`。
- 对本轮最新的两份 macOS ZIP，再用 `v0.1.26` 更新代码验证错误摘要及原位替换。两套隔离资料各核对四份原文件，替换前后字节一致，换入的两种成品均完成原生会话鉴权。共享最新成品服务和网页资源的 arm64 WKWebView 还打开了原项目、同 ID 的需求、项目编排记录与已确认 PRD，事件 ID 和正文一致。Intel 旧包再次按发布清单验证 SHA256，成品通过 Rosetta 运行。证据在 `.qingzhou-test/layout-signed.oKcH3R/electron-arm64/`、`electron-x64/` 及同级日志。
- 两套 macOS 架构均用隔离测试签名和本机更新源验证 Tauri 0.1.27 测试构建 → 0.1.28。错误签名被拒绝。正确签名安装后自动重启，原主题和未发送草稿保留。Intel 使用 Rosetta，更新包是本轮实际生成的 Intel `.app.tar.gz` 和 `.sig`。正式发布签名由发布环境提供。
- PAC 改动后，arm64 和 Intel 从设置页重跑签名更新。修改下载包首字节时继续运行 0.1.27，重试原包后自动重启为 0.1.28，主程序与该轮成品 ZIP 中的文件字节一致。主题、未发送中文草稿、原 PRD 及确认事件保留。测试使用本机更新源及 `NO_PROXY`。两种架构分别在启用系统手动代理和启用拒绝转发的本机测试代理下完成验证，证据在 `.qingzhou-test/signed-current.y8FECP/`。
- 首次图像复核发现更新页面直接显示英文库错误。修改后，两种 macOS 架构的设置页均显示中文签名校验提示，保留重试按钮，成功安装并自动重启到重新打包的候选。重启后保留中文草稿、主题和原 PRD。Rust 单测检查签名与下载错误的中文提示，也验证安装失败时保留上一版的位置提示。截图和结果在 `.qingzhou-test/signed-localized.QRRpLz/run-arm64/` 及 `run-x64/`。
- 用消息气泡和默认目录修复后的最新 ZIP 生成隔离签名包。两种 macOS 架构从 0.1.27 设置页拒绝首字节被改动的下载，继续运行旧版。重试原包后原位安装 0.1.28 并自动重启。安装后的主程序和 6 个前端文件均与对应成品 ZIP 逐字节一致，主题、未发送的中文草稿、已确认 PRD 与原确认事件完整保留。Intel 用 Rosetta，更新源和密钥均隔离。截图、运行结果和回环请求数在 `.qingzhou-test/layout-signed.oKcH3R/run-arm64/` 和 `run-x64/`。
- 同为 arm64 的旧版精简包为 365,547,763 B，新版 Pi 1.6 候选为 211,994,005 B，减少约 42%。下载 zip 从 149.4 MB 降至约 79.7 MB。两包的 Pi 版本有差异。迁移前期使用相同 Pi 版本测得 203,420,272 B，减少约 44%。
- 在同一台 arm64 Mac 上，分别启动隔离的 0.1.26 和候选 0.1.28 空窗口。服务和窗口渲染进程出现后空闲五秒，按 macOS `footprint` 连续采样三次，取 `Summary Footprint` 中位数。0.1.26 的宿主与 Chromium 子进程共 215,257,792 B，0.1.28 的宿主、本机 Node 服务与新启动的 WebKit 内容、网络和 GPU 进程共 209,828,888 B。两版检测到服务与渲染进程的单次用时分别为 0.78 秒和 1.00 秒。该测量使用原生启动与隔离资料，Pi 分别为 1.3 和 1.6，且尚未启动模型会话。完整样本在 `.qingzhou-test/tauri-footprint-NqVgYB/`。

## 相同 Pi 的性能对比

在同一台 arm64 Mac 上，用 0.1.26 和当前 0.1.28 候选的隔离副本测试。两边使用逐文件校验一致的 Pi 1.3.0、fd 和 rg。每版启动三个新进程，交替顺序，每次使用独立资料打开同一条已保存对话。启动时间从进程创建计到消息框可输入。页面就绪后空闲五秒，用 macOS `footprint` 统计应用的全部相关进程，包含 Pi。系统文件缓存沿用本机状态。

| 指标 | 0.1.26 Electron | 0.1.28 Tauri |
| --- | ---: | ---: |
| 同资源副本的常规文件体积，测量脚本写入前 | 416,648,851 B | 234,135,078 B |
| 启动至对话可输入，中位数 | 798 ms | 913 ms |
| 已打开对话时的空闲内存，中位数 | 381,884,512 B | 369,294,032 B |

这轮配对测试中，安装体积缩小约 44%，空闲内存减少约 3%，启动至可输入约多 0.12 秒。交付包仍内置 Pi 1.6。原始采样在 `.qingzhou-test/matched-pi.Bag6az/comparison.json`。

## 候选产物

桌面测试构建与成品使用不同的 Cargo 输出目录。独立目录生成的 arm64 测试包已完成 WKWebView 回归，截图在 `.qingzhou-test/tauri-native-v9WjHx/`。三份成品 ZIP 均验证包含平台代理解析器且未编入 WebDriver 测试驱动。

视觉层级优化阶段曾对 6 个网页文件、桌面宿主与随包运行资源完成归档校验，结果记录在 `.qingzhou-test/hierarchy-package.R4wpLc/release-artifacts.json`。下表为增加墨问名称和标志后重编译的候选。

新版 arm64 DMG、Intel ZIP 和 `--local` 选中的 arm64 ZIP 通过空目录安装、本机签名及临时资源清理。原有轻舟运行时，首次启动触发单实例机制。原有实例退出后，两种成品分别完成原生会话鉴权，arm64 重复启动只保留一个服务，Intel 通过 Rosetta。日志为 `.qingzhou-test/hierarchy-first-install-only.log` 和 `.qingzhou-test/hierarchy-stock-launch.log`。三套新版更新资产使用隔离密钥验证，原文件均通过，改动首字节后均被拒绝。

| 文件 | 字节数 | SHA256 |
| --- | ---: | --- |
| `Qingzhou-mac-arm64.zip` | 77,834,234 | `0bf5796fa18f2fb70befd1e7bde5efccbf6a18f1088af7ce28ecac785056ff84` |
| `Qingzhou-mac-arm64.dmg` | 64,713,560 | `d137e8bbbc2499b66eb0f762fe8c87395fcf2e6e15b12b67ec549470788eb053` |
| `Qingzhou-mac-x64.zip` | 80,193,505 | `67e233fad65b9ea95d080a1f3e14fcfcef6c398250ffc09bc9e3a1650e8eea0a` |
| `Qingzhou-mac-x64.dmg` | 67,014,246 | `207976c03ac71f38b76e1068b02c1e03bfc70994caf039ff064770b01e249362` |
| `Qingzhou-win-x64-setup.exe` | 45,156,993 | `5ded4bfa9b9ff3f55bd76c12c973f9e8daa4a76977c57139da344824d9dd5889` |
| `Qingzhou-win-x64-portable.zip` | 77,982,616 | `eada6c16b661156ffbe03042019b5ea9a6e8ee01bd209a6bb59cc135550fba7a` |

Windows 候选为 macOS 上用 `cargo-xwin`、Windows SDK 和 NSIS 交叉构建的未签名产物。便携 ZIP 完整性检查通过，主程序为 AMD64 Windows GUI 二进制，包内含 Windows Node、PTY、Pi 平台模块、fd 和 rg。检查了生成的 NSIS 脚本调用迁移钩子，PowerShell 回归脚本及发布工作流已通过解析。迁移脚本使用 0.1.26 的公开正式安装包，并固定其发布清单的 SHA256。

生成的 NSIS 脚本从当前用户安装登记读取目标目录。Rust 用例验证同目录、异目录和无登记目录，Windows 交叉编译通过。前端单测确认便携实例检查时返回官方 ZIP，并拒绝触发安装。Chromium 模拟 Windows 桌面桥接，确认工具栏与设置均显示 ZIP 链接，现有设置流程也通过复验。Windows 原生用例新增安装与便携共存时的启动和登记检查。

界面修复前用同一把临时更新密钥生成 macOS arm64、macOS x64 和 Windows x64 的签名资产，供核对发布链路。正式清单生成脚本产出的三个平台条目均指向对应资产和签名。用与锁定更新插件相同的 minisign 验证库检查，每份原始资产均通过，修改一个字节后均被拒绝。Windows 0.1.26 正式安装包也已完整下载，实测 SHA256 与迁移用例固定值一致。`verify_only` 的 Windows 作业使用临时密钥生成更新签名。

基于最新两套 macOS ZIP 和 Windows NSIS 安装包再次生成隔离签名和三平台清单。使用与锁定更新插件相同的 minisign 验证库，三个原始资产通过验签，三个首字节改动的副本均被拒绝。用于签名的 Windows 文件与候选目录的安装包逐字节一致，结果与清单在 `.qingzhou-test/layout-signed.oKcH3R/`。

供签名更新用例使用的 0.1.27 Windows 安装包（桌面自动化功能、本机更新地址）已交叉编译并生成 NSIS。同轮的 0.1.28 Windows 安装包另外用匹配的临时密钥签名，验签通过，修改安装包的首字节后验签失败。测试脚本的静态检查与工作流解析均通过。

## Windows 实机验证

- 第一次 [GitHub Actions 仅验证作业](https://github.com/Yunz93/Qingzhou/actions/runs/45647793859) 到达 Windows 单测。命令成功退出，但 Windows 将子进程工作目录显示为 8.3 短路径，导致原始字符串比较失败。测试已对实际和预期路径应用 `realpath` 后严格比较。第二次 [仅验证作业](https://github.com/Yunz93/Qingzhou/actions/runs/45649564675) 对提交 `1b700571a0ca8a92844d82a8c86a5b4fcd583c3f` 运行。
- 第二次作业的 lint、类型检查、全量单元与集成、Rust 检查及两个 WinHTTP PAC 用例均通过。Node 归档解压阶段选中了 Git Bash 的 GNU tar，Windows 的 `D:` 被解读为远程归档地址。打包脚本改用 Windows 系统自带的 `tar.exe` 处理 Node ZIP 和便携 ZIP。[墨问仅验证作业](https://github.com/Yunz93/Qingzhou/actions/runs/45651700193) 对提交 `5b193fbb43a8c13f8452e4f62f2b26f7ea455da0` 运行。
- 墨问作业通过 Windows 单测、集成、Rust 和 WinHTTP PAC，Node ZIP 解压通过，fd ZIP 仍由 Git Bash 的 tar 处理。所有工具及安装包入口已共享系统 tar 解析；验证作业先运行真实 ZIP 夹具，再构建、安装和升级。正式发行作业仍执行全量前置验证。
- [Windows 归档复验](https://github.com/Yunz93/Qingzhou/actions/runs/45655354067) 使用提交 `c944e4b77ffbb9879973bcd70538cab223174948`，通过 ZIP 实际解包、PAC、签名成品及旧版夹具构建。测试驱动就绪时首次请求会话得到 `no such window`，原生烟测和签名升级测试均改为等待主窗口接受会话。
- [Windows WebView2 复验](https://github.com/Yunz93/Qingzhou/actions/runs/45659853963) 已成功建立 WebDriver 会话，并打开缺失资源提示。补齐资源后停在本机服务启动错误。验证作业改为先检查正常成品启动，并将失败时的服务日志保留在作业输出中。
- [Windows 成品启动日志](https://github.com/Yunz93/Qingzhou/actions/runs/45663114103) 记录随包 Node 22.22.0 在解析主入口时对 `D:` 返回 `EISDIR`。Tauri 对资源目录做了规范化并带上 Windows 扩展盘符前缀，触发了 [Node.js 已记录的路径问题](https://github.com/nodejs/node/issues/62446)。桌面宿主保留已解析的资源目录，在传给 Node 前移除可等价转换的盘符前缀。新增 D 盘、空格和中文目录名的 Rust 回归。
- [Windows 路径复验](https://github.com/Yunz93/Qingzhou/actions/runs/45666220194) 针对提交 `4f8080b201b4be1d3b045559d0a0f70a2c8720bc`，通过 5 项 Rust 原生测试。正式便携包、全新安装包、与正式安装共存的便携包，以及从正式 0.1.26 在自定义目录原位升级的包，均在 Windows 启动并读取保留资料。旧版升级同时核对安装登记和快捷方式。WebView2 测试通过缺失文件提示、补齐后启动及会话认证，在新建对话后等待标题时超时。
- Windows 续验包含断线草稿恢复、网页预览及签名更新。WebView2 交互烟测与签名更新使用独立步骤和资料目录。签名更新从带驱动的 0.1.27 NSIS 软件包启动，通过本机源测试 0.1.28 候选，覆盖便携副本拒绝执行安装、损坏资产拒绝、正确签名原位更新，以及重启后资料保留。
- [Windows WebView2 交互复验](https://github.com/Yunz93/Qingzhou/actions/runs/45670898073) 在 `5be14ed2e5758fd6e78a309c3c096760fa8fc149` 通过了新建对话、断线草稿恢复、独立预览、最小窗口、退出重启和主题保留，四种成品安装与启动回归再次通过。签名升级测试退出时清理进程命令返回 1 并覆盖了原始错误，续验单独记录各升级断言及清理结果。
- [Windows 签名升级诊断](https://github.com/Yunz93/Qingzhou/actions/runs/45735878717/job/139628887453) 通过 0.1.27 验证包安装、便携副本拒绝下载和安装，原安装误报不可升级。Tauri 在嵌入的运行时配置中省略打包字段 `publisher`，因此安装判断提前返回。NSIS 和运行时改用同一应用标识中的 `qingzhou` 作为发布者。新增嵌入应用配置的 Rust 回归，沿用现有的安装路径校验。
- [Windows 安装登记复验](https://github.com/Yunz93/Qingzhou/actions/runs/45737958340) 对应 `bc33cf612b7621323b9a182743924765b85bc196`。该提交通过 lint、Rust 格式和含测试的 Windows 交叉编译。实机通过安装登记回归、四种成品安装与启动、便携副本拒绝安装、坏签名拒绝、正确签名安装与自动重启。测试发现 NSIS 卸载会保留新版路径，旧版的签名升级继而使用了已卸载的路径。旧版迁移钩子新增新版程序存在检查，验证脚本核对最终安装路径。WebView2 交互步骤移到签名升级前独立执行，避免错误目录中的更新进程干扰烟测。
- [Windows 原位复验](https://github.com/Yunz93/Qingzhou/actions/runs/45741016847) 对应 `b16a6d270035012ba9e9b644c4605003308f6260`。新版 NSIS 包通过本地交叉打包，便携包的主程序和归档内容校验与上次一致。实机通过 6 项 Rust 测试、四种成品安装与启动、WebView2 交互烟测及应用内签名更新。0.1.27 验证包拒绝损坏资产，使用正确签名包在原目录升级到 0.1.28，清除旧卸载登记，自动重启并保留主题和中文草稿。两种 macOS 架构同时通过该次作业的构建检查。
- 补充 Windows 原项目历史验收。0.1.26 通过原服务保存 Git 项目、需求、已确认 PRD 和历史事件，NSIS 升级比较项目与历史文件摘要，WebView2 再打开原需求并回放历史。0.1.27 签名更新用例同时验证项目和 PRD 确认事件在重启后保留。新夹具已通过 0.1.26 Intel 成品和当前 macOS WKWebView 的本机复验，截图在 `.qingzhou-test/tauri-native-97aOX1/legacy-project-history.png`。
- [Windows 历史复验](https://github.com/Yunz93/Qingzhou/actions/runs/45744710409) 通过 0.1.26 原版历史生成、两个原文件摘要核对，以及 0.1.27 签名升级后的项目、PRD、确认事件、主题与草稿保留。交互烟测在页面业务 WebSocket 连接就绪前提交了新对话，后续历史用例随该步骤跳过。工作流改为独立执行历史回放，烟测等待页面退出断线状态后再继续。
- [Windows 历史回放实机验收](https://github.com/Yunz93/Qingzhou/actions/runs/45747685027) 对应 `0ae0f54d0e68189ef0a82bf68916179dd97ae18e`。0.1.26 实包写入旧项目、需求和已确认 PRD，升级后 WebView2 打开同一需求 ID，回放原项目编排及 PRD 正文，核对保留的事件 ID。断线重连与草稿恢复复验通过。0.1.27 签名升级复验再次拒绝坏签名并在原路径自动重启，保留旧项目、PRD、确认历史、主题和草稿。该次作业的两个 macOS 目标也通过构建检查。

## 人工验收待确认

- macOS 已启用简体拼音，测试进程缺少系统键盘投递权限，自身窗口事件没有进入系统拼音引擎，系统候选词操作仍需手动验收。AppKit 文本客户端、草稿恢复与 Chromium 键码用例已通过。随包 Pi 已通过真实进程 RPC、写文件审批和本机模型推理，外部服务商账号连通仍待验收。
