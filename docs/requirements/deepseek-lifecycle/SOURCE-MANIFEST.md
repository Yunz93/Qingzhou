# 当前源码快照

手工校验清单，不是平台确认、验收或已合入事实。2026-11-04。

- 基线：`f4483190715b029516d2c09bd18e109bd1bd042b`。
- 包含此前 mozi-ui-redesign 的前端改动，以及本轮真实 DeepSeek 修复后的所有变更源码和测试；不含文档、产物、运行数据与独立样例。
- 父需求历史快照 `ec37f7a2fdc9e3a2f00b4c898ef5c95a7b4140f743b816adb52f3472a703d2b8` 保留，本清单描述叠加后的当前文件。
- 本轮新修复涉及协议 2 文件、服务端 1 文件、前端 2 文件；本轮测试变更为 design-proposal、interaction-policy、frontend-interactions、workbench。
- 最终 lint / typecheck / 489 项单测 / 6 项 E2E 均针对本清单源码；其后仅补充手工记录与独立样例证据。
- 文件数：29；快照 SHA-256：`2e2906045d80dcb08d6ef9282b67da6caffae82c77c91957909fb5a1416c3eac`（按路径排序，将路径、NUL、文件 SHA-256、换行拼接再计算）。

| 文件 | SHA-256 |
| --- | --- |
| `apps/server/src/tasks/workflow-service.ts` | `ca2993139373a80c83db9ec76f2b06cde6363a01cc017b92cd4ba58f378d7733` |
| `apps/web/src/components/board/ChatToRequirementDialog.tsx` | `297a9c3db1e2b1abd3fdfbde8dfe37ee19b5805ef075c80171a5313301507be7` |
| `apps/web/src/components/board/NewWorkProjectDialog.tsx` | `abf4d55e0953cc5e529fcf68a3b5c597c84516de01a64c52daffe1ba79d3b66d` |
| `apps/web/src/components/board/ProjectWorkflow.tsx` | `9009e4d925bb3015236f0ad52fd9e8b3dab098644ac4040433bf24eb5fdb0d07` |
| `apps/web/src/components/board/RequirementDesign.tsx` | `09b6ed7d9e7786e2d115fd661ae38e65e5b457359a5a0af13dc34f551edefd51` |
| `apps/web/src/components/board/RequirementWorkroom.tsx` | `e13e1ff2bcfe66e898bd490f734f0a6bf15934a64c6d942e78c9df19c4c8fc6c` |
| `apps/web/src/components/board/WorkConversationDrawer.tsx` | `c7f3b067e68b503acf81896fe97f6d02e76ffb182cf18a0ad4fa1c543fefca0f` |
| `apps/web/src/components/board/WorkflowTabs.tsx` | `f9061009f0679e4d1d3231d63b477efa369113ea84182fea05b7d65bb83c7a87` |
| `apps/web/src/components/composer/ComposerCapsules.tsx` | `db94de56f603ef298d7ee13051434666b75e5c3f6f18738d18499e248e74de4b` |
| `apps/web/src/components/composer/PromptComposer.tsx` | `59a104aeb27d4a17b26cbdbfb5fcc06bfb64b5d9f4e9ecb50ba47c41bb37bcb9` |
| `apps/web/src/components/setup/FolderField.tsx` | `4c102a16370663448a5c17bcd641108a600b01c2986c0587a7ddb30031a5e0a9` |
| `apps/web/src/components/setup/FolderPicker.tsx` | `1f03aa389f850ab7ebde430b372b7fe3d6ed2246e9fff46fa591cb06eee11fe6` |
| `apps/web/src/components/setup/SetupWizard.tsx` | `51d24bc61bf7e8382dd5068b6284b7379f95a89ce7d87fbf6c2f928c07789982` |
| `apps/web/src/components/tasks/NewTaskDialog.tsx` | `762a8fd6b49594cca2cb918018344daaf7efe6707600737e8a902b84514390f6` |
| `apps/web/src/components/timeline/ConversationTimeline.tsx` | `56c05b148cb68157fc4ddb38f7013c0c2d08bed9c73b269933e70cbf75098ba4` |
| `apps/web/src/layouts/WorkbenchLayout.tsx` | `a5ab434b7a151d18b7532a3a178f174e2e43bf1db430d1f30b73446e9578b102` |
| `apps/web/src/pages/BoardPage.tsx` | `11e90a799fabade0c4cfdb22cdbb7c3d377b498d81af378a14b0eb700d61e037` |
| `apps/web/src/pages/SettingsPage.tsx` | `478305e9fd5e5aeac54e670d7b2075c3ed3e8b66979bc40649ff3da587c3cc38` |
| `apps/web/src/styles/app.css` | `ef6b4232526343a51276e2b38de5c521ac1af5231036a95bcbfd2f7ee441d1fb` |
| `apps/web/src/styles/workflow.css` | `dba93b7a801b8f1009984f5ca9754a2c876ec9f0e433a0de56768f456ec74a8e` |
| `packages/protocol/src/design.ts` | `8c08317c32fbc5cee7699d250a124eacbd9695177d035e76e19559d68393d8ea` |
| `packages/protocol/src/interaction-policy.ts` | `dbd2ca92977f3be4837683f456b89ff113052f2a7c4e92e73fc997fc076176aa` |
| `tests/e2e/frontend-interactions.spec.ts` | `c489b0f7f6b5bfa0085535165c7fb5dbb6a03b63c6f3602af6bd1a58e9774171` |
| `tests/e2e/project-workflow.spec.ts` | `a05ef774c5cb9cf978dee809fc6375e0c79156950f93cb960f257682c878ac1d` |
| `tests/e2e/workbench.spec.ts` | `2fdc1f4da0daf80f16441b00b2266d76c6e4f39285a7abc7c4f1433dd4dab6a2` |
| `tests/unit/design-proposal.test.ts` | `accce231b4f22b4c49ade310ecad44b2a520e4d15f2b37cb3f11ff49011f6a86` |
| `tests/unit/frontend-ux.test.ts` | `a7b453517444d7f89cc53641754da6a3a22769f1a2e55a462be1815ce7b5f358` |
| `tests/unit/interaction-policy.test.ts` | `76305af113b2fa89e38388eaded2b0fc63413f08f36d07d5adc8b4ad22f15370` |
| `tests/unit/work-board-ui.test.ts` | `bd9597969e11aea83ab68ff9c0c85e43ac49209632863e654af4e49f7c32293a` |
