# AGENTS.md

给在这个仓库里工作的编程助手看的说明。写代码、改文件、执行命令时必须遵守。

先读 [文档导航](docs/README.md)、[项目概览](docs/project/overview.md)、[架构](docs/project/architecture.md)、[验证方式](docs/project/verification.md) 与 [Agent 工作流](docs/agents/workflow.md)。目录与文档权责见 [项目标准](docs/standards/project-layout.md)。

## 任务流

- 先识别阶段并说明目标。仅沟通或审查时不越界实施；用户明确要求实施、修复、改造，或工作台已启动的轮次，视为该范围的实施授权，不重复索要确认，也不只交计划就停。
- 只做已确认范围。先确认需求与具体 PRD 版本，再实施；设计变化同步 PRD 和模块提案，重新确认对应版本。超出授权范围或遇到新的产品语义取舍再与用户确认。
- 做完先自己复核（逻辑、语法、相关测试），不要把第一轮纠错丢给用户。
- 改动在用户最后确认前不算完成；改完直接说等确认，不要自行收尾。工作台执行轮次在实现并验证后即可按工作项流程收束，不要额外停在「请确认按此范围开始」。
- 没有下一步指令时，不要给超出任务范围的额外建议。

## 怎么说话

- 少说，只报必要的方案、改动和提示。
- 不要客套和情绪用语（「好的好的」「明白明白」「我知道了」「没问题」之类）。

## 怎么改

- 直接改仓库里的文件，不要只贴代码块让用户自己动手。
- 小改直接改。改动面大时先给方案，确认后再分步改，不要一次动大量文件。
- 回复里的代码块必须带语言标识。
- 总结改动时用 diff 说清楚：改前、改后、文件和行范围。

## 命令

- 安装、构建、测试等命令，只在用户明确允许后执行；既有授权在当前任务范围内持续有效，不重复询问。
- 高风险命令（如 `rm -rf`）先说明风险和步骤，分步询问，确认后再做。不确定是否有风险就先问。
- 禁止静默执行。命令必须在终端里可见，并回报结果。

## 工程习惯

- 缺依赖时安装报错里的包，并先看项目里同类包怎么用。
- 改完或跑测报错时自己根据日志排查，不要问「发生了什么」「怎么解决」。
- 用户已经指明改哪里时，直接改，不要反问「改哪里」「想达到什么目的」。
- 提交前再核一遍逻辑和语法。逻辑改动必须补测试并跑过。不要急着提交。

## 本仓库

- 用户可见文案用中文；代码标识符、提交说明、协议字段用英文。
- 改协议先改 `packages/protocol`，再 `pnpm --filter @qingzhou/protocol build`，然后改 server / web。
- 工作模式是「项目 + 需求 + 范围 / PRD 版本 + 执行记录 + 交付 / 验收 / 集成」。对话承载沟通和续做，需求与文档拥有独立生命周期。
- 实施前读取本轮 CONTEXT.md、PRD.md、相关模块基线和提案；遵守涉及路径下的 AGENTS.md。实施记录和验证记录同步维护，不能据此自行宣布通过。
- Agent 可编辑 PRD 正文、模块提案、实施与验证记录；不修改确认 ID、基线快照、人工验收、固化和合入事实。JSON 与 Markdown 有不同修改时先合并。
- 默认同一 Agent 连续推进各阶段。只有用户或适用规范明确要求并行 / 委派时才安排多个 Agent；并行需求使用独立工作区并交接确切版本。
- 长期模块文档维护当前设计、代码与测试位置和来源 PRD；未验收提案不覆盖当前设计，已固化 PRD 后续变更创建子需求。
- 改 UI 后尽量跑相关 e2e。CI 会跑 lint、typecheck、单测、集成测试，以及除 `visual workbench` 以外的 Playwright。

## 常用命令

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e --grep-invert "visual workbench"
```

## 发版

- 版本号写在各 `package.json`；服务端读取 `@qingzhou/server` 的 `package.json` 或 `QINGZHOU_VERSION`。
- 发布与应用内更新统一使用 GitHub `latest` 正式版，`main` 推送只跑 CI，不发布预发布包。安装脚本默认读取 latest，指定版本只接受正式版本号。
- 打 `vX.Y.Z` tag（与各 `package.json` 版本一致）会走 Release：macOS arm64、macOS x64（同机交叉编译）、Windows x64，并生成 `SHA256SUMS.txt`。发版前跑 lint / typecheck / unit / integration。
- 没有 Apple 公证。macOS 首次安装用 `scripts/install-macos.sh`，不要让用户双击 DMG。
- 桌面版应用内更新下载已校验的 zip / setup，校验失败就终止，不退回网站安装脚本。
