import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { ApprovalPolicy, InteractionMode, ThinkingLevel } from "@qingzhou/protocol";
import { approvalPolicies, interactionModes } from "@qingzhou/protocol";
import { Check, ChevronDown, ChevronRight, RotateCw, Zap } from "lucide-react";
import {
  THINKING_LABEL,
  THINKING_SHORT,
  capsuleModelLabel,
  clampIndex,
  groupPickerModels,
  indexOfModel,
  modelKey,
  nextModelIndex,
  sliderPercent,
  type PickerModel,
} from "../../lib/model-picker";

type Props = {
  slot: "mode" | "model";
  mode: InteractionMode;
  approvalPolicy: ApprovalPolicy;
  models: PickerModel[];
  modelId: string | null;
  thinkingLevel: ThinkingLevel;
  thinkingLevels: ThinkingLevel[];
  onPolicy: (mode: InteractionMode, approvalPolicy: ApprovalPolicy) => void;
  onModel: (provider: string, modelId: string) => void;
  onThinking: (level: ThinkingLevel) => void;
  fastModeEnabled?: boolean;
  fastModeActive?: boolean;
  onFastMode?: (enabled: boolean) => void;
};

export function ComposerCapsules({
  slot,
  mode,
  approvalPolicy,
  models,
  modelId,
  thinkingLevel,
  thinkingLevels,
  onPolicy,
  onModel,
  onThinking,
  fastModeEnabled,
  fastModeActive,
  onFastMode,
}: Props) {
  const [open, setOpen] = useState(false);
  const [intensityOpen, setIntensityOpen] = useState(false);
  const [modelListOpen, setModelListOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const modeLabel = interactionModes.find((item) => item.value === mode)?.label ?? mode;
  const policyLabel = approvalPolicies.find((item) => item.value === approvalPolicy)?.label ?? approvalPolicy;
  const currentModel = models.find((model) => modelKey(model) === modelId);
  const modelLabel = currentModel?.name ?? currentModel?.id ?? (models.length === 0 ? "暂无模型" : "选择模型");
  const thinkingShort = THINKING_SHORT[thinkingLevel] ?? thinkingLevel;
  const showFast = typeof fastModeEnabled === "boolean" && onFastMode;
  const fastOn = fastModeActive === true || (fastModeActive !== false && fastModeEnabled === true);
  const modelIndex = indexOfModel(models, modelId);
  const grouped = groupPickerModels(models, modelId);
  const capsuleLabel = capsuleModelLabel(modelLabel, thinkingLevel, showFast && fastOn);

  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setIntensityOpen(false);
        setModelListOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (!open) {
      setIntensityOpen(false);
      setModelListOpen(false);
    }
  }, [open]);

  if (slot === "mode") {
    return (
      <div ref={rootRef} className="relative min-w-0">
        <button
          type="button"
          className="pressable composer-capsule"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="模式"
          onClick={() => setOpen((value) => !value)}
        >
          <span className="min-w-0 truncate">
            {mode === "agent" ? `${modeLabel} · ${policyLabel}` : `${modeLabel} · 只读`}
          </span>
          <ChevronDown size={12} strokeWidth={2} className="shrink-0 opacity-70" />
        </button>
        {open ? (
          <div className="composer-popover" role="menu" aria-label="模式">
            {interactionModes.map((item) => (
              <button
                key={item.value}
                type="button"
                role="menuitem"
                className={`pressable composer-popover-item ${mode === item.value ? "composer-popover-active" : ""}`}
                onClick={() => {
                  onPolicy(item.value, item.value === "agent" ? approvalPolicy : "read_only");
                  if (item.value !== "agent") setOpen(false);
                }}
              >
                {item.label}
              </button>
            ))}
            {mode === "agent" ? (
              <>
                <div className="composer-popover-sep" />
                {approvalPolicies.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    role="menuitem"
                    className={`pressable composer-popover-item ${approvalPolicy === item.value ? "composer-popover-active" : ""}`}
                    onClick={() => {
                      onPolicy(mode, item.value);
                      setOpen(false);
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  const pickModelAt = (index: number) => {
    const model = models[clampIndex(index, models.length)];
    if (model) onModel(model.provider, model.id);
  };

  const pickThinkingAt = (index: number) => {
    const level = thinkingLevels[clampIndex(index, thinkingLevels.length)];
    if (level) onThinking(level);
  };

  const renderModelItem = (model: PickerModel, keyPrefix: string) => {
    const id = modelKey(model);
    const selected = id === modelId;
    return (
      <button
        key={`${keyPrefix}-${id}`}
        type="button"
        role="menuitem"
        aria-label={model.name ?? model.id}
        className={`pressable model-picker-list-item ${selected ? "model-picker-list-item-on" : ""}`}
        onClick={() => {
          onModel(model.provider, model.id);
          setModelListOpen(false);
        }}
      >
        <span>{model.name ?? model.id}</span>
        {selected ? <Check size={14} strokeWidth={2.2} aria-hidden /> : null}
      </button>
    );
  };

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        className="pressable composer-capsule"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="模型和思考"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="min-w-0 truncate">{capsuleLabel}</span>
        <ChevronDown size={12} strokeWidth={2} className="shrink-0 opacity-70" />
      </button>
      {open ? (
        <div className="model-picker" role="dialog" aria-label="模型和思考">
          <div className="model-picker-head">
            {showFast ? (
              <button
                type="button"
                className={`pressable model-picker-icon ${fastOn ? "model-picker-icon-on" : ""}`}
                aria-label="Fast 模式"
                aria-pressed={fastOn}
                title={fastOn ? "Fast 模式 · 开" : "Fast 模式 · 关"}
                onClick={() => onFastMode?.(!fastModeEnabled)}
              >
                <Zap size={15} strokeWidth={2} fill={fastOn ? "currentColor" : "none"} />
              </button>
            ) : (
              <span className="model-picker-icon model-picker-icon-ghost" aria-hidden>
                <Zap size={15} strokeWidth={2} />
              </span>
            )}
            <button
              type="button"
              className="pressable model-picker-level"
              aria-haspopup="menu"
              aria-expanded={intensityOpen}
              aria-label="思考强度"
              onClick={() => {
                setIntensityOpen((value) => !value);
                setModelListOpen(false);
              }}
            >
              {thinkingShort}
              <ChevronRight size={13} strokeWidth={2} />
            </button>
            <button
              type="button"
              className="pressable model-picker-icon"
              aria-label="下一个模型"
              disabled={models.length < 2}
              onClick={() => pickModelAt(nextModelIndex(models, modelId))}
            >
              <RotateCw size={14} strokeWidth={2} />
            </button>
          </div>

          <button
            type="button"
            className="pressable model-picker-name"
            aria-haspopup="menu"
            aria-expanded={modelListOpen}
            aria-label="选择模型"
            disabled={models.length === 0}
            onClick={() => {
              setModelListOpen((value) => !value);
              setIntensityOpen(false);
            }}
          >
            {modelLabel}
          </button>

          {models.length > 0 ? (
            <div className="model-picker-slider-wrap">
              <input
                type="range"
                className="model-picker-slider"
                min={0}
                max={Math.max(0, models.length - 1)}
                step={1}
                value={modelIndex}
                aria-label="滑动选择模型"
                style={{ "--slider-pct": `${sliderPercent(modelIndex, models.length)}%` } as CSSProperties}
                onChange={(event) => pickModelAt(Number(event.target.value))}
              />
              {models.length > 1 && models.length <= 8 ? (
                <div className="model-picker-dots" aria-hidden>
                  {models.map((model, index) => (
                    <span
                      key={modelKey(model)}
                      className={`model-picker-dot ${index <= modelIndex ? "model-picker-dot-on" : ""}`}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="model-picker-empty">暂无模型</p>
          )}

          <div className="model-picker-foot">
            <button
              type="button"
              className="pressable model-picker-intensity"
              aria-haspopup="menu"
              aria-expanded={intensityOpen}
              onClick={() => {
                setIntensityOpen((value) => !value);
                setModelListOpen(false);
              }}
            >
              选择强度
              <ChevronDown size={12} strokeWidth={2} />
            </button>
          </div>

          {intensityOpen ? (
            <div className="model-picker-menu" role="menu" aria-label="思考强度">
              {thinkingLevels.map((level, index) => (
                <button
                  key={level}
                  type="button"
                  role="menuitem"
                  className={`pressable composer-popover-item ${thinkingLevel === level ? "composer-popover-active" : ""}`}
                  onClick={() => {
                    pickThinkingAt(index);
                    setIntensityOpen(false);
                  }}
                >
                  思考：{THINKING_LABEL[level] ?? level}
                </button>
              ))}
            </div>
          ) : null}

          {modelListOpen && models.length > 0 ? (
            <div className="model-picker-list" role="menu" aria-label="选择模型">
              <p className="model-picker-list-title">选择模型</p>
              {grouped.defaultModels.length > 0 ? (
                <>
                  <p className="model-picker-list-group">默认</p>
                  {grouped.defaultModels.map((model) => renderModelItem(model, "default"))}
                </>
              ) : null}
              {grouped.recommended.length > 0 ? (
                <>
                  <p className="model-picker-list-group">推荐模型集</p>
                  {grouped.recommended.map((model) => renderModelItem(model, "rec"))}
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
