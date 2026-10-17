import type { WorkflowTicket } from "@qingzhou/protocol";

/** Progress describes the current scope, even when an older delivery was merged. */
export function requirementProgress(input: {
  scopeId?: string;
  implementation?: Pick<WorkflowTicket, "scopeId" | "status">;
  valid: boolean; accepted: boolean; merged: boolean; hasDelivery: boolean;
}) {
  const { implementation } = input;
  const running = implementation?.status === "queued" || implementation?.status === "running";
  const needsImplementation = !implementation || implementation.scopeId !== input.scopeId
    || ["failed", "interrupted", "cancelled"].includes(implementation.status);
  const stage = running || needsImplementation ? 0 : input.merged ? 4 : input.accepted ? 3
    : input.valid ? 2 : implementation?.status === "finished" || input.hasDelivery ? 1 : 0;
  return { stage, canStart: needsImplementation && !running };
}
