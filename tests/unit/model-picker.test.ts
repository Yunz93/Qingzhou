import { describe, expect, it } from "vitest";
import {
  THINKING_SHORT,
  capsuleModelLabel,
  clampIndex,
  groupPickerModels,
  indexOfModel,
  modelKey,
  nextModelIndex,
  pickerThinkingLevels,
  sliderPercent,
} from "../../apps/web/src/lib/model-picker.ts";

const models = [
  { provider: "openai", id: "gpt-5.4", name: "GPT-5.4" },
  { provider: "google", id: "gemini", name: "Gemini" },
  { provider: "anthropic", id: "opus", name: "Opus" },
];

describe("model picker helpers", () => {
  it("maps the current model to a slider index and percent", () => {
    expect(modelKey(models[0])).toBe("openai/gpt-5.4");
    expect(indexOfModel(models, "google/gemini")).toBe(1);
    expect(indexOfModel(models, null)).toBe(0);
    expect(sliderPercent(1, 3)).toBe(50);
    expect(sliderPercent(0, 1)).toBe(0);
    expect(clampIndex(9, 3)).toBe(2);
  });

  it("cycles to the next model and shortens thinking labels", () => {
    expect(nextModelIndex(models, "openai/gpt-5.4")).toBe(1);
    expect(nextModelIndex(models, "anthropic/opus")).toBe(0);
    expect(THINKING_SHORT.high).toBe("高");
    expect(capsuleModelLabel("GPT-6 Astra", "high")).toBe("GPT-6 Astra 高");
    expect(capsuleModelLabel("GPT-6 Astra", "off", true)).toBe("GPT-6 Astra Fast");
  });

  it("groups the current model as 默认 and the rest as 推荐模型集", () => {
    const grouped = groupPickerModels(models, "google/gemini");
    expect(grouped.defaultModels.map((model) => model.id)).toEqual(["gemini"]);
    expect(grouped.recommended.map((model) => model.id)).toEqual(["gpt-5.4", "opus"]);
    expect(groupPickerModels(models, null).recommended).toHaveLength(3);
  });

  it("uses the selected model's thinking steps instead of the session list", () => {
    expect(pickerThinkingLevels({ provider: "fake", id: "plain", reasoning: false }, ["off", "high"])).toEqual([
      "off",
    ]);
    expect(
      pickerThinkingLevels(
        { provider: "fake", id: "max", thinkingLevels: ["off", "high", "max"] },
        ["off", "low", "high"],
      ),
    ).toEqual(["off", "high", "max"]);
  });
});
