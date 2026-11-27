# 墨问 / Mowen

墨问是本机运行的 Pi 编程助手。你可以与模型对话，也可以在项目里把需求推进到设计、实施和验收。改文件和运行命令遵循当前会话的审批策略。[Pi 项目](https://pi.dev)

免费开源（MIT）。没有 Apple 开发者证书，也没有公证。**macOS 请用下面的安装脚本**，不要双击 GitHub 上的 `.dmg`——系统会提示无法验证开发者。

## 安装

**macOS（推荐）**

支持 Apple 芯片（arm64）和 Intel（x64）。GitHub Release 同时提供两种 macOS 包；也可用 `--build` 在本机打包。

打开「终端」，粘贴后回车：

```bash
curl -fsSL https://github.com/Yunz93/Qingzhou/releases/latest/download/install-macos.sh | bash
```

脚本会下载应用、拷到 `/Applications`、去掉隔离属性、在本机做 ad-hoc 签名，然后打开墨问。

若仍无法打开：系统设置 → 隐私与安全性 → 仍要打开。或再跑一次：

```bash
bash <(curl -fsSL https://github.com/Yunz93/Qingzhou/releases/latest/download/install-macos.sh) --trust-only /Applications/Mowen.app
```

**Windows（PowerShell）**

```powershell
irm https://github.com/Yunz93/Qingzhou/releases/latest/download/install-windows.ps1 | iex
```

装好后打开墨问，粘贴 API Key，选一个工作文件夹。密钥保存在 `~/.pi/agent/auth.json`，界面里不会再显示完整密钥。对话会发给你选择的 AI 服务商，不会经过墨问的服务器。

Windows 便携版会提示新版本。更新时退出墨问，将新版便携 ZIP 解压到正在使用的目录。

### 连接 Google Gemini

1. 打开墨问的首次配置，或从「设置 → 账号与认证」选择 API Key 和 Google Gemini。可从界面打开 [Google AI Studio](https://aistudio.google.com/apikey) 创建密钥。
2. 粘贴密钥。点击「测试连接」会向 Google 读取模型目录。保存密钥并选好工作文件夹后即可进入对话。
3. 在输入框下方的模型选择器选中 Google 的 Gemini 模型，然后发送消息。生成请求使用你自己的 Google 项目和配额。

如果 Pi 已通过环境变量 `GEMINI_API_KEY` 配置凭据，墨问会标出来源，可直接使用现有连接。[Google 密钥说明](https://aistudio.google.com/docs/api-key)

如果 Pi 的 `models.json` 配置了自定义 Google 服务，先核对界面列出的接收地址，再保存该服务的密钥。对话会按模型配置发往相应地址。官方模型目录的连接测试仅在使用 Google 官方地址时提供。

### 发布稳定版

先同步所有 `package.json`、Tauri 配置和 Cargo 的版本号并更新 `CHANGELOG.md`，再创建对应的正式版本标签：

```bash
git tag v0.1.29
git push origin v0.1.29
```

这会跑 `.github/workflows/release.yml`，上传安装包、安装脚本、`SHA256SUMS.txt`、旧版升级清单 `latest.json` 和 Tauri 签名更新清单 `tauri-update.json`。正式版本会设为 GitHub `latest`。更新签名使用仓库变量 `QINGZHOU_TAURI_UPDATE_PUBKEY` 及发布环境中的 `TAURI_SIGNING_PRIVATE_KEY`。`main` 推送只运行 CI。安装脚本会校验清单（旧版本没有清单时只警告）。

合入前可手动运行 Release 工作流并勾选 `verify_only`。两个 macOS 架构运行 lint、类型检查、单元和集成测试及 Rust 编译检查。Windows 运行归档和原生单测，并使用临时更新密钥验证安装、便携启动、旧版升级、WebView2 和应用内签名更新。正式标签构建另需配置更新签名密钥。macOS 正式包还会检查内置 fd 和 rg 的架构。

## 项目与 Agent 协作

业务和技术文档从 [docs/README.md](docs/README.md) 开始；目录标准见 [项目标准结构](docs/standards/project-layout.md)，Agent 规则见 [AGENTS.md](AGENTS.md)。需求按范围确认、PRD 确认、实施迭代、验收固化推进，模块文档关联各次子需求。

## 开发者

从仓库本地安装：

```bash
bash scripts/install-macos.sh             # 下载 latest 正式版
bash scripts/install-macos.sh --local --user  # 安装本地候选到 ~/Applications
bash scripts/install-macos.sh --build     # 本机打包再安装
bash scripts/install-macos.sh --user      # ~/Applications，不需要管理员
bash scripts/install-macos.sh --trust-only /Applications/Mowen.app
```

Windows 本地候选位于 `apps/desktop/release`。运行 `Qingzhou-win-x64-setup.exe` 安装；要试用便携版，解压同目录的 `Qingzhou-win-x64-portable.zip`。该目录的 `SHA256SUMS.txt` 列出各候选包摘要。

本机开发和打包需要 Node.js 22.19 或以上与 Rust 工具链。

```bash
corepack enable
pnpm install
pnpm desktop:pack:tauri  # → apps/desktop/release 下的本机架构安装包
```

桌面包自带 Node、Pi 和搜索工具。运行界面使用 macOS WKWebView 或 Windows WebView2。

分发包中的 `runtime` 目录包含项目与 Node 的许可证、`pi/LICENSE`、搜索工具的 `tools/licenses`，以及原生宿主和本地服务的第三方声明。前端依赖声明位于 `runtime/web/THIRD-PARTY-LICENSES.md`。macOS 上的 `runtime` 位于应用包的 `Contents/Resources` 下。

macOS 可用 `QINGZHOU_CROSS_WINDOWS=1 pnpm desktop:pack:win` 生成 Windows x64 候选。交叉构建需要 `x86_64-pc-windows-msvc` Rust 目标、`cargo-xwin`、Clang、LLD 和 NSIS。安装、便携启动及 WebView2 联调在 Windows 上验证。

浏览器开发模式：

```bash
pnpm install
cp .env.example .env
pnpm dev                 # http://127.0.0.1:5173
pnpm dev:stable          # 关闭热重载；用本仓库当工作区跑任务时用这个
pnpm desktop:dev         # Tauri 宿主与本机服务，默认使用工作区内的 .qingzhou 资料
```

服务端口被占用时，可用 `PORT=4378 pnpm dev` 同时调整本机服务和 Vite 的代理目标。

不要把「正在 `pnpm dev` 的墨问源码目录」同时设成任务工作区：改文件会触发 Vite / `tsx watch` 重启，正在跑的会话会被打断。要么换一个工作文件夹，要么用 `pnpm dev:stable`。

可选：不走桌面包时，把 Pi 装到 PATH。浏览器开发模式的设置向导也可以点「安装 Pi」，直接运行官方脚本：

```bash
curl -fsSL https://pi.dev/install.sh | sh
```

或：

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
pi --version
```

生产 web 服务：

```bash
pnpm build
NODE_ENV=production pnpm start   # http://127.0.0.1:4310
```

### 环境变量

| 变量 | 默认 | 含义 |
|------|------|------|
| `HOST` / `PORT` | `127.0.0.1` / `4310` | 服务监听地址（默认本机；环回会话 cookie 约 12 小时滑动过期） |
| `PI_BIN` | `pi` | PATH 上的 Pi |
| `QINGZHOU_PI_ENTRY` | （桌面版会设置） | 用独立 Node 运行的 Pi CLI |
| `QINGZHOU_DATA_DIR` | `~/.qingzhou` | 会话和设置 |
| `QINGZHOU_ALLOWED_ROOTS` | 家目录或向导所选文件夹 | 允许访问的根目录 |
| `QINGZHOU_MUTATIONS` | `approval` | `approval` 或 `disabled` |
| `QINGZHOU_MAX_PROCESSES` | `5` | 同时运行的 Pi 进程数 |
| `QINGZHOU_REPO` | `Yunz93/Qingzhou` | 安装脚本下载用的仓库 |

仍识别旧的 `MOWEN_*` / `OHMYPI_*` 变量，以及 `~/.mowen`、`~/.ohmypi` 数据目录。`.env` 会自动加载。真正的环境变量优先于 `.env`。

### 常用命令

```bash
pnpm test
pnpm test:integration
pnpm doctor
pnpm desktop:install:mac
```

## 安全

- 默认只监听本机
- 禁止写入 `.env`、`.ssh` 和 Pi 的 `auth.json`
- 默认开启「自动审核」：改文件和普通命令自动放行，高危命令（`sudo`、`rm -rf`、磁盘格式化、`curl | sh`、强制推送等）仍需你确认
- 界面里可随时切换审批策略：只读 / 每次确认 / 自动审核 / 自动通过；自动通过也会放行高危命令，已有「自动改文件」配置保持原行为
- `QINGZHOU_MUTATIONS=disabled` 时拒绝所有改动
- macOS 安装包目前**没有** Apple 公证；信任由安装脚本在本机完成
