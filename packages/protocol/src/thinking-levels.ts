import type { ThinkingLevel } from "./task-schema.js";

export const THINKING_LEVELS: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

const EXTENDED_THINKING_LEVELS: ThinkingLevel[] = ["xhigh", "max"];

export type ThinkingLevelMap = Partial<Record<ThinkingLevel, string | null>>;

/**
 * Thinking steps a model exposes in the picker.
 * Matches Pi: no reasoning → `off` only; omitted map keys through `high` use
 * defaults; `xhigh` / `max` need an explicit map entry; `null` hides a level.
 */
export function thinkingLevelsForModel(model: {
  reasoning?: boolean;
  thinkingLevelMap?: ThinkingLevelMap;
}): ThinkingLevel[] {
  if (!model.reasoning) return ["off"];
  const map = model.thinkingLevelMap;
  return THINKING_LEVELS.filter((level) => {
    const mapped = map?.[level];
    if (mapped === null) return false;
    if (EXTENDED_THINKING_LEVELS.includes(level)) return mapped !== undefined;
    return true;
  });
}

export function parseThinkingLevelMap(raw: unknown): ThinkingLevelMap | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const map: ThinkingLevelMap = {};
  let present = false;
  for (const level of THINKING_LEVELS) {
    if (!Object.prototype.hasOwnProperty.call(record, level)) continue;
    const value = record[level];
    map[level] = value === null ? null : String(value);
    present = true;
  }
  return present ? map : undefined;
}

export function thinkingLevelsFromPiModel(raw: Record<string, unknown>): ThinkingLevel[] {
  return thinkingLevelsForModel({
    reasoning: Boolean(raw.reasoning),
    thinkingLevelMap: parseThinkingLevelMap(raw.thinkingLevelMap),
  });
}
