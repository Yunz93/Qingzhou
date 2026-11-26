# 墨问首用与商用就绪 · 实施

来源为[PRD v1](PRD.md)。安装与数据目录沿用桌面迁移候选。开发和验证使用隔离资料。

| 改动 | 实现入口 |
| --- | --- |
| 首次配置直接选择 Gemini 或复用已有连接。各服务商的未保存密钥独立，按 Enter 可提交，失败保留输入。跳过凭据并选择文件夹后可查看项目和历史。新对话读取最新配置的目录，单次手选目录只影响本次创建。 | `SetupWizard.tsx`、`ProviderKeyField.tsx`、`SettingsPage.tsx`、`WorkbenchLayout.tsx`、`routes/setup.ts` |
| 「测试连接」只读取 Google 模型目录。保存和删除凭据与 Pi 共用文件锁，原子替换后刷新已启动会话的本地模型目录。服务商拒绝生成时保留部分输出，需求执行进入失败状态，可继续处理。 | `gemini-connection.ts`、`pi-auth-file.ts`、`extensions/approval.ts`、`event-normalizer.ts`、`task-service.ts` |
| 窄屏会话优先展示标题与返回入口，低频动作收入菜单。看板等待数据时显示加载态，并仅在有可选需求时提供批量操作。主动停止与发送失败分别反馈。 | `WorkbenchLayout.tsx`、`WorkspaceChrome.tsx`、`WorkflowDashboard.tsx`、`BoardPage.tsx` |
| 图片在输入框、已发消息和本地 Markdown 预览中共用查看器；键盘可以打开、关闭并返回原图。代码先显示原文，按需加载语法高亮。 | `ConversationImage.tsx`、`PromptComposer.tsx`、`WorkspaceMediaPreview.tsx`、`useHighlightedCode.ts` |
| 建立 WebSocket 与检查模型凭据并行。通过同一会话认证入口发起轻量 HEAD 请求以取得 cookie 或检查桌面连接。发行资源包含项目许可证和本次实际打入前端的依赖许可证。 | `app/App.tsx`、`socket-client.ts`、`apps/server/src/app.ts`、`vite.config.ts`、`pack-tauri.mjs` |

按用户选择，Gemini 推理只通过本机模拟服务验收，不使用 Google 账号或真实密钥。

旧配置可通过 `models.json` 为 Google 服务或单个模型指定其他地址。设置状态返回接收方 origin，界面在保存前显示所有接收主机。服务端在更新凭据文件的锁内复核目标版本，拒绝沿用其他地址的确认。仅官方配置显示 AI Studio 取钥入口和官方目录测试。

现有 GitHub 正式版为 Electron v0.1.28。本候选使用 v0.1.29，根包、协议、网页、服务、桌面包及 Rust/Tauri 元数据同步。Windows 安装验证默认读取固定摘要的 v0.1.28 安装包，仍可指定 v0.1.26 检查历史路径。
