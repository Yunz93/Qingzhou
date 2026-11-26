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

最终产品源码为 `aa3559f`。实际 WKWebView 的 Gemini 截图和请求计数在 `.qingzhou-test/mowen-029-layout-final/mowen-gemini-wk-vqUfS2/`。Apple 芯片原位升级记录在 `.qingzhou-test/official-028-to-029.gwXDhH/verified.json`，Intel 包的 Rosetta 启动结果在 `.qingzhou-test/layout-intel-rosetta.auMdlH/verified.json`。六份成品校验清单位于本机 `apps/desktop/release/SHA256SUMS.txt`。

Linux 首轮在保存未确认需求后，测试同时匹配了看板卡片和待处理清单里的同名标题。断言已指定可点击的需求卡片。产品源码和桌面成品与 `aa3559f` 相同。

2026-11-27 核对最终结果。[完整 CI](https://github.com/Yunz93/Qingzhou/actions/runs/45858762510) 在 `ad51ac1` 通过 lint、类型检查、Linux 单元 504 项、集成 103 项和 Chromium 74 项；Linux 单元按平台跳过 13 项，集成跳过 1 项。[桌面验证](https://github.com/Yunz93/Qingzhou/actions/runs/45857166917) 在 `aa3559f` 的 macOS arm64、macOS x64 和 Windows x64 三个作业均通过。Windows 实测包括安装与卸载、便携启动、原位迁移 v0.1.28、旧项目历史回放、断线草稿恢复、真实 Pi 对接本机 Gemini 模拟服务和应用内签名更新。

本轮交付候选包，正式发布仍待人工决定。验证使用临时更新密钥，核对时正式仓库变量 `QINGZHOU_TAURI_UPDATE_PUBKEY` 尚未设置。
