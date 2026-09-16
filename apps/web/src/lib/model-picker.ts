import type { ThinkingLevel } from "@qingzhou/protocol";

export type PickerModel = {
  provider: string;
  id: string;
  name?: string;
  reasoning?: boolean;
  thinkingLevels?: ThinkingLevel[];
};

export const THINKING_LABEL: Record<ThinkingLevel, string> = {
  off: "关闭",
  minimal: "很少",
  low: "较低",
  medium: "中等",
  high: "较高",
  xhigh: "很高",
  max: "最大",
};

export const THINKING_SHORT: Record<ThinkingLevel, string> = {
  off: "关",
  minimal: "微",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极",
  max: "最",
};

export function modelKey(model: PickerModel): string {
  return `${model.provider}/${model.id}`;
}

export function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(length - 1, Math.max(0, Math.round(index)));
}

export function indexOfModel(models: PickerModel[], modelId: string | null): number {
  const index = models.findIndex((model) => modelKey(model) === modelId);
  return index < 0 ? 0 : index;
}

export function indexOfThinking(levels: ThinkingLevel[], level: ThinkingLevel): number {
  const index = levels.indexOf(level);
  return index < 0 ? 0 : index;
}

export function nextModelIndex(models: PickerModel[], modelId: string | null): number {
  if (models.length === 0) return 0;
  return (indexOfModel(models, modelId) + 1) % models.length;
}

export function sliderPercent(index: number, length: number): number {
  if (length <= 1) return 0;
  return (clampIndex(index, length) / (length - 1)) * 100;
}

export function capsuleModelLabel(
  modelLabel: string,
  thinkingLevel: ThinkingLevel,
  fastOn = false,
): string {
  const thinking = thinkingLevel !== "off" ? ` ${THINKING_SHORT[thinkingLevel] ?? thinkingLevel}` : "";
  const fast = fastOn ? " Fast" : "";
  return `${modelLabel}${thinking}${fast}`;
}

export function pickerThinkingLevels(
  model: PickerModel | undefined,
  sessionLevels: ThinkingLevel[],
): ThinkingLevel[] {
  if (model?.thinkingLevels && model.thinkingLevels.length > 0) return model.thinkingLevels;
  if (model?.reasoning === false) return ["off"];
  return sessionLevels.length > 0 ? sessionLevels : ["off"];
}

export function groupPickerModels(
  models: PickerModel[],
  defaultModelId: string | null,
): { defaultModels: PickerModel[]; recommended: PickerModel[] } {
  const pinned = defaultModelId ? models.find((model) => modelKey(model) === defaultModelId) : undefined;
  const pinnedKey = pinned ? modelKey(pinned) : null;
  return {
    defaultModels: pinned ? [pinned] : [],
    recommended: pinnedKey ? models.filter((model) => modelKey(model) !== pinnedKey) : models,
  };
}
