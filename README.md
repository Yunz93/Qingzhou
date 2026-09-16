# 轻舟 / Qingzhou

本机运行的 [Pi](https://pi.dev) 编程助手。API 密钥只存在这台电脑上，改文件或跑命令前会先问你。

免费开源（MIT）。没有 Apple 开发者证书，也没有公证。**macOS 请用下面的安装脚本**，不要双击 GitHub 上的 `.dmg`——系统会提示无法验证开发者。

## 安装

**macOS（推荐）**

支持 Apple 芯片（arm64）和 Intel（x64）。GitHub Release 同时提供两种 macOS 包；也可用 `--build` 在本机打包。

打开「终端」，粘贴后回车：

```bash
curl -fsSL https://github.com/Yunz93/Qingzhou/releases/latest/download/install-macos.sh | bash
```

脚本会下载应用、拷到 `/Applications`、去掉隔离属性、在本机做 ad-hoc 签名，然后打开轻舟。

开发中的每日构建：

```bash
curl -fsSL https://github.com/Yunz93/Qingzhou/releases/download/nightly/install-macos.sh | bash -s -- --nightly
```

若仍无法打开：系统设置 → 隐私与安全性 → 仍要打开。或再跑一次：

```bash
bash <(curl -fsSL https://github.com/Yunz93/Qingzhou/releases/latest/download/install-macos.sh) --trust-only /Applications/Qingzhou.app
```

**Windows（PowerShell）**

```powershell
irm https://github.com/Yunz93/Qingzhou/releases/latest/download/install-windows.ps1 | iex
```

装好后打开轻舟，粘贴 API Key，选一个工作文件夹。密钥保存在 `~/.pi/agent/auth.json`，界面里不会再显示完整密钥。对话会发给你选择的 AI 服务商，不会经过轻舟的服务器。

### 发布稳定版

```bash
git tag v0.1.19
git push origin v0.1.19
```

这会跑 `.github/workflows/release.yml`，上传安装包、安装脚本、`SHA256SUMS.txt` 和 `latest.json`。日常 `main` 推送会更新 `nightly` 预发布。安装脚本会校验清单（旧版本没有清单时只警告）。

## 开发者

从仓库本地安装：

```bash
bash scripts/install-macos.sh --nightly   # 下载 GitHub 包
bash scripts/install-macos.sh --build     # 本机打包再安装
bash scripts/install-macos.sh --user      # ~/Applications，不需要管理员
bash scripts/install-macos.sh --trust-only /Applications/Qingzhou.app
```

本机打包（在对应系统上）：

```bash
corepack enable
pnpm install
pnpm desktop:pack:mac   # → apps/desktop/release/Qingzhou-mac-*.dmg
pnpm desktop:pack:win   # → apps/desktop/release/Qingzhou-win-*-setup.exe
```

打包时会带上 Pi，用户不必再装 Node。

浏览器开发模式：

```bash
pnpm install
cp .env.example .env
pnpm dev                 # http://127.0.0.1:5173
pnpm dev:stable          # 关闭热重载；用本仓库当工作区跑任务时用这个
pnpm desktop:dev         # Electron + web
```

不要把「正在 `pnpm dev` 的轻舟源码目录」同时设成任务工作区：改文件会触发 Vite / `tsx watch` 重启，正在跑的会话会被打断。要么换一个工作文件夹，要么用 `pnpm dev:stable`。

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
| `QINGZHOU_PI_ENTRY` | （桌面版会设置） | 用 Node/Electron 跑的 Pi CLI |
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
- 界面里可随时切换审批策略：每次确认 / 自动改文件 / 自动审核 / 只读
- `QINGZHOU_MUTATIONS=disabled` 时拒绝所有改动
- macOS 安装包目前**没有** Apple 公证；信任由安装脚本在本机完成
