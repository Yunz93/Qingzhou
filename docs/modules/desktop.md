# 桌面与分发

Electron 将本机服务和 Web 界面提供给桌面用户。安装包包含 Pi 与所需工具；本机密钥不经过轻舟中转。

正式发行以 GitHub `latest` 为准，版本在各 `package.json` 中一致。`main` 推送运行 CI，不发布预发布包；正式标签触发发布。更新与安装验证下载校验信息，桌面包按目标平台构建。macOS 未做 Apple 公证，安装方式以 README 为准。

本轮目录标准不改发布流程与版本号。源代码基线为 `4bbada9`，本文不声明已进行本轮跨平台打包。

- 源码：`apps/desktop/`、`apps/server/src/setup/qingzhou-update.ts`、`scripts/`、`.github/workflows/`。
- 安装、更新、版本和平台限制见 [README](../../README.md)与 [AGENTS.md](../../AGENTS.md)。
- 回归按 [项目验证文档](../project/verification.md)执行；平台限定测试在相应环境验证。
