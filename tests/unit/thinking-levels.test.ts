import { describe, expect, it } from "vitest";
import { thinkingLevelsForModel, thinkingLevelsFromPiModel } from "../../packages/protocol/src/index.ts";

describe("thinkingLevelsForModel", () => {
  it("returns off only when the model cannot reason", () => {
    expect(thinkingLevelsForModel({ reasoning: false })).toEqual(["off"]);
    expect(thinkingLevelsFromPiModel({ id: "plain" })).toEqual(["off"]);
  });

  it("uses standard levels through high when reasoning has no map", () => {
    expect(thinkingLevelsForModel({ reasoning: true })).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
    ]);
  });

  it("hides null map entries and only adds xhigh/max when listed", () => {
    expect(
      thinkingLevelsForModel({
        reasoning: true,
        thinkingLevelMap: { minimal: null, low: "low", high: "high", max: "max" },
      }),
    ).toEqual(["off", "low", "medium", "high", "max"]);
    expect(
      thinkingLevelsFromPiModel({
        reasoning: true,
        thinkingLevelMap: { xhigh: "xhigh", max: "max" },
      }),
    ).toEqual(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
  });
});
