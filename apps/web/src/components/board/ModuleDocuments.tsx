import { DocumentPath } from "./DocumentPath";
import { DocumentReader } from "./DocumentReader";
import { useState } from "react";
import type { WorkItemDetails, WorkflowProjectState, WorkItemSummary } from "@qingzhou/protocol";
import { socketClient } from "../../transport/socket-client";
import { ChildRequirement, MarkdownDownload } from "./RequirementDesign";
import { WorkflowModal } from "./WorkflowTabs";

export function ModuleDocuments({ state, items, projectId, onRefresh, onSelect }: {
  state: WorkflowProjectState; items: WorkItemSummary[]; projectId: string; onRefresh: () => Promise<void>; onSelect: (item: WorkItemSummary, panel?: string) => void;
}) {
  const [selected, setSelected] = useState(""); const [creating, setCreating] = useState(false); const [child, setChild] = useState(false);
  const [name, setName] = useState(""); const [content, setContent] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const modules = state.modules ?? [];
  const module = modules.find((entry) => entry.id === selected) ?? modules[0];
  const revisions = state.moduleRevisions?.filter((entry) => entry.moduleId === module?.id) ?? [];
    const mainDesign = revisions.find((entry) => entry.id === state.mainDesignBaseline?.moduleRevisionIds[module?.id ?? ""]);
  const displayed = mainDesign ?? revisions.find((entry) => !entry.sourcePrdId);
  const origin = state.prds?.find((entry) => entry.id === displayed?.sourcePrdId);
  const sourceItem = items.find((entry) => entry.id === origin?.itemId);
  const proposals = state.plans?.flatMap((plan) => {
    const prd = state.prds?.find((entry) => entry.id === plan.currentPrdId && (!entry.frozenAt || !state.integrations.some((attempt) => attempt.deliveryId === entry.deliveryId && attempt.status === "merged")) && entry.moduleChanges.some((change) => change.moduleId === module?.id));
    const item = items.find((entry) => entry.id === plan.itemId && entry.state !== "archived");
    return prd && item ? [{ prd, item }] : [];
  }) ?? [];
  const codeState = (deliveryId: string | null) => deliveryId ? state.integrations.some((entry) => entry.deliveryId === deliveryId && entry.status === "merged") ? "对应代码已合入" : "对应交付尚未合入" : "初始设计基线";
  return <section className="workflow-modules" aria-label="模块设计文档"><div className="workflow-view-intro"><div className="flex flex-wrap items-center justify-between gap-2"><h3>模块设计</h3><button className="btn btn-primary" onClick={() => setCreating(true)}>建立模块文档</button></div></div>
    {!modules.length ? <div className="workflow-empty"><h3>先建立一个长期维护的模块</h3><p>例如：项目编排、对话交互、权限。每个需求的 PRD 可同时关联多个模块。</p></div> : <div className="workflow-module-layout"><nav aria-label="模块列表"><input className="field" aria-label="搜索模块" placeholder="搜索模块…" value={query} onChange={(event) => setQuery(event.target.value)} />{modules.filter((entry) => entry.name.toLowerCase().includes(query.toLowerCase())).map((entry) => <button className="btn btn-secondary" key={entry.id} aria-current={module?.id === entry.id ? "page" : undefined} onClick={() => setSelected(entry.id)}>{entry.name}</button>)}</nav>
      {module ? <article><div className="workflow-design-section"><h3>{module.name} · {mainDesign?.sourcePrdId ? "主线设计" : "初始设计基线"} v{displayed?.version ?? 0}</h3><p className="text-sm text-mute">{codeState(displayed?.deliveryId ?? null)}{displayed ? ` · ${new Date(displayed.createdAt).toLocaleString()}` : ""}</p>
        <DocumentPath projectId={projectId} path={revisions.some((entry) => entry.document) ? module.documentPath : undefined} />
        {sourceItem && origin ? <button className="btn btn-ghost" onClick={() => onSelect(sourceItem, "design")}>来源：{sourceItem.title} · 固化 PRD v{origin.version}</button> : null}<DocumentReader>{displayed?.content || "暂未填写正文；在后续需求 PRD 中补充模块设计。"}</DocumentReader><div className="flex flex-wrap gap-2"><MarkdownDownload name={`module-${module.id}-v${displayed?.version ?? 0}.md`} content={`# ${module.name}\n模块版本 v${displayed?.version ?? 0}\n${codeState(displayed?.deliveryId ?? null)}\n来源 PRD ${displayed?.sourcePrdId ?? "初始基线"}\n\n${displayed?.content ?? ""}`} /><button className="btn btn-primary" onClick={() => setChild(true)}>为此模块创建子需求</button></div>
      </div>{proposals.length ? <section className="workflow-design-section"><h3>进行中的变更（{proposals.length}）</h3>{proposals.map(({ prd, item }) => <details key={prd.id}><summary>{item.title} · PRD v{prd.version} · {prd.frozenAt ? "已验收，尚未合入" : prd.confirmedAt ? "已确认，待交付" : "设计草稿"}</summary><DocumentReader>{prd.moduleChanges.find((entry) => entry.moduleId === module.id)?.content ?? ""}</DocumentReader><button className="btn btn-secondary" onClick={() => onSelect(item, "design")}>进入需求设计</button></details>)}</section> : null}
        <details className="workflow-design-section"><summary>模块历史版本与子 PRD（{revisions.length}）</summary>{revisions.slice().reverse().map((revision) => {
          const prd = state.prds?.find((entry) => entry.id === revision.sourcePrdId);
          const item = items.find((entry) => entry.id === prd?.itemId);
          return <details key={revision.id} className="workflow-design-revision"><summary>v{revision.version} · {item?.title || "建立模块"} · {codeState(revision.deliveryId)}</summary><DocumentReader>{revision.content}</DocumentReader>{item && prd ? <button className="btn btn-secondary" onClick={() => onSelect(item, "design")}>回看 {item.title} · PRD v{prd.version}</button> : null}</details>;
        })}</details>
      </article> : null}</div>}
    {creating ? <WorkflowModal title="建立模块文档" onClose={() => setCreating(false)}><form className="workflow-design" onSubmit={(event) => {
      event.preventDefault(); setBusy(true); setError(""); void socketClient.send<{ module: { id: string } }>("workflow.module.create", { projectId, name, content }).then(async (result) => { setSelected(result.module.id); await onRefresh(); setCreating(false); setName(""); setContent(""); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "建立模块失败")).finally(() => setBusy(false));
    }}><label>模块名称<input className="field w-full" value={name} onChange={(event) => setName(event.target.value)} required maxLength={200} /></label><label>当前设计基线<textarea className="field w-full" rows={10} value={content} onChange={(event) => setContent(event.target.value)} maxLength={12000} placeholder="记录当前职责、用户交互、边界和约束。可先建空模块，后续通过 PRD 补充。" /></label>{error ? <p role="alert" className="text-danger">{error}</p> : null}<button className="btn btn-primary" type="submit" disabled={busy || !name.trim()}>保存模块基线</button></form></WorkflowModal> : null}
    {child && module ? <ChildRequirement state={state} projectId={projectId} prd={origin} moduleId={module.id} onClose={() => setChild(false)} onCreated={async (id) => { setChild(false); await onRefresh(); const result = await socketClient.send<WorkItemDetails>("workItem.details", { id }); onSelect({ ...result.item, runCount: result.runs.length, latestRun: result.runs[0] ?? null, feedbackCount: result.feedback.length }, "design"); }} /> : null}
  </section>;
}
