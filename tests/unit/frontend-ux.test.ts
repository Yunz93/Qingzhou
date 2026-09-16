import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { approvalRiskLevel, splitDangerousCommand } from "../../apps/web/src/lib/approval-risk.ts";
import { clampInspectorWidth, INSPECTOR_WIDTH_MIN, busySubmitKind } from "../../apps/web/src/lib/ui-prefs.ts";
import { groupToolExecutions, toolGroupLabel } from "../../apps/web/src/lib/tool-groups.ts";
import { shortcutLabel } from "../../apps/web/src/lib/hotkeys.ts";
import { taskStatusTone, workViewTone } from "../../apps/web/src/lib/status-tone.ts";
import type { ToolExecution } from "@qingzhou/protocol";

function tool(name: string, id = name): ToolExecution {
  return {
    toolCallId: id,
    toolName: name,
    status: "succeeded",
    target: name,
  };
}

describe("tool grouping", () => {
  it("collapses consecutive read-only tools", () => {
    const grouped = groupToolExecutions([tool("read", "1"), tool("grep", "2"), tool("write", "3"), tool("ls", "4")]);
    expect(grouped).toHaveLength(3);
    expect(grouped[0]).toMatchObject({ kind: "group" });
    expect(grouped[1]).toMatchObject({ kind: "single" });
    expect(grouped[2]).toMatchObject({ kind: "single" });
    expect(toolGroupLabel([tool("read", "a"), tool("read", "b")])).toBe("读取了 2 个文件");
  });
});

describe("approval risk", () => {
  it("marks high-risk bash and highlights fragments", () => {
    expect(approvalRiskLevel({ toolName: "bash", rawCommand: "sudo rm -rf /tmp", target: "" })).toBe("high");
    expect(approvalRiskLevel({ toolName: "write", rawCommand: "", target: "a.ts" })).toBe("medium");
    const parts = splitDangerousCommand("echo hi && sudo rm -rf /tmp");
    expect(parts.some((part) => part.danger && part.text.includes("sudo"))).toBe(true);
  });
});

describe("ui prefs and tones", () => {
  it("clamps inspector width and maps status colors", () => {
    expect(clampInspectorWidth(120, 1200)).toBe(INSPECTOR_WIDTH_MIN);
    expect(clampInspectorWidth(900, 1000)).toBe(600);
    expect(taskStatusTone("running")).toBe("busy");
    expect(taskStatusTone("waiting_approval")).toBe("wait");
    expect(taskStatusTone("error")).toBe("danger");
    expect(workViewTone("completed")).toBe("ok");
    expect(busySubmitKind("steer", false)).toBe("steer");
    expect(busySubmitKind("steer", true)).toBe("followUp");
    expect(busySubmitKind("followUp", true)).toBe("steer");
  });

  it("formats shortcut labels", () => {
    expect(shortcutLabel("Mod+N")).toMatch(/N/);
  });
});

describe("conversation interaction chrome", () => {
  it("exposes jump-to-latest, clone, and image-aware user bubbles", () => {
    const timeline = readFileSync(path.resolve("apps/web/src/components/timeline/ConversationTimeline.tsx"), "utf8");
    expect(timeline).toContain("回到最新");
    expect(timeline).toContain("克隆会话");
    expect(timeline).toContain("附 ");
    expect(timeline).toContain('aria-live="off"');
    expect(timeline).toContain("model-change-banner");
    expect(timeline).toContain("这条提示只显示在对话里，不会发给模型。");
  });

  it("lets the composer switch 追加 and 排队, and always expose Fast", () => {
    const composer = readFileSync(path.resolve("apps/web/src/components/composer/PromptComposer.tsx"), "utf8");
    const capsules = readFileSync(path.resolve("apps/web/src/components/composer/ComposerCapsules.tsx"), "utf8");
    expect(composer).toContain("追加");
    expect(composer).toContain("排队");
    expect(composer).toContain("busySubmitKind");
    expect(composer).toContain("composerCanSubmit");
    expect(composer).toContain("正在启动");
    expect(composer).toContain("aria-label={showStop ? \"停止\" : \"发送\"}");
    expect(composer).toContain("const showStop = running && !canSubmit");
    expect(capsules).toContain("Fast 模式");
    expect(capsules).toContain("model-picker");
    expect(capsules).toContain("滑动选择思考强度");
    expect(capsules).toContain("推荐模型集");
    expect(capsules).toContain("设为默认");
    expect(capsules).toContain("model-picker-list");
    expect(capsules).toContain("pickerThinkingLevels");
    expect(capsules).not.toContain("滑动选择模型");
    expect(capsules).not.toContain("选择强度");
    expect(capsules).not.toContain("model-picker-levels");
    const layout = readFileSync(path.resolve("apps/web/src/layouts/WorkbenchLayout.tsx"), "utf8");
    expect(layout).toContain('onFastMode={(enabled) => void socketClient.send("runtime.set"');
    expect(layout).not.toContain('typeof runtime.fastModeEnabled === "boolean"');
  });
});
