import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { clientCommandSchema, verificationIsValid, type Verification, type WorkflowConfig } from "@qingzhou/protocol";
import { redactWorkflowLog, safeWorkflowPath } from "../../apps/server/src/tasks/workflow-git.ts";

describe("workflow protocol and evidence", () => {
  const config: WorkflowConfig = {
    projectId: randomUUID(), repository: "/repo", commonDir: "/repo/.git", targetBranch: "release", concurrency: 2, paused: false, revision: 2, updatedAt: new Date().toISOString(),
    checks: [{ id: "required", name: "checks", command: "pnpm test", required: true, timeoutMs: 1000, resource: "db" }],
  };
  const result: Verification = {
    id: randomUUID(), projectId: config.projectId, itemId: null, subjectId: randomUUID(), phase: "delivery", commit: "a".repeat(40), tree: "b".repeat(40), configRevision: 2, environment: "test", status: "passed",
    startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), error: null,
    checks: [{ ...config.checks[0]!, cwd: "/repo", startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), status: "passed", exitCode: 0, output: "", truncated: false }],
  };
  it("requires the exact tree, configuration, required command and real exit code", () => {
    expect(verificationIsValid(result, config, result.tree)).toBe(true);
    expect(verificationIsValid(result, config, "different tree")).toBe(false);
    expect(verificationIsValid(result, { ...config, revision: 3 }, result.tree)).toBe(false);
    expect(verificationIsValid({ ...result, checks: [] }, config, result.tree)).toBe(false);
    expect(verificationIsValid({ ...result, checks: [{ ...result.checks[0]!, exitCode: null }] }, config, result.tree)).toBe(false);
    expect(verificationIsValid({ ...result, checks: [{ ...result.checks[0]!, command: "echo done" }] }, config, result.tree)).toBe(false);
    expect(verificationIsValid({ ...result, status: "queued" }, config, result.tree)).toBe(false);
    expect(verificationIsValid(result, { ...config, checks: [] }, result.tree)).toBe(false);
  });
  it("validates concurrency, explicit paths and delivery-bound acceptance", () => {
    expect(clientCommandSchema.safeParse({ id: "request", type: "workflow.configure", payload: { projectId: config.projectId, targetBranch: "release", concurrency: 0, checks: [] } }).success).toBe(false);
    expect(clientCommandSchema.safeParse({ id: "request", type: "workflow.accept", payload: { id: randomUUID(), decision: "accepted" } }).success).toBe(false);
    expect(clientCommandSchema.safeParse({ id: "request", type: "workflow.seal", payload: { id: randomUUID() } }).success).toBe(false);
  });
  it("rejects Git metadata and path escape while retaining literal Unicode paths", () => {
    for (const file of ["../file", "/etc/passwd", "C:/file", "a/../b", "a/.git/config", "a\\b", "a\0b"]) expect(() => safeWorkflowPath(file)).toThrow();
    expect(safeWorkflowPath("文档/空 格.md")).toBe("文档/空 格.md");
    expect(safeWorkflowPath(":(glob)*")).toBe(":(glob)*"); // Git is always invoked with --literal-pathspecs.
  });
  it("redacts tokens, credential headers and authenticated URLs in saved output", () => {
    const raw = "authorization: Bearer abcdef123456 password=private https://user:pass@example.com ghp_123456789012345678901234 sk-1234567890123456";
    const redacted = redactWorkflowLog(raw);
    for (const secret of ["abcdef123456", "private", "user:pass", "ghp_123456789012345678901234", "sk-1234567890123456"]) expect(redacted).not.toContain(secret);
  });
});

it("accepts image-only requirement continuations but rejects empty input", () => {
  const command = { id: "feedback", operationId: randomUUID(), type: "workItem.feedback", payload: { id: randomUUID(), text: "", imageIds: [randomUUID()] } };
  expect(clientCommandSchema.safeParse(command).success).toBe(true);
  expect(clientCommandSchema.safeParse({ ...command, payload: { ...command.payload, imageIds: [] } }).success).toBe(false);
  expect(clientCommandSchema.safeParse({ ...command, type: "workItem.discuss", payload: { id: command.payload.id, text: "完善验收标准" } }).success).toBe(true);
});
