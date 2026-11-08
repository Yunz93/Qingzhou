# 验证记录

状态：本轮实施和自测完成，待用户确认。全部命令经用户“确认 v1，实施并验证”授权，在独立工作区执行。此记录不生成平台验收、固化或合入事实。

## 确切范围

- 工作区：`/Users/yunz/.codex/worktrees/mozi-ui-redesign/MyPi`。
- 基线：`f4483190715b029516d2c09bd18e109bd1bd042b`；实现为未提交工作区，文件 SHA-256 见 [SOURCE-MANIFEST.md](SOURCE-MANIFEST.md)。
- 最后一轮完整 E2E 启动后应用源码未再变更；仅修订三个测试的旧界面预期和等待时限，再对这三个用例复验。其后只补文档。
- 没有修改协议、服务端业务或桌面配置，未另跑无关服务集成套件；E2E 实际运行构建后的协议、前端和服务端，并使用真实 Git 与检查进程。

## 命令与结果

日志目录：[.qingzhou-test/mozi-ui-redesign](../../../.qingzhou-test/mozi-ui-redesign/)。

| 命令 | 结果 | 日志 |
| --- | --- | --- |
| `pnpm install --offline --frozen-lockfile` | 成功，复用 636 个缓存包，无新依赖和锁文件修改 | 本轮终端输出 |
| `pnpm lint` | 最终退出码 0 | `lint-final.log` |
| `pnpm typecheck` | protocol/server/web/desktop 全部通过 | `typecheck-final.log` |
| `pnpm test` | 94 个测试文件通过，486 项通过；Windows 安装相关 3 项在 macOS 跳过 | `unit-final-all.log` |
| `pnpm --filter @qingzhou/desktop build` | main/preload 构建成功 | 本轮终端输出 |
| `QINGZHOU_E2E_PORT=4311 pnpm test:e2e --grep-invert 'visual workbench'` | 共 56 项，53 通过、3 失败；下列修订后定向复验 | `e2e-final-minimal.log` |
| `QINGZHOU_E2E_PORT=4311 pnpm test:e2e --grep 'an incomplete requirement\|project standards preview\|four requirement tabs'` | 3 项全部通过，43.0 秒 | `e2e-final-recheck.log` |
| `git diff --check` | 通过 | 本轮终端输出 |

完整命令确实返回非零，没有把分次通过写成一次完整套件全绿。当前应用快照对应 56 项用例均有通过记录。E2E 中的前后端生产构建成功；Vite 仍报告既有的超过 500 kB chunk 提示，不属于本需求的包体改动。

## 失败分类与复验

1. 单个未完善需求原断言要求显示禁用批量复选框；本轮已按最小元素集隐藏。改为验证单条隐藏、新建第二条后验证逐条与总批量入口仍禁用，继续验证不能绕过范围确认。复验通过。
2. Markdown 回读用例等待“待验证”默认 10 秒超时，失败时真实状态仍为执行中。将等待上限设为该流程已有的 20 秒，仍要求真实终态，不改变状态或跳过断言。复验通过。
3. 五页签用例要求无动作设计页也常驻空底栏。更新为设计空栏隐藏、其他页签底栏可见且不越界，继续验证草稿、差异、计数和窄窗。复验通过。

更早回归发现的嵌套弹层焦点恢复缺陷已在应用修正，目录迟到响应保护已补测试；最终完整回归包含二者并通过。没有通过减少业务确认、跳过权限门槛或伪造检查结果消除失败。

## 风险驱动覆盖

| 风险 | 验证 |
| --- | --- |
| 简化后失去关键入口 | 六类筛选、五页签、列表/看板、设置导航、队列暂停/恢复、运行详情和检查入口 |
| 草稿丢失或旧数据回写 | 目录迟到请求、跨设置分组未保存输入、主题切换、PRD 跨页签及关闭重开、准确旧版本草稿 |
| 焦点和输入退化 | 转需求嵌套创建取消返回焦点、菜单方向键、页签键盘、IME、Esc、追加与排队、停止与问题反馈 |
| 权限和确认被精简绕过 | 模式的全部离散值、只读下审批禁用、范围/PRD 单独确认、文件归属、真实验收与候选复审门槛 |
| 视觉和宿主差异 | 浅/深共享 token、控件与文字对比、长中文、真实多文件差异、窄窗、本轮实际 Electron 普通窗口 |
| 流程只停留在展示 | 浏览器完整 E2E 和手工独立样例，真实检查退出码、Git commit 与界面历史一致 |

截图与边界详见 [AUDIT.md](AUDIT.md)。真实模型效果、正式安装更新、Windows、原生最小窗口和 200% 缩放未被本轮证据覆盖；最终产品验收由用户确认。原工作区桌面包体任务的修改未复制或覆盖，本轮没有提交、推送或发版。
