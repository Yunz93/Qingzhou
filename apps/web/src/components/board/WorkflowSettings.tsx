import { useEffect, useState } from "react";
import type { WorkflowProjectState, WorkflowCheck } from "@qingzhou/protocol";
import { socketClient } from "../../transport/socket-client";
import { WorkflowTabs } from "./WorkflowTabs";
import { DocumentSettings } from "./DocumentSettings";
import { workflowError as message } from "../../lib/workflow-presentation";
import { useWorkflowAction } from "../../hooks/useWorkflowAction";

export function WorkflowSettings({ projectId, state, onSaved, onOpenStandard }: { projectId: string; state: WorkflowProjectState; onSaved: () => Promise<void>; onOpenStandard: () => void }) {
  const config = state.configs[0];
  const [info, setInfo] = useState<{ isGit: boolean; repository?: string; branch?: string; branches?: string[]; dirty?: string[]; suggestedChecks?: WorkflowCheck[] }>();
  const [settingsTab, setSettingsTab] = useState("workflow");
  const [branch, setBranch] = useState(config?.targetBranch ?? "");
  const [concurrency, setConcurrency] = useState(config?.concurrency ?? 1);
  const [checks, setChecks] = useState<WorkflowCheck[]>(config?.checks ?? []);
  const { busy, error, setError, run } = useWorkflowAction(projectId);
  useEffect(() => {
    let current = true;
    void socketClient.send<typeof info>("workflow.inspect", { projectId }).then((value) => {
      if (!current) return; setInfo(value); setBranch((previous) => previous || value?.branch || "");
    }).catch((reason) => { if (current) setError(message(reason)); });
    return () => { current = false; };
  }, [projectId, setError]);
  const update = (index: number, patch: Partial<WorkflowCheck>) => setChecks(checks.map((check, position) => position === index ? { ...check, ...patch } : check));
  return <div className="workflow-settings-layout"><WorkflowTabs id="project-settings" label="项目设置分类" value={settingsTab} onChange={setSettingsTab} tabs={[{ id: "workflow", label: "编排" }, { id: "documents", label: "文档位置" }]} />
  <form hidden={settingsTab !== "workflow"} role="tabpanel" id="project-settings-panel-workflow" aria-labelledby="project-settings-tab-workflow" className="workflow-settings" onSubmit={(event) => {
    event.preventDefault();
    void run(() => socketClient.send("workflow.configure", { projectId, targetBranch: branch, concurrency, checks }), onSaved);
  }}>
    <h3 className="text-sm font-semibold mb-2">1. 仓库与集成主线</h3>
    <p className="text-sm text-mute break-all">{info ? info.isGit ? `仓库：${info.repository}` : "目录不是可用的 Git 仓库。请先在项目中建立仓库，再配置。" : "正在检查仓库…"}</p>
    {info?.dirty?.length ? <details className="mt-2 text-sm"><summary>原目录有 {info.dirty.length} 个改动</summary><p className="mt-2">新工作区以已提交代码和确认设计为依据。合入时会单独核对这些文件。</p><pre className="workflow-code">{info.dirty.join("\n")}</pre></details> : null}
    <div className="mt-3 flex flex-wrap gap-4">
      <label className="text-sm">集成分支<select aria-label="集成分支" className="field ml-2" value={branch} onChange={(event) => setBranch(event.target.value)} required>
        <option value="">选择本地分支</option>{info?.branches?.map((name) => <option key={name}>{name}</option>)}
      </select></label>
    </div>
    <h3 className="mt-4 text-sm font-semibold">2. 项目检查</h3>
    {info?.suggestedChecks?.length ? <div className="workflow-detected-checks"><p className="text-sm">检测到 {info.suggestedChecks.length} 个检查脚本，添加后可修改。</p><button type="button" className="btn btn-secondary mt-2" onClick={() => setChecks([...checks, ...info.suggestedChecks!.filter((suggestion) => !checks.some((check) => check.id === suggestion.id || check.command === suggestion.command))])}>应用检测到的检查</button></div> : null}
    <p className="mt-1 text-sm text-mute">封存与集成时运行这些命令，保存设置不会执行。</p>
    <details className="mt-2 text-sm text-mute"><summary>检查环境与共享资源</summary><p className="mt-2">需要安装依赖时，将安装步骤加入命令。使用同一端口或数据库的检查填写相同的独占资源名；凭据通过环境变量提供。</p></details>
    {checks.map((check, index) => <fieldset className="workflow-check-config" key={check.id}>
      <legend className="sr-only">检查 {index + 1}</legend>
      <label>名称<input className="field w-full" value={check.name} onChange={(event) => update(index, { name: event.target.value })} required maxLength={120} /></label>
      <label>命令<input className="field w-full font-mono" value={check.command} onChange={(event) => update(index, { command: event.target.value })} required maxLength={4000} placeholder="pnpm install --frozen-lockfile && pnpm test" /></label>
      <label>独占资源<input className="field w-full" value={check.resource} onChange={(event) => update(index, { resource: event.target.value })} placeholder="例如 e2e-database，可留空" /></label>
      <label>超时（秒）<input className="field w-24" type="number" min={1} max={3600} value={check.timeoutMs / 1000} onChange={(event) => update(index, { timeoutMs: Number(event.target.value) * 1000 })} /></label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={check.required} onChange={(event) => update(index, { required: event.target.checked })} />必需检查</label>
      <button type="button" className="btn btn-ghost" onClick={() => setChecks(checks.filter((_, position) => position !== index))}>移除</button>
    </fieldset>)}
    {!checks.some((check) => check.required) ? <p className="mt-2 text-sm text-danger">未配置必需检查，交付将显示未验证，不能验收合入。</p> : null}
    <h3 className="mt-4 text-sm font-semibold">3. 执行安排</h3><div className="mt-3"><label className="text-sm">并发上限<input aria-label="并发上限" type="number" min={1} max={16} className="field ml-2 w-20" value={concurrency} onChange={(event) => setConcurrency(Number(event.target.value))} required /></label><p className="mt-2 text-sm text-mute">默认逐条执行；提高并发后可同时推进独立需求。</p></div>
    <div className="mt-3 flex gap-2"><button type="button" className="btn btn-secondary" onClick={() => setChecks([...checks, { id: crypto.randomUUID(), name: "回归检查", command: "", required: true, timeoutMs: 600000, resource: "" }])}>添加检查</button>
      <button type="submit" className="btn btn-primary" disabled={busy || !info?.isGit}>{busy ? "正在保存…" : "保存编排设置"}</button></div>
    {config ? <button type="button" className="btn btn-ghost mt-3" disabled={busy} onClick={onOpenStandard}>项目文件与规范</button> : null}
    {error ? <p role="alert" className="mt-2 text-sm text-danger">{error}</p> : null}
  </form><section role="tabpanel" id="project-settings-panel-documents" aria-labelledby="project-settings-tab-documents" hidden={settingsTab !== "documents"}><DocumentSettings projectId={projectId} state={state} /></section></div>;
}
