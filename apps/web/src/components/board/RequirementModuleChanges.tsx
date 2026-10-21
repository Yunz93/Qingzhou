import { useState } from "react";
import type { RequirementPrd, WorkflowProjectState } from "@qingzhou/protocol";
import { DiffView } from "../diff/DiffView";
import { ReviewActions } from "./ReviewActions";

/** Compare this requirement's proposal with its exact bound module revision. */
export function RequirementModuleChanges({ state, prd, changes, draft = false, stale = false, visible, actionsTarget, onDesign }: {
  state: WorkflowProjectState; prd?: RequirementPrd; changes: RequirementPrd["moduleChanges"];
  draft?: boolean; stale?: boolean; visible: boolean; actionsTarget?: HTMLElement | null; onDesign: () => void;
}) {
  const [selected, setSelected] = useState("");
  if (!visible) return null;
  const change = changes.find((entry) => entry.moduleId === selected) ?? changes[0];
  const module = state.modules?.find((entry) => entry.id === change?.moduleId);
  const baseline = state.moduleRevisions?.find((entry) => entry.id === change?.baseRevisionId && entry.moduleId === change.moduleId);
  const name = (id: string) => state.modules?.find((entry) => entry.id === id)?.name ?? "未找到模块";
  const source = prd?.frozenAt ? `已固化 · PRD v${prd.version}` : draft || !prd ? "未保存草稿" : `PRD v${prd.version} · ${prd.confirmedAt ? "已确认" : "待确认"}`;
  return <section className="review-module-changes" hidden={!visible} role="tabpanel" id="requirement-panel-modules" aria-labelledby="requirement-tab-modules">
    <div className="review-toolbar"><h3>模块产品设计 <span className="review-hint">{source}</span></h3><div className="review-toolbar-actions"><span className="review-hint">{changes.length} 个关联模块</span>{change ? <select className="review-version-select" aria-label="关联模块" value={change.moduleId} onChange={(event) => setSelected(event.target.value)}>{changes.map((entry) => <option key={entry.moduleId} value={entry.moduleId}>{name(entry.moduleId)}</option>)}</select> : null}</div></div>
    {stale ? <p role="alert" className="review-blocker">PRD 已有新版本，当前展示保留的模块草稿；请回到设计合并依据。</p> : null}
    {change ? <div className="review-module-body"><h3>{module?.name ?? "未找到模块"}</h3>
      {change.baseRevisionId && !baseline ? <p role="alert" className="review-hint">未找到本需求绑定的模块基线，暂时无法比较。</p> : baseline?.documentError ? <p role="alert" className="review-hint">{baseline.documentError}</p> : <>
        {baseline?.content === change.content ? <p className="review-hint">该模块已关联，本次设计内容未变化。</p> : null}
        <DiffView key={`${change.moduleId}:${change.baseRevisionId}`} oldText={baseline?.content ?? ""} newText={change.content} beforeLabel={baseline ? `变更前 · 模块基线 v${baseline.version}` : "变更前 · 无设计基线（新增）"} afterLabel={`变更后 · ${source}`} />
      </>}
    </div> : <div className="workflow-empty"><h3>当前需求尚未关联模块设计</h3><p>在“设计”的“模块、文件与草稿来源”中关联模块并填写完成后的完整设计。</p></div>}
    <ReviewActions target={visible ? actionsTarget : null}><span className="review-hint">{prd?.frozenAt ? "固化设计 · 只读" : "对照本需求的模块设计变化"}</span><button className="btn btn-secondary" onClick={onDesign}>{prd?.frozenAt ? "回到需求设计" : "回到设计调整"}</button></ReviewActions>
  </section>;
}
