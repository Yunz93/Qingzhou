# 验证记录

日期：2026-10-22。基线：`0fdaacd`，Linux / Node 24.19.0 / Chromium。

- 原始选择器用例重复 3 次：2 通过、1 失败，复现“自动通过”回退。
- 新的延迟确认用例在旧实现失败：用户最新选择为代理，收到旧规划请求的结果后显示规划。
- 修复后延迟确认与原始选择器各重复 3 次，共 6 / 6 通过；类型检查通过。
- 补充最新保存失败、恢复已保存值和重试后刷新持久化用例。完整 `pnpm test:e2e` 一次运行 58 / 58 通过（4.5 分钟），生产构建通过。
- 最终错误处理补充网络断开 / 超时的统一反馈后，lint 和类型检查再次通过；保存失败 / 恢复 / 重试用例针对性补验 1 / 1 通过，生产构建再次通过。
- `pnpm test`：486 通过，3 个 Windows 专用用例在 Linux 跳过；`pnpm test:integration`：101 通过，1 个 Windows 安装子进程专用用例在 Linux 跳过。版本统一为 `0.1.28`。

日志：`/workspace/scratch/qingzhou-v0.1.27-selectors-recheck.log`、`qingzhou-policy-race-before.log`、`qingzhou-policy-race-after.log`、`qingzhou-policy-typecheck.log`。

本轮完整结果：`/workspace/scratch/qingzhou-v0.1.28-{unit,integration,e2e}.log`；最终静态检查：`qingzhou-v0.1.28-lint-final.log`、`qingzhou-v0.1.28-typecheck-final.log`；错误反馈补验：`qingzhou-v0.1.28-policy-final.log`。

`v0.1.27` 的主线与标签 CI 首轮分别出现核心发送状态等待、选择器回退失败。核心发送流程本地重复 3 次通过，补充就绪前提；选择器问题通过确定性回归修复。原 Release 已取消，未以“重跑后通过”替代该缺陷修复。

浏览器仍使用 fake Pi；原生平台检查、打包和发布结果以新标签的 Actions 与 Release 为准，不声称实机安装或真实模型已验证。

## 正式发布结果

- 发布提交：`f47be94b3cc9721f415fe8a53fd52e4cc33dac11`；正式标签：`v0.1.28`。发布时间：2026-10-22 16:09:37 UTC。
- [Release 工作流](https://github.com/Yunz93/Qingzhou/actions/runs/39809844557) 成功，macOS arm64、macOS x64、Windows x64 的检查 / 打包 / 上传及发布共四个任务全部通过。
- 发布提交的[主线 CI](https://github.com/Yunz93/Qingzhou/actions/runs/39809844090) 成功，含静态检查、单测、集成测试及云端浏览器回归。文档记录提交与已验证的发布提交分别保留。
- [正式 Release](https://github.com/Yunz93/Qingzhou/releases/tag/v0.1.28) 非草稿、非预发布，GitHub `latest` 已指向该版本，共 15 项下载资产。
- `SHA256SUMS.txt` 中的 13 项安装包、增量信息和脚本摘要与 GitHub 资产内容摘要逐项一致。实际下载更新清单、校验清单及两个安装脚本，并核对其文件哈希；macOS 安装脚本 `bash -n` 通过。
- 直接读取 `releases/latest/download/latest.json`，内容与本版本清单一致，版本为 `0.1.28`。三个桌面目标及对应别名共六个平台键的地址、版本和 SHA-256 均正确。
- 发布验证证据：`/workspace/artifacts/release-v0.1.28/verification.json`、`release.json`、`latest.json`、`updater-latest.json`、`SHA256SUMS.txt` 和两个安装脚本。未在本机安装或启动原生桌面包。
