# 桌面与分发 · Tauri 2 提案

来源为 [桌面迁移与界面重设计 PRD v2](../PRD.md)。现有实现见[桌面与分发](../../../modules/desktop.md)。新桌面页面、布局和主题见[界面模块提案](ui-experience.md)。

## 运行边界

Tauri 在 `apps/desktop/` 承载系统 WebView 和原生能力，先由 Rust 启动打包的 Node 服务，等受管理子进程确认实际监听地址后打开主窗口。保留 Fastify 承载 Web 生产资源及同源 HTTP / WebSocket 的路径，避免拆散下载、上传、终端和长连接。服务仅监听 `127.0.0.1`，由宿主和子进程建立一次性启动认证并交换会话。第一批实测 WKWebView 的本机连接和会话策略，第二批在 WebView2 复验。原生能力限制在主窗口和精确会话来源，拒绝任意环回端口、外部页面和未知来源。桌面 IPC 继续集中在 Web 平台适配层。 [Tauri Sidecar](https://v2.tauri.app/develop/sidecar/) · [Tauri Capabilities](https://v2.tauri.app/security/capabilities/)

系统菜单、打开路径、文件选择和通知经原生适配器调用。网页预览另开一个无桌面权限的原生 WebView 窗口，使用独立的网页会话，限制进入应用及应用服务来源。工作区保留前进、后退、刷新和用系统浏览器打开的入口。退出和安装触发共用服务关闭流程，刷新持久化并回收宿主管理的进程，出现错误时保留界面以便重试。崩溃恢复遵循服务现有中断语义。 [系统 WebView](https://v2.tauri.app/reference/webview-versions/) · [Tauri WebviewWindow API](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindowBuilder.html)

桌面启动时优先使用显式代理环境变量。macOS 由 CFNetwork 识别并解析系统 PAC，Windows 由 WinHTTP 查询自动代理。按旧版的服务地址顺序探测首选 HTTP 代理，解析限时两秒。没有可用的自动配置时读取手动系统代理。解析结果传给受管理本机服务和 Pi，也用于签名更新。代理设置修改后重启轻舟生效。签名更新保留本地地址和 `NO_PROXY` 的直连规则。

## 打包与更新

每个发布目标打包同架构的 Node、Pi 和原生依赖、审批扩展、PTY、fd、rg 以及 Web 资源。构建应固定依赖与下载校验，重用上一轮已验证的源码映射与编译输入过滤。Windows 使用随系统维护的 WebView2，安装时补齐缺失运行时。 [Windows 安装器](https://v2.tauri.app/distribute/windows-installer/)

保留应用标识 `com.qingzhou.desktop`、现有安装路径与正式渠道。首个切换版同时产出旧客户端可识别的校验文件与新客户端的签名更新资产。Tauri 更新公钥进入配置，签名私钥由发布环境提供。升级验证包含进程退出顺序、旧客户端来源校验、候选签名、安装失败及启动后的数据读取。 [Tauri 更新器](https://v2.tauri.app/plugin/updater/)

产品名为墨问（Mowen）。macOS 新安装使用 `Mowen.app`，旧版在当前路径原位替换。旧版 Electron 应用内更新需要的 ZIP 保留 `Qingzhou.app` 归档入口。Windows 用 Mowen 安装登记显示产品名，从已登记的旧 NSIS 目录升级时保留原目录及可执行文件路径。

macOS 安装脚本在目标卷内复制并签名，再换入新应用。复制或签名失败时仍能打开原有安装。新应用在最终安装路径登记。正式标签构建在打包前分别检查更新公钥和签名私钥。

Windows 使用 NSIS 当前用户安装登记决定安装器的目标目录。宿主只在登记目录与运行目录一致时下载并执行签名安装包。便携 ZIP 沿用同一更新检查入口，新版本可从设置和提示下载，退出应用后解压到便携目录。
