import { useDialogLayer } from "../../hooks/useDialogLayer";
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

type GearOption<T extends string> = { value: T; label: string };

function GearSlider<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
  ariaLabel,
}: {
  label: string;
  options: GearOption<T>[];
  value: T;
  onChange: (next: T) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  const index = Math.max(
    0,
    options.findIndex((item) => item.value === value),
  );
  const pct = sliderPercent(index, options.length);
  return (
    <div className={`policy-picker-rail ${disabled ? "policy-picker-rail-disabled" : ""}`}>
      <p className="policy-picker-label"><span>{ariaLabel.replace("滑动选择", "")}</span><strong>{label}</strong></p>
      <div className="model-picker-slider-wrap">
        <div className="model-picker-track" style={{ "--slider-pct": `${pct}%` } as CSSProperties} aria-hidden>
          <div className="model-picker-dots">
            {options.map((item) => (
              <span key={item.value} className="model-picker-dot" />
            ))}
          </div>
        </div>
        <input
          type="range"
          className="model-picker-slider"
          min={0}
          max={Math.max(0, options.length - 1)}
          step={1}
          value={index}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-valuetext={options[index]?.label ?? label}
          onChange={(event) => {
            const next = options[clampIndex(Number(event.target.value), options.length)];
            if (next) onChange(next.value);
          }}
        />
      </div>
      <div className="slider-labels">
        {options.map((item) => <button key={item.value} type="button" className="pressable" disabled={disabled} aria-pressed={value === item.value} onClick={() => onChange(item.value)}>{item.label}</button>)}
      </div>
    </div>
  );
}

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
  const [agentPolicy, setAgentPolicy] = useState<ApprovalPolicy>(
    approvalPolicy === "read_only" && mode !== "agent" ? "auto" : approvalPolicy,
  );
  const rootRef = useRef<HTMLDivElement>(null);
  useDialogLayer(rootRef, () => { setOpen(false); setModelListOpen(false); }, open, false);
  useDialogLayer(rootRef, () => setModelListOpen(false), open && modelListOpen, false);
  const modeLabel = interactionModes.find((item) => item.value === mode)?.label ?? mode;
  const effectivePolicy = mode === "agent" ? approvalPolicy : "read_only";
  const policyOptions = effectivePolicy === "workspace"
    ? [...approvalPolicies.slice(0, 2), { value: "workspace" as const, label: "自动改文件" }, ...approvalPolicies.slice(2)]
    : approvalPolicies;
  const policyLabel = policyOptions.find((item) => item.value === effectivePolicy)?.label ?? effectivePolicy;
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

  useEffect(() => {
    if (mode === "agent") setAgentPolicy(approvalPolicy);
  }, [mode, approvalPolicy]);

  if (slot === "mode") {
    return (
      <div ref={rootRef} className="relative min-w-0">
        <button
          type="button"
          className="pressable composer-capsule"
          aria-haspopup="dialog"
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
          <div className="policy-picker" role="dialog" aria-label="模式与审批">
            <GearSlider
              label={modeLabel}
              options={interactionModes}
              value={mode}
              ariaLabel="滑动选择交互模式"
              onChange={(nextMode) => {
                if (nextMode === "agent") {
                  onPolicy(nextMode, agentPolicy);
                } else {
                  onPolicy(nextMode, "read_only");
                }
              }}
            />
            <GearSlider
              label={mode === "agent" ? policyLabel : "只读"}
              options={policyOptions}
              value={mode === "agent" ? approvalPolicy : "read_only"}
              disabled={mode !== "agent"}
              ariaLabel="滑动选择审批策略"
              onChange={(nextPolicy) => {
                setAgentPolicy(nextPolicy);
                onPolicy("agent", nextPolicy);
              }}
            />
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
            <div>
              <p className="policy-picker-label"><span>思考强度</span><strong>{THINKING_LABEL[activeThinking] ?? activeThinking}</strong></p>
              <div className="model-picker-slider-wrap">
              <div
                className="model-picker-track"
                style={{ "--slider-pct": `${sliderPercent(thinkingIndex, intensityLevels.length)}%` } as CSSProperties}
                aria-hidden
              >
                {intensityLevels.length <= 8 ? (
                  <div className="model-picker-dots">
                    {intensityLevels.map((level) => (
                      <span key={level} className="model-picker-dot" />
                    ))}
                  </div>
                ) : null}
              </div>
              <input
                type="range"
                className="model-picker-slider"
                min={0}
                max={Math.max(0, intensityLevels.length - 1)}
                step={1}
                value={thinkingIndex}
                aria-label="滑动选择思考强度"
                aria-valuetext={THINKING_LABEL[activeThinking] ?? activeThinking}
                onChange={(event) => pickThinkingAt(Number(event.target.value))}
              />
              </div>
              <div className="slider-labels">{intensityLevels.map((level, index) => <button key={level} type="button" className="pressable" aria-pressed={level === activeThinking} onClick={() => pickThinkingAt(index)}>{THINKING_LABEL[level] ?? level}</button>)}</div>
            </div>
          ) : (
            <p className="model-picker-empty">该模型不支持思考强度</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
