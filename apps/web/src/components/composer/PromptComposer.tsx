import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import type { ApprovalPolicy, InteractionMode, TaskStatus, ThinkingLevel } from "@qingzhou/protocol";
import { extractAtMentions } from "@qingzhou/protocol";
import { ArrowUp, Check, Clock3, CornerUpRight, Pencil, Plus, Square, X } from "lucide-react";
import { composerCanSubmit, filesFromClipboard, nextComposerDomValue, shouldSubmitOnEnter } from "../../lib/composer-input";
import { composerPlaceholder } from "../../copy";
import { busySubmitKind, readBusySendMode, writeBusySendMode, type BusySendMode } from "../../lib/ui-prefs";
import { ComposerCapsules } from "./ComposerCapsules";
import { MentionMenu, type MentionItem } from "./MentionMenu";

type FileEntry = { path: string; name: string; kind: "file" | "dir" };
type CommandItem = { name: string; description?: string; source?: string };
export type ComposerImage = { id: string; previewUrl: string; name: string };

type Props = {
  status: TaskStatus;
  disabled: boolean;
  models: Array<{
    provider: string;
    id: string;
    name?: string;
    reasoning?: boolean;
    thinkingLevels?: ThinkingLevel[];
  }>;
  thinkingLevels: ThinkingLevel[];
  modelId: string | null;
  defaultModelId?: string | null;
  thinkingLevel: ThinkingLevel;
  mode: InteractionMode;
  approvalPolicy: ApprovalPolicy;
  files: FileEntry[];
  commands: CommandItem[];
  hasTurns: boolean;
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onSteer: () => void;
  onFollowUp: () => void;
  onAbort: () => void;
  onModel: (provider: string, modelId: string) => void;
  onDefaultModel?: (provider: string, modelId: string) => void;
  onThinking: (level: ThinkingLevel) => void;
  onPolicy: (mode: InteractionMode, approvalPolicy: ApprovalPolicy) => void;
  onImages: (files: FileList | File[]) => void;
  onRemoveImage: (id: string) => void;
  onNeedFiles: () => void;
  images: ComposerImage[];
  fastModeEnabled?: boolean;
  fastModeActive?: boolean;
  onFastMode?: (enabled: boolean) => void;
  queuedSteering?: string[];
  queuedFollowUp?: string[];
  onEditQueued?: (
    kind: "steering" | "followUp",
    index: number,
    previousMessage: string,
    message: string,
  ) => Promise<void>;
};

function mentionQuery(value: string, caret: number): { start: number; query: string } | null {
  const before = value.slice(0, caret);
  const match = before.match(/@([^\s@]*)$/);
  if (!match || match.index === undefined) return null;
  return { start: match.index, query: match[1] ?? "" };
}

function slashQuery(value: string, caret: number): { start: number; query: string } | null {
  const before = value.slice(0, caret);
  const match = before.match(/(^|\s)\/([^\s]*)$/);
  if (!match || match.index === undefined) return null;
  return { start: match.index + (match[1] ?? "").length, query: match[2] ?? "" };
}

export function PromptComposer({
  status,
  disabled,
  models,
  thinkingLevels,
  modelId,
  defaultModelId = null,
  thinkingLevel,
  mode,
  approvalPolicy,
  files,
  commands,
  hasTurns,
  value,
  onChange,
  onSend,
  onSteer,
  onFollowUp,
  onAbort,
  onModel,
  onDefaultModel,
  onThinking,
  onPolicy,
  onImages,
  onRemoveImage,
  onNeedFiles,
  images,
  fastModeEnabled,
  fastModeActive,
  onFastMode,
  queuedSteering = [],
  queuedFollowUp = [],
  onEditQueued,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const valueRef = useRef(value);
  valueRef.current = value;
  const [caret, setCaret] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const [busySendMode, setBusySendMode] = useState<BusySendMode>(() => readBusySendMode());
  const [queueEdit, setQueueEdit] = useState<{
    kind: "steering" | "followUp";
    index: number;
    previousMessage: string;
    message: string;
    saving: boolean;
  } | null>(null);
  const starting = status === "booting" || status === "queued";
  const running = status === "running" || status === "waiting_approval" || status === "aborting";
  const followUp = status === "idle" && hasTurns;
  const canSubmit = !starting && composerCanSubmit(value, images.length);
  const showStop = running && !canSubmit;
  const mention = mentionQuery(value, caret);
  const slash = !mention ? slashQuery(value, caret) : null;

  useEffect(() => {
    setMenuDismissed(false);
  }, [mention?.start, mention?.query, slash?.start, slash?.query]);
  const attachedCount = extractAtMentions(value).length;

  const syncHeight = (node: HTMLTextAreaElement) => {
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 180)}px`;
  };

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const next = nextComposerDomValue(node.value, value, composingRef.current);
    if (next !== null) node.value = next;
    if (!composingRef.current) syncHeight(node);
  }, [value]);

  useEffect(() => {
    if (mention) onNeedFiles();
  }, [mention, onNeedFiles]);

  useEffect(() => {
    if (!queueEdit || queueEdit.saving) return;
    const items = queueEdit.kind === "steering" ? queuedSteering : queuedFollowUp;
    if (items[queueEdit.index] !== queueEdit.previousMessage) setQueueEdit(null);
  }, [queueEdit, queuedFollowUp, queuedSteering]);

  const fileHits = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    return files
      .filter((entry) => entry.kind === "file" && (!q || entry.path.toLowerCase().includes(q)))
      .slice(0, 8)
      .map((entry) => ({ id: entry.path, primary: entry.path }));
  }, [files, mention]);

  const commandHits = useMemo(() => {
    if (!slash) return [];
    const q = slash.query.toLowerCase();
    return commands
      .filter((item) => item.name.toLowerCase().includes(q) || item.description?.toLowerCase().includes(q))
      .slice(0, 8)
      .map((item) => ({ id: item.name, primary: `/${item.name}`, secondary: item.description }));
  }, [commands, slash]);

  const submit = (shiftKey = false) => {
    if (starting || !canSubmit) return;
    if (running) {
      const kind = busySubmitKind(busySendMode, shiftKey);
      if (kind === "followUp") onFollowUp();
      else onSteer();
      return;
    }
    if (followUp) onFollowUp();
    else onSend();
  };

  const setSendMode = (mode: BusySendMode) => {
    setBusySendMode(mode);
    writeBusySendMode(mode);
  };

  const insert = (start: number, from: string, text: string) => {
    const next = `${value.slice(0, start)}${text}${value.slice(start + from.length)}`;
    onChange(next);
    requestAnimationFrame(() => {
      const node = ref.current;
      if (!node) return;
      const pos = start + text.length;
      node.focus();
      node.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };

  const pickMention = (item: MentionItem) => {
    if (mention) insert(mention.start, `@${mention.query}`, `@${item.primary} `);
    else if (slash) insert(slash.start, `/${slash.query}`, `${item.primary} `);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen) return;
    if (event.key === "Enter" && event.shiftKey && running && !composingRef.current) {
      event.preventDefault();
      submit(true);
      return;
    }
    if (!shouldSubmitOnEnter(event, composingRef.current)) return;
    event.preventDefault();
    submit();
  };

  const onPaste = (event: ClipboardEvent<HTMLElement>) => {
    const pasted = filesFromClipboard(event.clipboardData);
    if (pasted.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    onImages(pasted);
  };

  const saveQueueEdit = async () => {
    if (!queueEdit || !onEditQueued || !queueEdit.message.trim()) return;
    const current = queueEdit;
    setQueueEdit({ ...current, saving: true });
    try {
      await onEditQueued(current.kind, current.index, current.previousMessage, current.message.trim());
      setQueueEdit(null);
    } catch {
      setQueueEdit((value) => (value ? { ...value, saving: false } : value));
    }
  };

  const queueRow = (kind: "steering" | "followUp", text: string, index: number) => {
    const editing = queueEdit?.kind === kind && queueEdit.index === index && queueEdit.previousMessage === text;
    const label = kind === "steering" ? "补充中" : "回复后发送";
    return (
      <div
        key={`${kind}-${index}`}
        className="flex min-h-6 shrink-0 items-center gap-1.5 rounded-md bg-fill px-2 py-0.5 text-[11.5px] leading-5"
      >
        {kind === "steering" ? (
          <CornerUpRight size={11} className="shrink-0 text-accent" />
        ) : (
          <Clock3 size={11} className="shrink-0 text-accent" />
        )}
        {editing ? (
          <input
            autoFocus
            value={queueEdit.message}
            disabled={queueEdit.saving}
            aria-label="修改队列消息"
            className="min-w-0 flex-1 bg-transparent text-ink outline-none"
            onChange={(event) => setQueueEdit({ ...queueEdit, message: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setQueueEdit(null);
              }
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void saveQueueEdit();
              }
            }}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-ink" title={text}>
            {text}
          </span>
        )}
        <span className={`shrink-0 ${kind === "steering" ? "text-accent" : "text-mute"}`}>{label}</span>
        {onEditQueued ? (
          editing ? (
            <>
              <button
                type="button"
                className="pressable inline-flex h-5 w-5 items-center justify-center text-accent"
                aria-label="保存队列消息"
                disabled={queueEdit.saving || !queueEdit.message.trim()}
                onClick={() => void saveQueueEdit()}
              >
                <Check size={12} />
              </button>
              <button
                type="button"
                className="pressable inline-flex h-5 w-5 items-center justify-center text-mute"
                aria-label="取消修改队列消息"
                disabled={queueEdit.saving}
                onClick={() => setQueueEdit(null)}
              >
                <X size={12} />
              </button>
            </>
          ) : (
            <button
              type="button"
              className="pressable inline-flex h-5 w-5 items-center justify-center text-mute"
              aria-label={`编辑队列消息 ${index + 1}`}
              onClick={() => setQueueEdit({ kind, index, previousMessage: text, message: text, saving: false })}
            >
              <Pencil size={11} />
            </button>
          )
        ) : null}
      </div>
    );
  };

  return (
    <div className="px-4 pb-[max(10px,env(safe-area-inset-bottom))] pt-1">
      <div
        className="composer-well relative mx-auto max-w-[720px]"
        onPaste={onPaste}
        onMouseDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (disabled) return;
          event.preventDefault();
          ref.current?.focus();
        }}
      >
        {images.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5 px-3.5 pt-3" aria-label={`已添加 ${images.length} 张图`}>
            {images.map((image) => (
              <li key={image.id} className="relative">
                <img
                  src={image.previewUrl}
                  alt={image.name}
                  className="h-14 w-14 rounded-lg bg-fill object-cover"
                />
                <button
                  type="button"
                  className="pressable absolute -right-1 -top-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-elevated text-mute shadow-dialog"
                  aria-label={`移除 ${image.name}`}
                  onClick={() => onRemoveImage(image.id)}
                >
                  <X size={10} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {queuedSteering.length > 0 || queuedFollowUp.length > 0 ? (
          <div
            role="status"
            aria-label="排队中的指令"
            className={`flex max-h-28 flex-col gap-1 overflow-auto px-3.5 ${images.length > 0 ? "pt-2" : "pt-3"}`}
          >
            {queuedSteering.map((text, index) => queueRow("steering", text, index))}
            {queuedFollowUp.map((text, index) => queueRow("followUp", text, index))}
          </div>
        ) : null}
        <textarea
          ref={ref}
          defaultValue={value}
          onChange={(event) => {
            const next = event.target.value;
            if (!composingRef.current) syncHeight(event.currentTarget);
            onChange(next);
            setCaret(event.target.selectionStart);
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(event) => {
            const next = event.currentTarget.value;
            onChange(next);
            window.setTimeout(() => {
              composingRef.current = false;
              const node = ref.current;
              if (!node) return;
              const synced = nextComposerDomValue(node.value, valueRef.current, composingRef.current);
              if (synced !== null) node.value = synced;
              syncHeight(node);
            }, 0);
          }}
          placeholder={starting ? "正在启动…" : composerPlaceholder(running, busySendMode)}
          aria-label="输入消息"
          disabled={disabled}
          className="max-h-[168px] min-h-[40px] w-full resize-none bg-transparent px-3.5 pb-1 pt-2.5 text-[13.5px] leading-[1.55] text-ink outline-none placeholder:text-mute"
        />
        {fileHits.length > 0 && !menuDismissed ? (
          <MentionMenu
            items={fileHits}
            label="文件"
            onPick={pickMention}
            onNavigate={setMenuOpen}
            onDismiss={() => setMenuDismissed(true)}
          />
        ) : null}
        {commandHits.length > 0 && !menuDismissed ? (
          <MentionMenu
            items={commandHits}
            label="命令"
            onPick={pickMention}
            onNavigate={setMenuOpen}
            onDismiss={() => setMenuDismissed(true)}
          />
        ) : null}
        <div className="composer-toolbar">
          <div className="composer-toolbar-start">
            <label className="pressable composer-tool-btn cursor-pointer" aria-label="添加图片">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                multiple
                onChange={(event) => {
                  if (event.target.files) onImages(event.target.files);
                  event.target.value = "";
                }}
              />
              <Plus size={15} strokeWidth={1.75} />
            </label>
            <ComposerCapsules
              slot="mode"
              mode={mode}
              approvalPolicy={approvalPolicy}
              models={models}
              modelId={modelId}
              defaultModelId={defaultModelId}
              thinkingLevel={thinkingLevel}
              thinkingLevels={thinkingLevels}
              fastModeEnabled={fastModeEnabled}
              fastModeActive={fastModeActive}
              onPolicy={onPolicy}
              onModel={onModel}
              onDefaultModel={onDefaultModel}
              onThinking={onThinking}
              onFastMode={onFastMode}
            />
            {attachedCount > 0 ? (
              <span className="hidden text-[11px] text-mute sm:inline">{attachedCount} 个文件</span>
            ) : null}
          </div>
          <div className="composer-toolbar-end">
            <div className="flex rounded-md bg-fill p-0.5" role="group" aria-label="回复时发送方式">
              <button
                type="button"
                className={`pressable h-6 rounded-[5px] px-1.5 text-[11px] ${busySendMode === "steer" ? "bg-surface text-ink" : "text-mute"}`}
                aria-pressed={busySendMode === "steer"}
                title="回复过程中立即补充"
                onClick={() => setSendMode("steer")}
              >
                追加
              </button>
              <button
                type="button"
                className={`pressable h-6 rounded-[5px] px-1.5 text-[11px] ${busySendMode === "followUp" ? "bg-surface text-ink" : "text-mute"}`}
                aria-pressed={busySendMode === "followUp"}
                title="等这次回复结束后再发"
                onClick={() => setSendMode("followUp")}
              >
                排队
              </button>
            </div>
            <ComposerCapsules
              slot="model"
              mode={mode}
              approvalPolicy={approvalPolicy}
              models={models}
              modelId={modelId}
              defaultModelId={defaultModelId}
              thinkingLevel={thinkingLevel}
              thinkingLevels={thinkingLevels}
              fastModeEnabled={fastModeEnabled}
              fastModeActive={fastModeActive}
              onPolicy={onPolicy}
              onModel={onModel}
              onDefaultModel={onDefaultModel}
              onThinking={onThinking}
              onFastMode={onFastMode}
            />
            <button
              type="button"
              className={`pressable send-btn${showStop ? " send-btn-stop" : ""}`}
              onClick={showStop ? onAbort : () => submit()}
              disabled={disabled || (!showStop && !canSubmit)}
              aria-label={showStop ? "停止" : "发送"}
              title={showStop ? "停止" : running ? (busySendMode === "followUp" ? "排队下一条" : "补充这条回复") : "发送"}
            >
              {showStop ? <Square size={10} fill="currentColor" /> : <ArrowUp size={15} strokeWidth={2.2} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
