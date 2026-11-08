import { useEffect, useRef, useState } from "react";
import type { socketClient } from "../transport/socket-client";

export type WorkflowSend = (type: Parameters<typeof socketClient.send>[0], payload: object) => Promise<void>;

/** Keep one action in flight per editor, including before React renders busy. */
export function useWorkflowAction(owner: string) {
  const scope = useRef({ owner, active: true, pending: false });
  if (scope.current.owner !== owner) scope.current = { owner, active: true, pending: false };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const current = scope.current;
    current.active = true; setBusy(false); setError("");
    return () => { current.active = false; };
  }, [owner]);
  async function run<T>(operation: () => Promise<T>, completed?: (result: T) => void | Promise<void>) {
    const current = scope.current;
    if (!current.active || current.pending) return;
    const live = () => current.active && current === scope.current;
    current.pending = true; setBusy(true); setError("");
    try {
      const result = await operation();
      if (live()) await completed?.(result);
    } catch (reason) { if (live()) setError(reason instanceof Error ? reason.message : "操作失败，请重试"); }
    finally { current.pending = false; if (live()) setBusy(false); }
  }
  return { busy, error, setError, run };
}
