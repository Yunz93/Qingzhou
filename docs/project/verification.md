# 轻舟验证方式

## 环境

Node.js 22 或以上，使用根 `package.json` 指定的 pnpm。安装前查看现有依赖和锁文件；用户的命令授权在任务范围内持续有效。UI 文案使用中文，协议字段和代码标识符使用英文。

## 常用检查

```bash
pnpm install
pnpm --filter @qingzhou/protocol build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e --grep-invert "visual workbench"
pnpm build
```

按改动选择必要验证。逻辑变化补行为回归，Git 编排使用真实临时仓库，界面变化尽量覆盖相关 Playwright 流程。首次通过后仅在新修改、失败或未解决疑点需要时重跑；不为增加数量重复同一检查。

## 测试边界

- Unit：协议、状态、路径、同步等确定性规则。
- Integration：真实临时 Git、服务状态、命令结果、持久化及恢复。
- E2E：fake Pi 驱动浏览器，覆盖交互、调度与版本关系，不验证真实模型的产品理解质量。
- Windows 安装限定用例在 Linux 跳过，跳过情况单独报告。

Playwright 使用独立测试数据目录和端口 `4310`；同一工作区不同时运行两次 E2E。其启动脚本构建生产包并重建专用测试数据，不指向日常应用数据。

## 每个需求的验证记录

记录需求与 PRD 版本、代码版本、工作目录、命令、真实结果、未覆盖项及证据位置。`VERIFICATION.md` 是说明，不自动把检查标为通过，也不自动生成用户验收。

最终报告包含改前 / 改后、关键文件、验证与限制。最终验收和合入须按平台流程或用户明确授权执行；未经授权不自行提交、推送或发版。
