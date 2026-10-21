import { PatchDiff } from "../diff/PatchDiff";
import { useRef, useState } from "react";
import type { WorkflowProjectState, WorkItemSummary } from "@qingzhou/protocol";
import { socketClient } from "../../transport/socket-client";

export function MainlineHistory({ state, items, onSelect }: { state: WorkflowProjectState; items: WorkItemSummary[]; onSelect?: (item: WorkItemSummary) => void }) {
  const nodes = state.events.filter((event) => event.type === "main.merged").flatMap((event) => {
    const attempt = event.facts?.integration ?? state.integrations.find((entry) => entry.id === event.subjectId);
    const delivery = state.deliveries.find((entry) => entry.id === attempt?.deliveryId);
    const scope = state.scopes.find((entry) => entry.id === delivery?.scopeId);
    return attempt?.mergedCommit ? [{ event, attempt, delivery, scope, item: items.find((entry) => entry.id === event.itemId) }] : [];
  });
  const versions = nodes.length ? [{ commit: nodes[0]!.attempt.baseline!, label: "V0 · 首次记录的主线基线" }, ...nodes.map((node, index) => ({ commit: node.attempt.mergedCommit!, label: `V${index + 1} · ${node.scope?.title ?? node.item?.title ?? "历史需求"}` }))] : [];
  if (state.head && !versions.some((version) => version.commit === state.head)) versions.push({ commit: state.head, label: "当前主线 · 含记录之外的变更" });
  const [selectedFrom, setFrom] = useState("");
  const [selectedTo, setTo] = useState("");
  const from = versions.some((entry) => entry.commit === selectedFrom) ? selectedFrom : versions[0]?.commit ?? "";
  const to = versions.some((entry) => entry.commit === selectedTo) ? selectedTo : versions.at(-1)?.commit ?? "";
  const [comparison, setComparison] = useState<{ from: string; to: string; files: string[]; patch: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const change = (setter: (value: string) => void, value: string) => { generation.current++; setter(value); setComparison(null); setError(""); setBusy(false); };
  return <section className="workflow-mainline-history" aria-label="主线版本演进"><h3>主线版本</h3><p className="text-sm text-mute mt-2">按实际合入顺序查看需求和当时的检查。下方事件保留完整执行证据；历史合入记录不直接证明需求效果仍存在。</p>
    <ol>{nodes.map((node, index) => {
      const verification = state.verifications.find((entry) => entry.id === node.attempt.verificationId);
      const sourceId = node.item?.source?.integrationId ?? state.events.find((event) => event.itemId === node.item?.id && event.type === "revert.prepared")?.subjectId;
      const original = sourceId ? state.integrations.find((entry) => entry.id === sourceId) : null;
      const originalTitle = original ? items.find((entry) => entry.id === original.itemId)?.title : "";
      return <li key={node.event.id}><div><span className="workflow-eyebrow">V{index + 1} · {node.attempt.mergedCommit!.slice(0, 8)} · {new Date(node.event.createdAt).toLocaleString("zh-CN")}</span><h4>{node.scope?.title ?? node.item?.title ?? "历史需求"}{node.scope ? ` · 范围 v${node.scope.version}` : ""}</h4><p>{node.delivery?.review?.behaviors || node.delivery?.summary || "查看对应交付了解变更"}</p>
        <p className="text-sm text-mute">当时验证：{verification?.status === "passed" ? "必需检查通过" : verification?.status === "failed" ? "检查失败" : "缺少通过证据"} · {verification?.checks.filter((check) => check.status === "passed").length ?? 0} 项通过</p>
        {original ? <p className="text-sm">此版本合入撤销需求，关联「{originalTitle ?? "原需求"}」的主线版本 {original.mergedCommit?.slice(0, 8)}。实际撤销结果见本次交付与验证。</p> : null}
      </div>{onSelect && node.item ? <button className="btn btn-secondary" onClick={() => onSelect(node.item!)}>打开当前需求</button> : null}</li>;
    })}</ol>
    {!nodes.length ? <p className="text-sm text-mute mt-3">尚无轻舟记录的主线合入。验收并合入首个需求后会生成版本节点。</p> : null}
    {versions.length > 1 ? <div className="workflow-version-compare"><h4 className="font-medium">比较主线版本</h4><div className="flex flex-wrap gap-2 mt-2"><label>从 <select className="field" aria-label="比较起始版本" value={from} onChange={(event) => change(setFrom, event.target.value)}>{versions.map((version) => <option key={version.commit} value={version.commit}>{version.label}</option>)}</select></label><label>到 <select className="field" aria-label="比较目标版本" value={to} onChange={(event) => change(setTo, event.target.value)}>{versions.map((version) => <option key={version.commit} value={version.commit}>{version.label}</option>)}</select></label><button className="btn btn-secondary" disabled={busy || from === to} onClick={() => {
      const request = ++generation.current; setBusy(true); setError(""); void socketClient.send<{ files: string[]; patch: string }>("workflow.compare", { projectId: state.configs[0]!.projectId, from, to }).then((value) => { if (generation.current === request) setComparison({ from, to, ...value }); }).catch((reason) => { if (generation.current === request) setError(reason instanceof Error ? reason.message : "版本比较失败"); }).finally(() => { if (generation.current === request) setBusy(false); });
    }}>{busy ? "正在比较…" : "比较版本"}</button></div>
      {comparison && comparison.from === from && comparison.to === to ? <details open className="mt-3"><summary>两个主线版本的实际差异 · {comparison.files.length} 个文件</summary><PatchDiff patch={comparison.patch} beforeLabel={`修改前 · ${from.slice(0, 8)}`} afterLabel={`修改后 · ${to.slice(0, 8)}`} fallback="代码树无变化" /></details> : null}
      {error ? <p className="text-danger mt-2" role="alert">{error}</p> : null}
    </div> : null}
  </section>;
}
