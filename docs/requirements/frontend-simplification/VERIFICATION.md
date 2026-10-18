# 前端信息精简验证

状态：自检通过，待用户验收。

- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm test:e2e --grep-invert 'visual workbench'`：46/46 通过，包含生产构建。键盘修复后再次全量通过。
- 最终补充设置往返草稿保护与总览截图后，执行 `pnpm test:e2e tests/e2e/project-workflow.spec.ts --grep 'project workflow seals|project standards preview|structured discussion proposals'`：3/3 通过，包含最终生产构建。
- `git diff --check`：通过。
- 本轮文档的相对 Markdown 链接：73 项检查通过，无失效路径。

新增浏览器断言覆盖运行详情键盘展开与收起、零排队统计不占位、空风险/产物栏目隐藏、非空风险和已登记产物预览、历史提案可回看且不能再采用、详情到 PRD 正文的 Tab 顺序、已保存候选复审收起且可再编辑。原流程继续验证乱序合入、PRD 迭代与固化、模块基线、Markdown 同步以及手机布局。

设置往返的首次定向回归发现焦点未回到入口，已修复并重跑通过；并发设置的未保存值会保留，关闭父窗口后焦点回到项目设置入口。

已核对本轮生成的总览桌面与 390px 手机截图、PRD 桌面与 375px 手机截图、模块页、交付页和项目规范预览。最终三项回归保留 `project-list.png`、`project-overview-mobile.png`、`structured-design-proposal.png`、`project-standard-preview.png` 与 Markdown 同步截图，位于 Playwright 的 `test-results/` 对应测试输出目录，未加入版本控制。

浏览器连接不可用，本轮以组件审查、项目已有 Playwright 回归和生成截图验证；未进行独立浏览器探索或完整无障碍审计。
