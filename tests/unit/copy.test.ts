import { describe, expect, it } from "vitest";
import {
  branchRoleLabel,
  composerPlaceholder,
  headerSubtitle,
  isVisibleBranchNode,
  nextHint,
  toolNameLabel,
  visibleBranchNodes,
} from "../../apps/web/src/copy.ts";
import { abnormalStopNotice, runStatusStage } from "../../apps/web/src/lib/run-status.ts";

describe("branch tree presentation", () => {
  it("uses short Chinese labels instead of raw Pi role names", () => {
    expect(branchRoleLabel("user")).toBe("你");
    expect(branchRoleLabel("assistant")).toBe("AI");
    expect(branchRoleLabel("toolResult")).toBe("工具");
    expect(branchRoleLabel("model_change")).toBe("模型");
    expect(branchRoleLabel("thinking_level")).toBe("思考");
    expect(branchRoleLabel("compaction")).toBe("压缩");
    expect(branchRoleLabel("unknown_role")).toBe("其他");
  });

  it("hides model/thinking noise and empty assistant rows", () => {
    expect(isVisibleBranchNode({ role: "user", text: "" })).toBe(true);
    expect(isVisibleBranchNode({ role: "assistant", text: "收到" })).toBe(true);
    expect(isVisibleBranchNode({ role: "assistant", text: "" })).toBe(false);
    expect(isVisibleBranchNode({ role: "toolResult", text: "Operation aborted" })).toBe(true);
    expect(isVisibleBranchNode({ role: "toolResult", text: "  " })).toBe(false);
    expect(isVisibleBranchNode({ role: "model_change", text: "" })).toBe(false);
    expect(isVisibleBranchNode({ role: "thinking_level", text: "high" })).toBe(false);
  });

  it("keeps forkable user turns and promotes 当前 when the leaf is hidden", () => {
    const nodes = visibleBranchNodes([
      { id: "u1", role: "user", text: "测试", leaf: false },
      { id: "m1", role: "model_change", text: "", leaf: false },
      { id: "a1", role: "assistant", text: "", leaf: false },
      { id: "t1", role: "toolResult", text: "On branch main", leaf: false },
      { id: "a2", role: "assistant", text: "", leaf: true },
    ]);
    expect(nodes.map((node) => node.id)).toEqual(["u1", "t1"]);
    expect(nodes[1]?.leaf).toBe(true);
  });
});

describe("running status copy", () => {
  it("keeps keyboard hints in the composer, not the header subtitle", () => {
    expect(headerSubtitle("/tmp/MyPi", true, "running")).toBe("MyPi");
    expect(headerSubtitle("/tmp/MyPi", true, "idle")).toBe("MyPi");
    expect(headerSubtitle(undefined, false, "idle")).toBe("点 + 开始聊天");
    expect(nextHint("running", true)).not.toMatch(/回车补充/);
  });

  it("does not repeat live progress copy in the composer placeholder", () => {
    const busy = composerPlaceholder(true);
    expect(busy).toBe("回车补充，Shift+Enter 排队");
    expect(busy).not.toMatch(/正在处理|正在回复|等待/);
    expect(composerPlaceholder(true, "followUp")).toBe("回车排队，Shift+Enter 补充");
    expect(composerPlaceholder(false)).toBe("输入消息");
  });

  it("does not repeat the live command in the status bar", () => {
    const stage = runStatusStage(
      "running",
      [
        {
          toolCallId: "1",
          toolName: "bash",
          status: "running",
          target: "gh run list --limit 5",
        },
      ],
      false,
    );
    expect(stage?.label).toBe("正在处理");
    expect(stage?.detail).toBe("");
  });

  it("shows sending while waiting for prompt ack", () => {
    expect(runStatusStage("idle", [], false, null, null, true)?.label).toBe("正在发送");
  });

  it("labels abnormal stops clearly", () => {
    expect(runStatusStage("error", [], false, null, "Pi 进程退出")?.label).toBe("对话异常停止");
    expect(runStatusStage("error", [], false, null, "Pi 进程退出")?.detail).toBe("Pi 进程退出");
    expect(runStatusStage("error", [], false, null, "Pi 进程退出")?.kind).toBe("error");
    expect(abnormalStopNotice("Pi 进程退出")).toBe("对话异常停止：Pi 进程退出");
    expect(abnormalStopNotice(null)).toMatch(/对话异常停止/);
  });

  it("uses the tool name without a second 正在 prefix", () => {
    expect(toolNameLabel("bash")).toBe("运行命令");
  });
});
