import { requirementFiles, type RequirementPrd, type WorkflowState, type WorkItem, type WorkspaceDesign } from "@qingzhou/protocol";
import { readWorkspaceText, writeWorkspaceText } from "./workspace-files.js";

function reconcile(base: string, json: string, markdown: string | null, label: string): string {
  if (markdown === null) return json;
  if (markdown !== base && json !== base && markdown !== json) throw new Error(`${label} 的 JSON 与 Markdown 有不同修改，请先合并为相同内容后同步`);
  return markdown !== base ? markdown : json;
}
/** Read edits against the document's recorded base, never against a newer UI draft. */
export async function readDesignMarkdown(cwd: string, id: string, document: WorkspaceDesign, base: RequirementPrd): Promise<WorkspaceDesign> {
  const files = requirementFiles(id);
  const content = reconcile(base.content, document.content, await readWorkspaceText(cwd, files.prd), "PRD");
  const moduleChanges: RequirementPrd["moduleChanges"] = [];
  for (const change of document.moduleChanges) {
    const previous = base.moduleChanges.find((entry) => entry.moduleId === change.moduleId);
    const markdown = await readWorkspaceText(cwd, files.module(change.moduleId));
    if (!previous && markdown !== null && markdown !== change.content) throw new Error("新增模块的 JSON 与已有 Markdown 无共同依据，请先合并为相同内容后同步");
    const merged = reconcile(previous?.content ?? change.content, change.content, markdown, "模块设计");
    if (!merged.trim() || merged.length > 12000) throw new Error("模块 Markdown 正文不能为空，且不能超过 12000 字符");
    moduleChanges.push({ ...change, content: merged });
  }
  for (const previous of base.moduleChanges.filter((entry) => !document.moduleChanges.some((change) => change.moduleId === entry.moduleId))) {
    const markdown = await readWorkspaceText(cwd, files.module(previous.moduleId));
    if (markdown !== null && markdown !== previous.content) throw new Error("JSON 已移除的模块仍有 Markdown 修改，请先合并模块关联与设计");
  }
  if (content.length > 16000) throw new Error("PRD Markdown 超过 16000 字符，请拆分或精简需求");
  return { ...document, content, moduleChanges };
}
export function requirementDocuments(item: WorkItem, prd: RequirementPrd, state: WorkflowState): Record<string, string> {
  const files = requirementFiles(item.id);
  const scope = state.scopes.find((entry) => entry.id === prd.scopeId)!;
  const workspace = state.workspaces.find((entry) => entry.itemId === item.id);
  const modules = prd.moduleChanges.map((change) => {
    const module = state.modules?.find((entry) => entry.id === change.moduleId);
    const baseline = state.moduleRevisions?.find((entry) => entry.id === change.baseRevisionId);
    return { change, module, baseline };
  });
  const documents: Record<string, string> = {
    [files.prd]: prd.content,
    [files.agents]: "# 本需求的 Agent 规范\n\n先阅读根 AGENTS.md、docs/agents/workflow.md 和本目录 CONTEXT.md。\n\n- 本目录 PRD.md 和 modules/ 是可编辑的需求设计；修改后由系统读回，用户确认新 PRD 后再继续对应实施。\n- 同步更新 IMPLEMENTATION.md 与 VERIFICATION.md。记录实际执行结果，未完成或未验证的项明确保留。\n- CONTEXT.md、baselines/ 与设计 JSON 的 schemaVersion、documentationVersion、prdId、模块 ID 和依据版本是系统元数据，不改写确认或验收事实。\n- 若同时编辑 JSON 与 Markdown，保持正文一致；冲突先合并，不覆盖别处的新修改。\n- 人工验收、PRD 固化和合入由用户确认，过程记录不代替平台事实。\n- 未验收的模块提案不覆盖模块当前确认设计；后续子需求引用固化 PRD。\n- 已确认启动的轮次在授权范围内推进实现与验证；新增产品取舍重新与用户确认。\n- 集成候选只解冲突和回归，不在候选中改写已固化 PRD；产品语义变化通过新需求处理。\n",
    [files.context]: `# ${item.title} · 执行设计快照\n\n系统生成，不编辑；快照表示本轮实施依据，不表示已验收或已合入。\n\n- 需求 ID：${item.id}\n- 项目 ID：${item.projectId}\n- 范围：v${scope.version} / ${scope.id}\n- PRD：v${prd.version} / ${prd.id}\n- 父 PRD：${item.source?.prdId ?? "无"}\n- Git 工作分支：${workspace?.branch ?? "以当前工作区为准"}\n- Git 实施基线：${workspace?.baseline ?? "以当前工作区为准"}\n\n## 目标与边界\n${scope.description}\n\n## 验收标准\n${scope.acceptanceCriteria}\n\n## 相关模块\n${modules.map(({ module, change, baseline }) => `- ${module?.name ?? change.moduleId}：依据 v${baseline?.version ?? 0} / ${change.baseRevisionId ?? "无"}；提案 modules/${change.moduleId}.md${baseline ? `；基线 baselines/${change.moduleId}-${baseline.id}.md` : ""}`).join("\n") || "未关联模块"}\n\n## 读取顺序与职责\n根 AGENTS.md → docs/project/ → docs/agents/workflow.md → 本文件 → PRD.md → 相关模块基线与提案 → 涉及路径下的 AGENTS.md、源码和测试。\n\n用户确认、平台执行、真实检查、人工验收、PRD 固化与代码合入各自保留记录。IMPLEMENTATION.md 与 VERIFICATION.md 仅作过程说明，不代替平台证据。\n`,
  };
  for (const { change, module, baseline } of modules) {
    documents[files.module(change.moduleId)] = change.content;
    if (baseline) documents[files.baseline(change.moduleId, baseline.id)] = `# ${module?.name ?? change.moduleId} · 设计基线 v${baseline.version}\n\n系统快照，不编辑。\n\n- 模块 ID：${change.moduleId}\n- 模块版本 ID：${baseline.id}\n- 来源 PRD：${baseline.sourcePrdId ?? "人工建立的初始基线"}\n- 来源交付：${baseline.deliveryId ?? "无"}\n- 代码合入状态：以项目集成记录为准，本文件不声明已合入。\n\n${baseline.content}`;
  }
  return documents;
}
export async function materializeRequirementDocuments(cwd: string, item: WorkItem, prd: RequirementPrd, state: WorkflowState): Promise<void> {
  const files = requirementFiles(item.id);
  const documents = requirementDocuments(item, prd, state);
  // Preflight protected snapshots before writing editable views.
  for (const [file, content] of Object.entries(documents)) {
    if (file === files.prd || prd.moduleChanges.some((entry) => file === files.module(entry.moduleId)) || file === files.context) continue;
    const existing = await readWorkspaceText(cwd, file);
    if (existing !== null && existing !== content) throw new Error("系统规范或模块基线快照被修改，请核对并恢复后继续");
  }
  for (const [file, content] of Object.entries(documents)) await writeWorkspaceText(cwd, file, content, true);
  await writeWorkspaceText(cwd, files.implementation, "# 实施记录\n\n## 本轮目标与计划\n\n## 已实现与设计调整\n\n## 待处理事项\n\n记录实际进展；此文件不声明人工验收或合入。\n");
  await writeWorkspaceText(cwd, files.verification, "# 验证记录\n\n状态：待验证。\n\n## 版本、环境和命令\n\n## 真实结果与证据\n\n## 人工验收待确认项\n\n未运行的检查明确写明未运行；平台检查结果与人工确认另行记录。\n");
}
