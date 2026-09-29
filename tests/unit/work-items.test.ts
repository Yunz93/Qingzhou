import { describe, expect, it } from "vitest";
import {
  deriveWorkItemViewState,
  workItemCanContinue,
  workItemFeedbackPrompt,
  workItemIsClosed,
  workItemPrompt,
  workLinkedPromptError,
  workLinkedSessionRewriteError,
  WORK_PROMPT_ITEM_CLOSED,
  WORK_PROMPT_NEEDS_BOARD,
  WORK_SESSION_NO_FORK,
  type WorkItemSummary,
  type WorkRun,
} from "../../packages/protocol/src/work-items.ts";

const now = "2026-09-02T00:00:00.000Z";

function latestRun(status: WorkRun["status"]): WorkRun {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    objectiveId: "11111111-1111-4111-8111-111111111111",
    taskId: "33333333-3333-4333-8333-333333333333",
    kind: "initial",
    instruction: "do it",
    status,
    resultSummary: null,
    resultMessageId: null,
    errorMessage: null,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
  };
}

function item(status?: WorkRun["status"], state: WorkItemSummary["state"] = "open") {
  return { state, latestRun: status ? latestRun(status) : null };
}

describe("agent-native work item contracts", () => {
  it("builds an initial prompt from goal, acceptance criteria and pending feedback", () => {
    const prompt = workItemPrompt({
      title: "fix login",
      description: "handle 401",
      acceptanceCriteria: "tests pass",
      feedback: [{ text: "also handle 403" }],
    });
    expect(prompt).toContain("标题：fix login");
    expect(prompt).toContain("目标说明：\nhandle 401");
    expect(prompt).toContain("验收标准：\ntests pass");
    expect(prompt).toContain("补充要求：\nalso handle 403");
    expect(prompt).toContain("不要再等确认");
    expect(prompt).toContain("不要只输出计划就结束");
    expect(prompt).toContain("立即改代码");
  });

  it("builds a continuation prompt that preserves existing progress", () => {
    const prompt = workItemFeedbackPrompt({ title: "fix login" }, "also handle 403");
    expect(prompt).toContain("fix login");
    expect(prompt).toContain("不要重复已经完成的操作");
    expect(prompt).toContain("also handle 403");
    expect(prompt).toContain("不要再等确认");
    expect(prompt).toContain("立即实施");
  });

  it("keeps completion separate from execution status", () => {
    expect(workItemIsClosed("completed")).toBe(true);
    expect(workItemIsClosed("archived")).toBe(true);
    expect(workItemIsClosed("open")).toBe(false);
    expect(workItemCanContinue("open")).toBe(true);
    expect(workItemCanContinue("completed")).toBe(false);
  });

  it("derives attention-first UI states from task and run state", () => {
    expect(deriveWorkItemViewState({ item: item() })).toBe("ready");
    expect(deriveWorkItemViewState({ item: item("queued") })).toBe("queued");
    expect(deriveWorkItemViewState({ item: item("running") })).toBe("working");
    expect(deriveWorkItemViewState({ item: item("succeeded") })).toBe("needs_review");
    expect(deriveWorkItemViewState({ item: item("failed") })).toBe("failed");
    expect(deriveWorkItemViewState({ item: item("aborted") })).toBe("paused");
    expect(deriveWorkItemViewState({ item: item("running"), needsApproval: true })).toBe("needs_approval");
    expect(deriveWorkItemViewState({ item: item("running"), needsInput: true })).toBe("needs_input");
  });

  it("lets accepted and archived state override stale run state", () => {
    expect(deriveWorkItemViewState({ item: item("running", "completed") })).toBe("completed");
    expect(deriveWorkItemViewState({ item: item("failed", "archived") })).toBe("archived");
  });

  it("treats a live run as paused when the task was demoted after a restart", () => {
    expect(deriveWorkItemViewState({ item: item("running"), taskStatus: "stopped" })).toBe("paused");
    expect(deriveWorkItemViewState({ item: item("queued"), taskStatus: "idle" })).toBe("paused");
    expect(deriveWorkItemViewState({ item: item("running"), taskStatus: "running" })).toBe("working");
  });

  it("blocks free-form prompts on work-linked sessions unless a recorded run is starting", () => {
    const open = [{ state: "open" as const }];
    expect(workLinkedPromptError([], undefined, "prompt")).toBeNull();
    expect(workLinkedPromptError(open, undefined, "prompt")).toBe(WORK_PROMPT_NEEDS_BOARD);
    expect(workLinkedPromptError(open, latestRun("queued"), "prompt")).toBe(WORK_PROMPT_NEEDS_BOARD);
    expect(workLinkedPromptError(open, latestRun("queued"), "prompt", { recordedRun: true })).toBeNull();
    expect(workLinkedPromptError(open, latestRun("running"), "steer")).toBeNull();
    expect(workLinkedPromptError(open, undefined, "steer")).toBe(WORK_PROMPT_NEEDS_BOARD);
    expect(workLinkedPromptError([{ state: "completed" }], undefined, "prompt")).toBe(WORK_PROMPT_ITEM_CLOSED);
    expect(workLinkedSessionRewriteError(open)).toBe(WORK_SESSION_NO_FORK);
    expect(workLinkedSessionRewriteError([])).toBeNull();
  });
});
