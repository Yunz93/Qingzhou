import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkflowProjectState } from "@qingzhou/protocol";
import { socketClient } from "../transport/socket-client";
import { useAgentStore } from "../stores/agent-store";

export function useProjectWorkflow(projectId: string | undefined) {
  const connection = useAgentStore(state => state.connection);
  const items = useAgentStore(state => state.workItems);
  const [snapshot, setSnapshot] = useState<{ projectId: string; value: WorkflowProjectState } | null>(null);
  const [error, setError] = useState("");
  const activeProject = useRef(projectId);
  activeProject.current = projectId;
  const generation = useRef(0);
  const invalidate = useCallback(() => { generation.current++; }, []);
  const refresh = useCallback(async () => {
    if (!projectId || activeProject.current !== projectId || connection !== "open") return;
    const request = ++generation.current;
    const live = () => request === generation.current && activeProject.current === projectId;
    try {
      const value = await socketClient.send<WorkflowProjectState>("workflow.state", { projectId });
      if (live()) { setSnapshot({ projectId, value }); setError(""); }
    } catch (reason) { if (live()) setError(reason instanceof Error ? reason.message : String(reason)); }
  }, [projectId, connection]);
  useEffect(() => { setSnapshot(null); setError(""); return invalidate; }, [projectId, invalidate]);
  useEffect(() => { void refresh(); return invalidate; }, [refresh, items, invalidate]);
  useEffect(() => {
    if (connection !== "open" || !projectId) return;
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 5000);
    return () => clearInterval(timer);
  }, [connection, projectId, refresh]);
  return { state: snapshot && snapshot.projectId === projectId ? snapshot.value : null, error, refresh };
}
