import type { Delivery, Verification } from "@qingzhou/protocol";
import { changedTestCases, changedTests, testCaseResults, testCounts } from "../../lib/test-evidence";

export function AcceptanceEvidence({ delivery, verification, onViewFile }: { delivery: Delivery; verification?: Verification; onViewFile: (path: string) => void }) {
  const files = changedTests(delivery.patch);
  const cases = changedTestCases(delivery.patch);
  const checks = verification?.checks ?? [];
  const counts = checks.flatMap((check) => { const counts = testCounts(check); return counts ? [{ check, counts }] : []; });
  const results = checks.flatMap(testCaseResults);
  const passedChecks = checks.filter((check) => check.status === "passed" && check.exitCode === 0).length;
  const singleCount = counts.length === 1 ? counts[0]!.counts : null;
  return <section className="review-acceptance-evidence" aria-label="测试与验收证据">
    <div className="review-results"><strong>{singleCount ? `${singleCount.passed} / ${singleCount.passed + singleCount.failed + singleCount.skipped}` : `${passedChecks} / ${checks.length}`}</strong><span>{singleCount ? "用例通过" : "项检查通过"}</span></div>
    <p className="review-result-note">{singleCount ? `${singleCount.failed} 项失败 · ${singleCount.skipped} 项跳过` : "未提供可汇总的用例数量"}</p>
    {singleCount && checks.length > 1 ? <p className="review-hint">用例统计来自 {counts[0]!.check.name}，其余检查见日志。</p> : null}
    <div className="review-result-bar" data-state={verification?.status ?? "unverified"} />
    <div className="review-section-heading"><h3>本次用例变更</h3><span>{cases.length} 项 · {files.length} 个文件</span></div>
    {cases.length ? <table className="review-test-table"><thead><tr><th>测试用例</th><th>运行结果</th></tr></thead><tbody>{cases.map((entry) => {
      // Name-only TAP has no file identity, so it cannot prove this changed case ran.
      return <tr key={`${entry.file}:${entry.name}`}><td><span className="review-change-tag">{entry.change}</span><button className="review-test-link" onClick={() => onViewFile(entry.file)}>{entry.name === entry.file ? "测试文件中的变更" : entry.name} ↗</button><small>{entry.file}{entry.line ? `:${entry.line}` : ""}</small></td><td>{entry.change === "删除" ? "已删除" : "未关联结果"}</td></tr>;
    })}</tbody></table> : <p className="review-hint">此交付未发现测试文件变更。</p>}
    {singleCount ? <p className="review-check-summary">{passedChecks} / {checks.length} 项检查通过{results.length ? " · 日志有用例结果，未提供文件归属" : " · 未提供逐用例结果"}</p> : null}
    {counts.length > 1 ? counts.map(({ check, counts }) => <p className="review-hint" key={check.id}>{check.name}：{counts.passed} 项用例通过 · {counts.failed} 项失败 · {counts.skipped} 项跳过</p>) : null}
  </section>;
}
