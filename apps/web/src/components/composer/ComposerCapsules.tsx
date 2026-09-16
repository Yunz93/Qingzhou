import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { ApprovalPolicy, InteractionMode, ThinkingLevel } from "@qingzhou/protocol";
import { approvalPolicies, interactionModes } from "@qingzhou/protocol";
import { Check, ChevronDown, RotateCw, Star, Zap } from "lucide-react";
import {
  THINKING_LABEL,
  capsuleModelLabel,
  clampIndex,
  groupPickerModels,
  indexOfThinking,
  modelKey,
  nextModelIndex,
  pickerThinkingLevels,
  sliderPercent,
  type PickerModel,
} from "../../lib/model-picker";

type Props = {
  slot: "mode" | "model";
  mode: InteractionMode;
  approvalPolicy: ApprovalPolicy;
  models: PickerModel[];
  modelId: string | null;
  defaultModelId?: string | null;
  thinkingLevel: ThinkingLevel;
  thinkingLevels: ThinkingLevel[];
  onPolicy: (mode: InteractionMode, approvalPolicy: ApprovalPolicy) => void;
  onModel: (provider: string, modelId: string) => void;
  onDefaultModel?: (provider: string, modelId: string) => void;
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
  defaultModelId = null,
  thinkingLevel,
  thinkingLevels,
  onPolicy,
  onModel,
  onDefaultModel,
  onThinking,
  fastModeEnabled,
  fastModeActive,
  onFastMode,
}: Props) {
  const [open, setOpen] = useState(false);
  const [modelListOpen, setModelListOpen] = useState(false);
  const [pendingModelKey, setPendingModelKey] = useState<string | null>(null);
  const [pendingThinking, setPendingThinking] = useState<ThinkingLevel | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const modeLabel = interactionModes.find((item) => item.value === mode)?.label ?? mode;
  const policyLabel = approvalPolicies.find((item) => item.value === approvalPolicy)?.label ?? approvalPolicy;
  const activeModelKey = pendingModelKey ?? modelId;
  const activeModel = models.find((model) => modelKey(model) === activeModelKey);
  const currentModel = models.find((model) => modelKey(model) === modelId);
  const modelLabel =
    activeModel?.name ??
    activeModel?.id ??
    currentModel?.name ??
    currentModel?.id ??
    (models.length === 0 ? "暂无模型" : "选择模型");
  const fastOn = fastModeActive === true || (fastModeActive !== false && fastModeEnabled === true);
  const grouped = groupPickerModels(models, defaultModelId);
  const capsuleLabel = capsuleModelLabel(
    currentModel?.name ?? currentModel?.id ?? modelLabel,
    thinkingLevel,
    fastOn,
  );
  const intensityLevels = pickerThinkingLevels(activeModel ?? currentModel, thinkingLevels);
  const activeThinking =
    pendingThinking && intensityLevels.includes(pendingThinking) ? pendingThinking : thinkingLevel;
  const thinkingIndex = indexOfThinking(intensityLevels, activeThinking);

  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setModelListOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (!open) setModelListOpen(false);
  }, [open]);

  useEffect(() => {
    if (pendingModelKey && pendingModelKey === modelId) setPendingModelKey(null);
  }, [modelId, pendingModelKey]);

  useEffect(() => {
    if (pendingThinking && pendingThinking === thinkingLevel) setPendingThinking(null);
  }, [thinkingLevel, pendingThinking]);

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
    if (!model) return;
    setPendingModelKey(modelKey(model));
    setPendingThinking(null);
    onModel(model.provider, model.id);
  };

  const pickThinkingAt = (index: number) => {
    const level = intensityLevels[clampIndex(index, intensityLevels.length)];
    if (!level) return;
    setPendingThinking(level);
    onThinking(level);
  };

  const renderModelItem = (model: PickerModel, keyPrefix: string) => {
    const id = modelKey(model);
    const selected = id === modelId;
    const isDefault = id === defaultModelId;
    const name = model.name ?? model.id;
    return (
      <div
        key={`${keyPrefix}-${id}`}
        className={`model-picker-list-item ${selected ? "model-picker-list-item-on" : ""}`}
      >
        <button
          type="button"
          role="menuitem"
          aria-label={name}
          aria-current={selected ? "true" : undefined}
          className="pressable model-picker-list-name"
          onClick={() => {
            setPendingModelKey(id);
            setPendingThinking(null);
            onModel(model.provider, model.id);
            setModelListOpen(false);
            setOpen(false);
          }}
        >
          <span>{name}</span>
          {selected ? <Check size={14} strokeWidth={2.2} aria-hidden /> : null}
        </button>
        <button
          type="button"
          className={`pressable model-picker-default-btn ${isDefault ? "model-picker-default-btn-on" : ""}`}
          aria-label={isDefault ? `默认模型 ${name}` : `设为默认 ${name}`}
          aria-pressed={isDefault}
          title={isDefault ? "默认模型" : "设为默认模型"}
          disabled={!onDefaultModel}
          onClick={() => onDefaultModel?.(model.provider, model.id)}
        >
          <Star size={13} strokeWidth={2} fill={isDefault ? "currentColor" : "none"} />
        </button>
      </div>
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
      {open && modelListOpen && models.length > 0 ? (
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

      {open && !modelListOpen ? (
        <div className="model-picker" role="dialog" aria-label="模型和思考">
          <div className="model-picker-head">
            <button
              type="button"
              className={`pressable model-picker-icon ${fastOn ? "model-picker-icon-on" : ""}`}
              aria-label="Fast 模式"
              aria-pressed={fastOn}
              title={fastOn ? "Fast 模式 · 开" : "Fast 模式 · 关"}
              onClick={() => onFastMode?.(!fastOn)}
            >
              <Zap size={15} strokeWidth={2} fill={fastOn ? "currentColor" : "none"} />
            </button>
            <button
              type="button"
              className="pressable model-picker-name"
              aria-haspopup="menu"
              aria-expanded={modelListOpen}
              aria-label="选择模型"
              disabled={models.length === 0}
              onClick={() => setModelListOpen(true)}
            >
              {modelLabel}
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

          {models.length === 0 ? (
            <p className="model-picker-empty">暂无模型</p>
          ) : intensityLevels.length > 1 ? (
            <div className="model-picker-slider-wrap">
              <input
                type="range"
                className="model-picker-slider"
                min={0}
                max={Math.max(0, intensityLevels.length - 1)}
                step={1}
                value={thinkingIndex}
                aria-label="滑动选择思考强度"
                aria-valuetext={THINKING_LABEL[activeThinking] ?? activeThinking}
                style={{ "--slider-pct": `${sliderPercent(thinkingIndex, intensityLevels.length)}%` } as CSSProperties}
                onChange={(event) => pickThinkingAt(Number(event.target.value))}
              />
              {intensityLevels.length <= 8 ? (
                <div className="model-picker-dots" aria-hidden>
                  {intensityLevels.map((level, index) => (
                    <span
                      key={level}
                      className={`model-picker-dot ${index <= thinkingIndex ? "model-picker-dot-on" : ""}`}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="model-picker-empty">该模型不支持思考强度</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
