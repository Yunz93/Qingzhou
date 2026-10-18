import { useState } from "react";
import type { Delivery, WorkflowProjectState } from "@qingzhou/protocol";
import { socketClient } from "../../transport/socket-client";

export function DeliveryReview({ state, delivery, previous }: { state: WorkflowProjectState; delivery: Delivery; previous?: Delivery }) {
  const [comparison, setComparison] = useState<{ files: string[]; patch: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const result = state.verifications.find((entry) => entry.id === delivery.verificationId);
  return <section className="delivery-review" aria-label="交付审阅摘要"><h4>交付说明</h4><p className="whitespace-pre-wrap">{delivery.review?.behaviors || delivery.summary || "未填写交付说明"}</p>
    <p>{delivery.files.length} 个变更文件 · {result?.checks.filter((check) => check.status === "passed").length ?? 0} 项检查通过 / {result?.checks.length ?? 0} 项已运行</p><details><summary>查看涉及的文件</summary><ul className="workflow-file-list">{delivery.files.map((file) => <li key={file}><code>{file}</code></li>)}</ul></details>
    {previous ? <div className="mt-2"><button className="btn btn-secondary" disabled={busy} onClick={() => {
      setBusy(true); setError(""); void socketClient.send<{ files: string[]; patch: string }>("workflow.compare", { projectId: state.configs[0]!.projectId, from: previous.commit, to: delivery.commit }).then(setComparison).catch((reason) => setError(reason instanceof Error ? reason.message : "比较失败")).finally(() => setBusy(false));
    }}>{busy ? "正在比较…" : "与上次交付比较"}</button>{comparison ? <details open className="mt-2"><summary>相对上次交付变化 · {comparison.files.length} 个文件</summary><pre className="workflow-code">{comparison.patch || "代码树无变化"}</pre></details> : null}</div> : null}
    {delivery.review?.unresolved.trim() ? <><h4>未完成与需人工检查</h4><p className="whitespace-pre-wrap">{delivery.review.unresolved}</p></> : null}
    {delivery.review?.artifactPaths.length ? <><h4>封存产物</h4><ul>{delivery.review.artifactPaths.map((file) => <li key={file}><ArtifactPreview deliveryId={delivery.id} file={file} /></li>)}</ul></> : null}
    {error ? <p role="alert" className="text-danger">{error}</p> : null}
  </section>;
}
function ArtifactPreview({ deliveryId, file }: { deliveryId: string; file: string }) {
  const [artifact, setArtifact] = useState<{ mimeType: string; dataUrl?: string; text?: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <div className="mt-2"><button className="btn btn-secondary break-all" disabled={busy} onClick={() => { setBusy(true); setError(""); void socketClient.send<typeof artifact>("workflow.artifact", { deliveryId, path: file }).then(setArtifact).catch((reason) => setError(reason instanceof Error ? reason.message : "读取产物失败")).finally(() => setBusy(false)); }}>{busy ? "正在读取…" : `预览 ${file}`}</button>
    {artifact?.dataUrl ? <a href={artifact.dataUrl} download={file.split("/").at(-1)}><img className="workflow-artifact-preview" src={artifact.dataUrl} alt={`交付中保存的产物：${file}`} /></a> : artifact?.text !== undefined ? <pre className="workflow-code">{artifact.text}</pre> : null}
    {error ? <p role="alert" className="text-danger mt-2">{error}</p> : null}
  </div>;
}
