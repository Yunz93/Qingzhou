import { useState } from "react";
import { getDesktop } from "../../desktop-bridge";
import { useAgentStore } from "../../stores/agent-store";

export function DocumentPath({ projectId, path }: { projectId: string; path?: string }) {
  const repository = useAgentStore((state) => state.workProjects.find((entry) => entry.id === projectId)?.cwd);
  const [notice, setNotice] = useState("");
  if (!path) return null;
  const act = async (action: () => Promise<void>) => { try { await action(); } catch (error) { setNotice(error instanceof Error ? error.message : "文件操作失败"); } };
  return <div className="workflow-document-path"><code>{path}</code><button className="btn btn-ghost" type="button" onClick={() => void act(async () => { await navigator.clipboard.writeText(path); setNotice("路径已复制"); })}>复制路径</button>
    {getDesktop()?.openPath && repository ? <button className="btn btn-ghost" type="button" onClick={() => void act(async () => { const error = await getDesktop()!.openPath!(`${repository.replace(/[\\/]+$/, "")}/${path}`); if (error) throw new Error(error); })}>打开文件</button> : null}
    {notice ? <span role="status" className="text-xs text-mute">{notice}</span> : null}
  </div>;
}
