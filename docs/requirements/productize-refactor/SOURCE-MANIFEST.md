# 实施源码快照

日期：2026-11-08。手工校验清单，不是平台版本或用户验收事实。

- Git 基线 f4483190715b029516d2c09bd18e109bd1bd042b，叠加此前 UI / DeepSeek 修复和本轮重构。
- 本清单包含全部 44 个变更源码/测试文件；不含文档、运行资料、构建产物、独立样例或凭据。
- 进入本轮时的 29 文件快照见 INCOMING-MANIFEST.md。其中 23 个文件内容完全保留，6 个因本轮范围继续修改；另有原本未修改的 2 文件和新建的 13 文件纳入当前清单。
- SHA-256：`9098cf4c8b639bd66d7bc16d37bd8f0930f8b6c0915f0ecaa3b3c4509b42985d`。按路径排序，路径、NUL、文件 SHA-256、换行拼接后计算。
- 完整 lint、类型检查、499 项单测及 59 项 E2E 首轮完成后，仅补充空字符串草稿边界与项目响应回归；末次 9 项单测和 4 项 E2E 通过，并重新构建 protocol/web/server。服务端源码在 80 项集成通过后未再改变。

| 文件 | SHA-256 |
| --- | --- |
| `apps/server/src/tasks/workflow-command-runner.ts` | `473403446c14393ca2eed84f3cd3780c1d3257ba5cbb24d4d3a5f368cb416dfb` |
| `apps/server/src/tasks/workflow-service.ts` | `9e08a653fa961abe4581e4f4c4e97ce3c125ad09b59178a18591d7ea2448df93` |
| `apps/web/src/components/board/ChatToRequirementDialog.tsx` | `297a9c3db1e2b1abd3fdfbde8dfe37ee19b5805ef075c80171a5313301507be7` |
| `apps/web/src/components/board/DeliveryAcceptanceActions.tsx` | `71791de8eb907bcea1c86040e141c5b2b073eab1f7f023c20673145e5084de3a` |
| `apps/web/src/components/board/IntegrationReview.tsx` | `fd59344589ceb144d6a92db11928395faa6079d3e3b809ea4160309e8e60f082` |
| `apps/web/src/components/board/NewWorkProjectDialog.tsx` | `abf4d55e0953cc5e529fcf68a3b5c597c84516de01a64c52daffe1ba79d3b66d` |
| `apps/web/src/components/board/ProjectWorkflow.tsx` | `b4cf6435ed27fd9cfd7f4e5592dcdd93efd24eb9440b9a78868a775557d85446` |
| `apps/web/src/components/board/RequirementDesign.tsx` | `236efbc246bc5182ef89283238aa3ce622fd07f9937feb6e70bf846d72abf09d` |
| `apps/web/src/components/board/RequirementWorkflow.tsx` | `9661a1f663d8846515c33726e98eb6125b00f367f72bf593b4301967e119a637` |
| `apps/web/src/components/board/RequirementWorkroom.tsx` | `76afa2506eea53105cab15712125baf87716ed12c3ef478ecea75e89720a5648` |
| `apps/web/src/components/board/VerificationDetails.tsx` | `c1bb0c02e179291f7713d38fe54f62c6a12931a06ca8eee229dddeb87bde5060` |
| `apps/web/src/components/board/WorkConversationDrawer.tsx` | `c7f3b067e68b503acf81896fe97f6d02e76ffb182cf18a0ad4fa1c543fefca0f` |
| `apps/web/src/components/board/WorkflowDashboard.tsx` | `e865a96fc244417264a2934e41728311cdb7413ee28d59b11aa2157f4f22c26d` |
| `apps/web/src/components/board/WorkflowSettings.tsx` | `3485398996c25f3f6f62d6355499b322b9b9cad93fe62e80f8a474d11a17ce4d` |
| `apps/web/src/components/board/WorkflowTabs.tsx` | `f9061009f0679e4d1d3231d63b477efa369113ea84182fea05b7d65bb83c7a87` |
| `apps/web/src/components/composer/ComposerCapsules.tsx` | `db94de56f603ef298d7ee13051434666b75e5c3f6f18738d18499e248e74de4b` |
| `apps/web/src/components/composer/PromptComposer.tsx` | `59a104aeb27d4a17b26cbdbfb5fcc06bfb64b5d9f4e9ecb50ba47c41bb37bcb9` |
| `apps/web/src/components/setup/FolderField.tsx` | `4c102a16370663448a5c17bcd641108a600b01c2986c0587a7ddb30031a5e0a9` |
| `apps/web/src/components/setup/FolderPicker.tsx` | `1f03aa389f850ab7ebde430b372b7fe3d6ed2246e9fff46fa591cb06eee11fe6` |
| `apps/web/src/components/setup/SetupWizard.tsx` | `51d24bc61bf7e8382dd5068b6284b7379f95a89ce7d87fbf6c2f928c07789982` |
| `apps/web/src/components/tasks/NewTaskDialog.tsx` | `762a8fd6b49594cca2cb918018344daaf7efe6707600737e8a902b84514390f6` |
| `apps/web/src/components/timeline/ConversationTimeline.tsx` | `56c05b148cb68157fc4ddb38f7013c0c2d08bed9c73b269933e70cbf75098ba4` |
| `apps/web/src/hooks/usePrdDraft.ts` | `5a04f1f84a151e05fa7c0cbd270caa11599eebd6466228c0a210e386d089947c` |
| `apps/web/src/hooks/useProjectWorkflow.ts` | `0fb6d3e7dd5028d519740048dd90c518104fe5a6d267d5992d02c207460e9992` |
| `apps/web/src/hooks/useWorkflowAction.ts` | `fee4a5ca51f4fee61a433b04c7387e1d2084a2b490e411564448c0edef4af574` |
| `apps/web/src/layouts/WorkbenchLayout.tsx` | `a5ab434b7a151d18b7532a3a178f174e2e43bf1db430d1f30b73446e9578b102` |
| `apps/web/src/lib/prd-draft.ts` | `0e88162d3cd7be92bb78471c0c5c51feb0c87c817401450863dde90a4836555f` |
| `apps/web/src/lib/requirement-planning.ts` | `67b9d5be4baddca916cfd15c0877ecf60e72ba7546ddc368b36d3cb27cd3d707` |
| `apps/web/src/lib/workflow-presentation.ts` | `dc80070fa1256b6ac4a67687858b74dad3a2a8b3b35e7d8efd9db68f729ea4af` |
| `apps/web/src/pages/BoardPage.tsx` | `c97e353bb139cbcf9d74ada19acb9a094eb738fca8b2ba2f23e6c762c41b2590` |
| `apps/web/src/pages/SettingsPage.tsx` | `478305e9fd5e5aeac54e670d7b2075c3ed3e8b66979bc40649ff3da587c3cc38` |
| `apps/web/src/styles/app.css` | `ef6b4232526343a51276e2b38de5c521ac1af5231036a95bcbfd2f7ee441d1fb` |
| `apps/web/src/styles/workflow.css` | `dba93b7a801b8f1009984f5ca9754a2c876ec9f0e433a0de56768f456ec74a8e` |
| `packages/protocol/src/design.ts` | `8c08317c32fbc5cee7699d250a124eacbd9695177d035e76e19559d68393d8ea` |
| `packages/protocol/src/interaction-policy.ts` | `dbd2ca92977f3be4837683f456b89ff113052f2a7c4e92e73fc997fc076176aa` |
| `tests/e2e/frontend-interactions.spec.ts` | `c489b0f7f6b5bfa0085535165c7fb5dbb6a03b63c6f3602af6bd1a58e9774171` |
| `tests/e2e/project-workflow.spec.ts` | `12c89ab9eff062f24fa3761f927d16c1ec5f44c7980277333224525e156fef7b` |
| `tests/e2e/workbench.spec.ts` | `2fdc1f4da0daf80f16441b00b2266d76c6e4f39285a7abc7c4f1433dd4dab6a2` |
| `tests/unit/design-proposal.test.ts` | `accce231b4f22b4c49ade310ecad44b2a520e4d15f2b37cb3f11ff49011f6a86` |
| `tests/unit/frontend-ux.test.ts` | `a7b453517444d7f89cc53641754da6a3a22769f1a2e55a462be1815ce7b5f358` |
| `tests/unit/interaction-policy.test.ts` | `76305af113b2fa89e38388eaded2b0fc63413f08f36d07d5adc8b4ad22f15370` |
| `tests/unit/prd-draft.test.ts` | `94bb52b7d9c04f07a06eadf79b254bdcfd615b69a5f3e002dfbef3450466aceb` |
| `tests/unit/work-board-ui.test.ts` | `bd9597969e11aea83ab68ff9c0c85e43ac49209632863e654af4e49f7c32293a` |
| `tests/unit/workflow-command-runner.test.ts` | `3c0896b3b9619994f326183f1d0af3d7d6bca4001a6f840e26a67f29cca06e2d` |
