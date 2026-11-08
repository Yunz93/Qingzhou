import type { Verification } from "@qingzhou/protocol";
import { checkLabels, workflowDate as date } from "../../lib/workflow-presentation";

export function VerificationDetails({ result }: { result: Verification | undefined }) {
  if (!result) return <p className="mt-2 text-sm text-mute">尚无检查证据</p>;
  return <div className="mt-2 text-sm"><p>{checkLabels[result.status]}</p>
    <details className="mt-2"><summary>验证环境</summary><p className="mt-2">配置 v{result.configRevision} · {result.environment}</p></details>
    {result.error ? <p className="mt-2 text-danger">{result.error}</p> : null}
    {result.checks.map((check, index) => <details className="mt-2" key={`${check.id}:${index}`}><summary>{check.name} · {check.required ? "必需" : "非必需"} · {check.status === "passed" ? "通过" : check.status === "running" ? "执行中" : "失败或中断"} · 退出码 {check.exitCode ?? "无"}</summary>
      <pre className="workflow-code">{check.command}{"\n"}{check.cwd}{"\n"}{date(check.startedAt)}{check.finishedAt ? ` → ${date(check.finishedAt)}` : ""}{"\n\n"}{check.output || "暂无输出"}{check.truncated ? "\n[日志超出长度，已截断]" : ""}</pre></details>)}
  </div>;
}
