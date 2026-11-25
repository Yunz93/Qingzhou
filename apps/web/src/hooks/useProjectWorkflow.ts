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
  const issued = useRef(0);
  const applied = useRef(0);
  const invalidate = useCallback(() => { generation.current++; }, []);
  const refresh = useCallback(async () => {
    if (!projectId || activeProject.current !== projectId || connection !== "open") return;
    const activation = generation.current;
    const request = ++issued.current;
    const apply = () => {
      if (activation !== generation.current || activeProject.current !== projectId || request <= applied.current) return false;
      applied.current = request;
      return true;
    };
    try {
      const value = await socketClient.send<WorkflowProjectState>("workflow.state", { projectId });
      if (apply()) { setSnapshot({ projectId, value }); setError(""); }
    } catch (reason) { if (apply()) setError(reason instanceof Error ? reason.message : String(reason)); }
  }, [projectId, connection]);
  useEffect(() => { setSnapshot(null); setError(""); }, [projectId]);
  useEffect(() => invalidate, [projectId, connection, invalidate]);
  useEffect(() => { void refresh(); }, [refresh, items]);
  useEffect(() => {
    if (connection !== "open" || !projectId) return;
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 5000);
    return () => clearInterval(timer);
  }, [connection, projectId, refresh]);
  return { state: snapshot && snapshot.projectId === projectId ? snapshot.value : null, error, refresh };
}
