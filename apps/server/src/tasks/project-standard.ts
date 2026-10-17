import { PROJECT_STANDARD_PATHS as P, PROJECT_STANDARD_VERSION, projectStandardManifestSchema, type ProjectStandardInspection } from "@qingzhou/protocol";
import { readWorkspaceText, writeWorkspaceText } from "./workspace-files.js";

type StandardFile = { path: string; purpose: string; content: string };
export function projectStandardFiles(name: string): StandardFile[] {
  const manifest = { schemaVersion: 1, standard: "qingzhou-project", paths: Object.fromEntries(Object.entries(P).filter(([key]) => key !== "manifest")) };
  return [
    { path: "AGENTS.md", purpose: "Agent 入口与授权边界", content: `# Agent 协作入口\n\n先阅读 docs/README.md、docs/project/overview.md、docs/project/architecture.md、docs/project/verification.md 和 docs/agents/workflow.md。\n\n- 用户的明确指令与本轮授权优先；已经确认的范围不重复索要授权。\n- 未确认需求、未确认 PRD 的阶段只讨论；收到实施授权后完整推进实现与验证。\n- 设计调整时同步需求 PRD 与模块提案，重新确认后进入对应实施轮次。\n- 人工验收、PRD 固化和合入由用户确认；不得自行伪造通过状态。\n- 并行需求各自在独立工作区开发，不覆盖其他需求的模块版本。\n- 项目命令以仓库和编排配置为准，遵守用户已经授予的运行权限。\n- 不自动提交、推送或发布；用户明确授权的操作按其范围执行。\n` },
    { path: P.index, purpose: "项目文档导航", content: `# ${name} 文档\n\n- [项目标准结构](standards/project-layout.md)\n- [项目概览](project/overview.md)\n- [架构与代码边界](project/architecture.md)\n- [验证方式](project/verification.md)\n- [Agent 工作流](agents/workflow.md)与[职责](agents/roles.md)\n- [模块设计](modules/README.md)\n- [需求与 PRD](requirements/README.md)\n- [设计决策](decisions/README.md)\n\n需求执行时读取 docs/qingzhou/requirements/<需求 ID>/CONTEXT.md，按其中的范围、PRD 与模块版本继续。\n` },
    { path: P.layout, purpose: "目录、文档编辑权与版本规则", content: "# 项目标准结构 v1\n\n源码目录沿用当前项目。根 AGENTS.md 是协作入口；docs/project/ 保存长期目标、架构和验证方式；docs/agents/ 说明阶段与职责；docs/modules/ 维护当前设计和来源；docs/requirements/ 保存手工需求；docs/templates/ 提供模板；docs/decisions/ 记录跨模块取舍。\n\n平台需求保存在 docs/qingzhou/requirements/<需求 ID>.json 及同名目录。PRD.md 与 modules/ 是可编辑设计，IMPLEMENTATION.md 与 VERIFICATION.md 是过程记录，CONTEXT.md 和 baselines/ 是只读依据快照。JSON 与 Markdown 有不同修改时先合并，用户确认后继续实施；真实检查、人工验收、固化与合入以平台记录为准。\n\n当前模块设计与需求提案分开保存；并行需求使用独立工作区，版本过期先合并设计。项目初始化只补齐缺失文件，不覆盖已有规则或移动历史文档。\n" },
    { path: P.overview, purpose: "长期产品目标与业务边界", content: `# ${name} 项目概览\n\n## 产品目标与用户\n待项目维护者填写当前产品目标、主要用户与核心场景。\n\n## 业务流程与边界\n记录关键流程、非目标和需要人工决定的事项。单次需求的设计放入 PRD。\n\n## 文档关系\n项目概览描述长期目标，模块文档描述当前设计，需求 PRD 记录每次变更，设计决策记录跨模块取舍。\n` },
    { path: P.architecture, purpose: "代码目录、接口与依赖", content: "# 架构与代码边界\n\n记录现有代码目录、运行入口、模块职责、数据存储、协议和外部依赖。沿用当前框架的代码目录，不为了文档标准搬动源码。\n\n模块文档应链接相关源码与回归测试；跨模块接口变更记录到设计决策。\n" },
    { path: P.verification, purpose: "环境准备、命令与证据规则", content: "# 验证方式\n\n## 环境与命令\n依据项目 README、依赖清单和编排检查配置，填写环境准备、lint、类型检查、构建、测试命令；不假定项目使用某一种包管理器。\n\n## 证据\n每次记录执行目录、代码版本、命令、真实结果和限制。未运行的检查写明未运行，不以 Agent 声明替代结果。验收标准需人工确认。\n\n## 权限\n遵守用户已授予的命令权限；新增外部副作用、发布、推送与扩大范围按明确授权执行。\n" },
    { path: P.workflow, purpose: "Agent 阶段边界与交付规范", content: "# Agent 工作流\n\n1. 沟通：读取项目入口与相关模块设计，澄清目标、边界、验收标准；只读讨论不修改代码。\n2. 范围确认：确认当前范围版本，识别依赖与受影响模块。\n3. PRD：提出完整方案、用户流程、异常场景和模块完成后的设计；由用户确认具体版本。\n4. 实施：在独立工作区按确认版本实现，维护 IMPLEMENTATION.md 并执行授权范围内的必要验证。\n5. 迭代：设计有变化时同步 PRD.md 与 modules/<模块 ID>.md，说明差异；系统读回为新 PRD，用户重新确认后继续对应实施。\n6. 回归：逐条核对验收标准，在 VERIFICATION.md 记录真实结果和未覆盖项；平台检查与人工验收分别保留。\n7. 收束：向用户呈现改动、证据和待决定项；用户验收后固化 PRD，之后的设计变更创建关联子需求。\n8. 集成：在隔离候选中同步主线、解冲突、重新验证；产品语义取舍交给用户，最终合入需确认。\n\n优先读取根 AGENTS.md、相关路径下的 AGENTS.md 与本轮 CONTEXT.md。只读取当前需求相关模块与依赖，不无差别加载所有历史。跨需求交接保留范围 ID、PRD ID、模块基线、交付和真实验证信息。\n\nJSON 与 Markdown 可用于编辑同一设计；若两处改动冲突，先合并，不任意选取一个覆盖另一个。CONTEXT.md 与 baselines/ 是系统快照，不修改确认 ID、验收状态或基线事实。\n" },
    { path: P.roles, purpose: "规划、实施、审阅与集成职责", content: "# Agent 职责\n\n| 职责 | 产出 | 边界 |\n| --- | --- | --- |\n| 需求规划 | 范围、待确认问题、PRD 与模块影响 | 不把建议标为用户确认 |\n| 实施 | 代码、同步设计、实施记录 | 按确认版本与文件归属修改 |\n| 复核 | 验收标准检查、回归证据、风险 | 不把自检等同于人工验收 |\n| 集成 | 冲突分析、候选修复、组合验证 | 不擅自决定产品语义或合入 |\n\n这些是工作阶段的职责，默认由同一 Agent 连续承担。只有明确要求并行或委派时才安排多个 Agent，各自使用独立工作区，交接具体版本与结果。\n" },
    { path: P.modules, purpose: "模块当前设计与来源导航", content: "# 模块设计\n\n每个长期模块维护一份文档，可从 docs/templates/module.md 建立。包括职责、流程与状态、接口、依赖、源码与测试、来源 PRD，以及设计与代码合入状态。\n\n平台维护已验收的当前确认设计和历史版本；需求工作区中的 modules/ 是变更提案，baselines/ 是确切版本快照。提案未验收前不覆盖当前设计，已验收但未合入时须标明代码状态。仓库模块文档更新后需与相关 PRD 和交付一起审阅。\n" },
    { path: P.requirements, purpose: "需求来源、版本与交付导航", content: "# 需求与 PRD\n\n手工编写的需求使用 docs/requirements/<需求键>/，至少包含 PRD.md、IMPLEMENTATION.md 和 VERIFICATION.md；模板见 docs/templates/。\n\n轻舟编排的需求使用 docs/qingzhou/requirements/<需求 ID>.json 和同名目录。目录中包含可编辑 PRD、模块提案、实施与验证记录，以及系统生成的上下文和模块基线。两种需求通过文档链接关联，不能把手工文档的状态写成平台已确认事实。\n\n历史 PRD 可继续保留在已有路径，通过索引链接即可，不为统一目录重写历史确认或移动已固化文档。\n" },
    { path: P.decisions, purpose: "跨模块方案与取舍", content: "# 设计决策\n\n影响多个模块、兼容性或关键约束的决定记录为 ADR：背景、选择、备选、影响、关联模块与 PRD、确认状态。尚未确认的方案明确标为提议。\n" },
    { path: "docs/templates/prd.md", purpose: "需求 PRD 模板", content: "# 需求名称\n\n状态：草稿，待确认。\n\n## 来源与目标\n用户场景、当前问题、来源需求或 PRD。\n\n## 范围与非目标\n\n## 用户流程、交互与异常\n\n## 关联模块与依据版本\n列出模块、当前设计版本、完成后的完整设计与兼容影响。\n\n## 实施与回归计划\n\n## 验收标准\n逐条可判断，区分自动检查与人工验收。\n\n## 设计变更记录\n版本、原因、确认依据与对应交付；未确认不标为已确认。\n" },
    { path: "docs/templates/module.md", purpose: "模块设计模板", content: "# 模块名称\n\n## 设计与代码状态\n当前设计版本、来源 PRD、交付、代码是否合入。\n\n## 职责与边界\n\n## 用户流程与状态\n\n## 接口、数据与约束\n\n## 依赖与相关模块\n\n## 源码和测试位置\n\n## 设计演进\n链接每次子需求 PRD、变更原因与已确认版本。未交付的提案分列。\n" },
    { path: "docs/templates/verification.md", purpose: "回归与人工验收模板", content: "# 验证记录\n\n状态：待验证。\n\n## 范围与版本\n需求、PRD、代码版本与执行环境。\n\n## 自动检查\n记录目录、命令、真实结果、日志位置；未运行写明原因。\n\n## 人工验收\n逐条列出标准、观察结果与证据；确认人未决定前标为待确认。\n\n## 未覆盖项与限制\n\n## 交付与合入\n链接平台交付、验证和集成记录；不由此文档自行宣布通过。\n" },
    { path: "docs/templates/decision.md", purpose: "跨模块设计决策模板", content: "# ADR：决策标题\n\n状态：提议，待确认。\n\n## 背景与约束\n\n## 选择与备选方案\n\n## 影响与兼容性\n\n## 关联模块与 PRD\n\n## 确认依据与后续验证\n" },
    { path: P.manifest, purpose: "项目标准版本与文档路径", content: JSON.stringify(manifest, null, 2) + "\n" },
  ];
}
export async function inspectProjectStandard(cwd: string, name: string): Promise<ProjectStandardInspection> {
  const files: ProjectStandardInspection["files"] = [];
  for (const file of projectStandardFiles(name)) {
    const missing = await readWorkspaceText(cwd, file.path) === null;
    files.push({ path: file.path, purpose: file.purpose, status: missing ? "missing" : "present", preview: missing ? file.content : undefined });
  }
  const manifest = await readWorkspaceText(cwd, P.manifest);
  if (manifest !== null) {
    try { projectStandardManifestSchema.parse(JSON.parse(manifest)); }
    catch { throw new Error("项目标准清单无效，原文件已保留；请按文档修复 docs/qingzhou/project.json 后重试"); }
  }
  return { version: PROJECT_STANDARD_VERSION, ready: files.every((file) => file.status === "present"), files };
}
export async function initializeProjectStandard(cwd: string, name: string) {
  await inspectProjectStandard(cwd, name); // Preflight all paths before creating anything.
  const created: string[] = [], preserved: string[] = [];
  for (const file of projectStandardFiles(name)) (await writeWorkspaceText(cwd, file.path, file.content) ? created : preserved).push(file.path);
  return { created, preserved, inspection: await inspectProjectStandard(cwd, name) };
}
