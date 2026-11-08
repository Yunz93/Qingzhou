# 本轮依据

手工需求上下文，不是平台生成的确认或验收快照。

- 代码依据：`f4483190715b029516d2c09bd18e109bd1bd042b`。
- 实施工作区：`/Users/yunz/.codex/worktrees/mozi-ui-redesign/MyPi`。未复制原仓库的桌面包体相关未提交修改。
- 用户已在本对话确认 PRD v1 并允许实施及必要构建、测试；后续明确要求只保留支撑必要功能的最小页面元素。
- 使用 productize-app 组织产品、技术、行为、视觉和验证契约；ui 技能用于实现，product-design:audit 用于当前运行界面的截图与走查。
- 参考 markdown-press 当前源码与设计验收记录；工作区文件和本轮原生实拍优先于其旧版本截图。
- 本需求修改界面层及对应行为回归，不改共享协议和服务端业务逻辑；所有样例写入、确认和合入仅发生于隔离示例项目。

## 确切模块依据

以下为上述 commit 中的 Git 对象，不是新增平台版本：

- `100644 blob b48be3b630498c5ccb2d72af2ce9bbb7d88ab6f4	docs/modules/conversation.md`
- `100644 blob 11ce3a5694c983028ddb66e8609ddae80987a5f1	docs/modules/work-orchestration.md`
- `100644 blob 32d67b4613abc324af1bd50584b82381f99b09e2	docs/modules/requirement-design.md`
- `100644 blob 4101740b2c99f7a3904a55d8503965be6d3e933b	docs/modules/agent-runtime.md`
- `100644 blob 09e012e90b46059eadd41485963ac1b1e6d6fd4d	docs/modules/desktop.md`

完成后提案见 modules/ui-experience.md；主线模块文档只追加“已实施、待用户确认”的来路，不把本轮验收或合入写成既成事实。
