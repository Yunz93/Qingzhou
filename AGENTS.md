# AGENTS.md

给在这个仓库里工作的编程助手看的说明。写代码、改文件、执行命令时必须遵守。

## 任务流

- 动手前先用几句话说明任务目标，等用户确认后再改。
- 确认之后只做已确认的范围，按用户指令执行。
- 做完先自己复核（逻辑、语法、相关测试），不要把第一轮纠错丢给用户。
- 改动在用户最后确认前不算完成；改完直接说等确认，不要自行收尾。
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

- 安装、构建、测试等命令，只在用户明确允许后执行。
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
- 工作模式是「项目 + 任务 + 执行记录」：对话是单点会话，任务有生命周期，结束后才能再追加。
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
- 打 `vX.Y.Z` tag 会走 Release：macOS arm64、macOS x64（同机交叉编译）、Windows x64，并生成 `SHA256SUMS.txt`。发版前跑 lint / typecheck / unit / integration。
- 没有 Apple 公证。macOS 首次安装用 `scripts/install-macos.sh`，不要让用户双击 DMG。
- 桌面版应用内更新下载已校验的 zip / setup，校验失败就终止，不退回网站安装脚本。
