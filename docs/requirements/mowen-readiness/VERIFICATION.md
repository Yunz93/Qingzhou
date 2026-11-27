# 墨问首用与商用就绪 · 验证

对应[PRD v1](PRD.md)。浏览器用独立资料目录；真实 Pi 1.6.0 和 Gemini 模拟端点在本机通信。测试不读取个人凭据。

| 场景 | 证据 |
| --- | --- |
| 首用到真实模型传输 | Chromium 在首次配置中展示本机 Gemini 模拟服务的地址。确认接收方后保存测试密钥、选择「产品设计」子目录，从「新对话」选择 Gemini 2.5 Flash 并收到流式回复。退出浏览器和服务后冷启动，恢复同一目录、模型和回复。本机模拟服务收到 1 次生成请求，浏览器收到 4 段增量。截图和计数在 `.qingzhou-test/gemini-browser-W0Y14B/`。 |
| 自定义接收方 | 单测覆盖未确认、地址变更、同一主机路径变更和不可读配置。表单仅展示 origin，服务端重新读取目标后保存。自定义配置不向官方模型目录发送密钥。 |
| 凭据和失败恢复 | `tests/integration/gemini-runtime-smoke.ts` 使用随包 Pi 核对跳过凭据后的工作区、已有会话的模型刷新、新会话默认模型、流式回复、Google 拒绝密钥、重试、执行失败和移除凭据。探测目录使用固定 Google URL，单测替换传输，覆盖代理错误、拒绝、配额和无效响应。 |
| 视觉与键盘 | 走查常规桌面、533 × 600 首用、390 像素设置和 375 像素对话，覆盖明暗两色、窄窗标题、侧栏焦点、图片查看和 Esc 返回。向导动画中背景透出以及设置刷新后丢失当前服务商均已修复。 |
| 历史回归 | 首轮浏览器回归在 5 处暴露状态和旧交互断言差异。已修正设置的迟到响应与用户选择竞争，并按新交互验证项目页切换、已隐藏的批量操作和抽屉焦点。在真实 Pi 流程复现首个会话错误使用父目录后，进一步核对服务端持久化的 cwd。 |
| macOS 原位升级 | 在隔离目录安装并启动经 SHA-256 校验的官方 Electron v0.1.28，由旧版记录项目、需求、PRD 和确认历史。验证错误摘要保留旧安装，正确摘要原位替换为 v0.1.29，逐字节比对设置和历史，再用 WKWebView 回放。 |

本轮按用户选择，以本机模拟服务完成 Gemini 验证。正式渠道的模型可用性、账号权限和配额由用户的 Google 项目决定。

在 `bcc16cb` 上，本机 510 项单元、103 项集成、3 项 macOS Rust 测试和 74 项 Chromium 端到端测试通过。单元有 7 项、集成有 1 项按运行环境跳过。WKWebView 实测使用包内 Node、Pi 和服务，模拟端点收到一次生成请求，窗口收到三段增量；全部桌面进程退出后重新打开，仍能看到原会话和模型。Windows 验证使用临时更新签名。

最终布局复核使用同一份资料比较 375 和 533 像素宽度的需求页，截图和 DOM 测量在 `.qingzhou-test/mobile-layout-diff.dXS0CW/`。有分页时，旧版 375 像素窗口的标题可用宽度为 0。新版短标题为 142 像素，长标题在 120 像素内完整显示为两行。在 533 像素窗口长标题可用宽度为 278 像素，可完整单行显示。相邻需求、审阅、对话、更多菜单和返回均已实际操作。

布局修订的产品源码为 `aa3559f`。实际 WKWebView 的 Gemini 截图和请求计数在 `.qingzhou-test/mowen-029-layout-final/mowen-gemini-wk-vqUfS2/`。Apple 芯片原位升级记录在 `.qingzhou-test/official-028-to-029.gwXDhH/verified.json`，Intel 包的 Rosetta 启动结果在 `.qingzhou-test/layout-intel-rosetta.auMdlH/verified.json`。六份成品校验清单位于本机 `apps/desktop/release/SHA256SUMS.txt`。

Linux 首轮在保存未确认需求后，测试同时匹配了看板卡片和待处理清单里的同名标题。断言已指定可点击的需求卡片。产品源码和桌面成品与 `aa3559f` 相同。

2026-11-27 核对布局修订。[完整 CI](https://github.com/Yunz93/Qingzhou/actions/runs/45858762510) 在 `ad51ac1` 通过 lint、类型检查、Linux 单元 504 项、集成 103 项和 Chromium 74 项；Linux 单元按平台跳过 13 项，集成跳过 1 项。[桌面验证](https://github.com/Yunz93/Qingzhou/actions/runs/45857166917) 在 `aa3559f` 的 macOS arm64、macOS x64 和 Windows x64 三个作业均通过。Windows 实测包括安装与卸载、便携启动、原位迁移 v0.1.28、旧项目历史回放、断线草稿恢复、真实 Pi 对接本机 Gemini 模拟服务和应用内签名更新。

分发修订 `7a8dcee` 使用同一套界面资源，补齐第三方声明后重新打包。Apple 芯片候选的 12,129 个运行资源和符号链接与 WKWebView 测试宿主逐项一致。首次配置和选择目录后，Pi 1.6.0 向本机模拟端点发送一次生成请求，界面收到三段回复。完全退出并重启后，会话 ID、模型和内容恢复，未观察到外部访问。记录在 `.qingzhou-test/mowen-029-notices/wk-archive-resource-match.json` 和同目录的 `mowen-gemini-wk-DqdAEl/evidence.json`。

六份成品均通过 SHA-256 校验。Windows 安装器与便携包的 12,139 项运行资源逐字节一致。服务端的 88 个实际依赖均有声明，macOS 两个架构各对应 200 个原生包，Windows 对应 191 个，含实际链接的 WebView2 SDK 声明。Pi、Node 和两个搜索工具的原文均从成品解出比对。成品大小和摘要在 `.qingzhou-test/mowen-029-notices/release-artifacts.json`，Windows 资源核对在同目录的 `windows-audit.log` 和 `windows-notices-audit.log`。

用官方 Electron v0.1.28 新建项目和一份已确认 PRD，再迁移至含声明的 Apple 芯片候选。旧版拒绝错误摘要，正确包原位安装并正常启动，12,132 项安装内容与最终 ZIP 相同。升级后工作项、设置和 PRD 正文字节一致。首次读取时工作流 JSON 重新排列了对象键，原项目、PRD、六条历史事件的内容均相同。记录和前后截图在 `.qingzhou-test/official-028-notices-arm64-rn_s9xzp/`。

用临时密钥验证两个 macOS 架构从 0.1.27 到本轮 0.1.29 的应用内升级。损坏的更新包被拒绝，重试后自动重启，并保留中文草稿、主题、原项目、PRD 和确认记录。Intel 包通过 Rosetta 运行，Apple 芯片的旧版测试窗口在首次进入时刷新一次。记录位于 `.qingzhou-test/signed-notices-029.w36wu1wj/run-{arm64,x64}/result.json`。另核对正式脚本生成的两种更新清单，旧清单的六个别名与三个实际安装包摘要对应，新清单的三个签名均通过校验，修改任一资产一个字节后被拒绝。

分发修订在本机通过 lint、类型检查、515 项单元和 103 项集成测试。Linux 完整 CI 通过 509 项单元、103 项集成和 74 项 Chromium 端到端测试。macOS 单元按环境跳过 7 项，Linux 跳过 13 项，集成各跳过 1 项。[本次完整 CI](https://github.com/Yunz93/Qingzhou/actions/runs/45919284187)

同一提交的 macOS arm64、macOS x64 和 Windows x64 作业全部通过。Windows 原生运行器验证安装、便携、原位升级、已装文件声明、WebView2 历史回放及断线草稿恢复。包内 Pi 与本机 Gemini 模拟服务验证流式回复和失败后重试。应用内更新拒绝损坏包，正确包升级到 0.1.29 后保留项目、确认记录、主题和草稿。发布步骤按 `verify_only` 跳过。[本次桌面验证](https://github.com/Yunz93/Qingzhou/actions/runs/45919302191)

本轮交付候选包，正式发布仍待人工决定。验证使用临时更新密钥。核对仓库配置项名称时，正式更新公钥变量 `QINGZHOU_TAURI_UPDATE_PUBKEY` 和签名私钥机密 `TAURI_SIGNING_PRIVATE_KEY` 均未设置。

## 对话首页与简化标志

按用户圈出的两个位置复现空会话页。1280 × 736 窗口中，旧「新建对话」中心比主栏中心偏左 270 像素。375 × 700 窗口偏左 113.5 像素。改动后，未配置时的「连接模型」和已配置时的「新建对话」均位于主栏水平中心，标题、说明与主操作聚成一组。三种尺寸的明暗主题共 18 张前后截图及几何测量见 `.qingzhou-test/mowen-layout-delivery.zDu8VzQa/screenshots-final/`。

新标志在 16、24、64 和 128 像素分别与旧图标对比，并与 Mozi、Modu 的实际图标并排复核。Windows ICO 的 16 像素图、macOS ICNS 的 128 像素图与相应渲染逐像素一致。图标对照在 `.qingzhou-test/mowen-gate-icon.MVGIU5/`。

原生 WKWebView 走查发现，从模型设置返回时焦点落在页面根节点。现从「连接模型」进入设置后，点击「返回对话」或浏览器后退会聚焦主操作，保存配置后则聚焦「新建对话」。首次直接打开首页沿用原有焦点行为。若用户在密钥保存结束前返回，首页切换操作时保留键盘焦点。若已移到搜索框，则可继续输入。桌面和 375 像素窄窗的 8 项定向 Chromium 测试连续两轮共 16 次通过，包含延迟保存、已有会话、读取失败和未知凭据状态。用例位于 `tests/e2e/startup.spec.ts`。

本轮产品提交为 `f7c0052`。最终 Apple 芯片 ZIP 内的 12,129 项运行资源与 WKWebView 测试宿主逐项一致。原生窗口通过系统浅色、深色、不同保存时机的焦点切换，以及随包 Pi 对本机 Gemini 模拟服务的流式回复和重启恢复。记录在 `.qingzhou-test/landing-wk-029.FtCdFu/`。

六份候选包的 SHA-256 均已复验。两种 Mac 磁盘映像已挂载核对应用和图标。Windows 主程序、安装器及卸载器内嵌的六个尺寸图标均与本轮 ICO 相同，安装器与便携包的 12,139 项运行资源逐项一致。校验记录和最终截图在 `.qingzhou-test/mowen-layout-focus-snapshot.8vbffKbT/`。本机通过 515 项单元和 103 项集成测试。同提交的 [Linux CI](https://github.com/Yunz93/Qingzhou/actions/runs/45924765644) 通过代码检查、测试和 Chromium 端到端验证。

同提交的[桌面验证](https://github.com/Yunz93/Qingzhou/actions/runs/45924802226)通过。两个 macOS 架构完成构建检查。Windows 在临时签名测试包构建步骤中执行安装和便携检查，并通过 WebView2 历史回放、草稿恢复、随包 Pi 的本机 Gemini 流式回复和应用内签名更新。作业按 `verify_only` 跳过正式发布。

## 返回需求与候选安装

在 533 × 600 窗口从全局会话按 Enter 返回需求，旧版本打开了正确的需求，但焦点丢失，下一次 Tab 到了「跳到正文」。修复后在两份独立资料里走完项目流程，返回时标题取得焦点，Tab 进入工作区。延迟加载详情时，已在另一控件中的输入、草稿和附件均得到保留。实际测试见 `tests/e2e/project-workflow.spec.ts`。

在隔离的 Applications 目录复现了旧脚本复制或签名失败、以及把安装目标本身当成源目录时丢失原应用的问题。修复后的 26 项安装脚本测试和本机完整单测（528 项通过、7 项按平台跳过）均通过。另用临时字符串验证正式打包的四种公私钥组合，只有两项均存在时才进入打包命令。
