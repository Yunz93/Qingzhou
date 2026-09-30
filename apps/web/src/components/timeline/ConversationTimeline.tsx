import { groupThinkingMessages } from "../../lib/thinking-groups";
import { hasDialogLayer } from "../../hooks/useDialogLayer";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, memo, type ReactNode } from "react";
import { Box, Info } from "lucide-react";
import { stripModePrefix, type TimelineMessage, type ToolExecution } from "@qingzhou/protocol";
import { ToolExecutionRow } from "./ToolExecutionRow";
import { ToolGroupRow } from "./ToolGroupRow";
import { AssistantMarkdown } from "./AssistantMarkdown";
import { groupToolExecutions } from "../../lib/tool-groups";
import { ConversationSearchBar } from "./ConversationSearchBar";
import { findScrollParent, isNearBottom } from "../../lib/stick-to-bottom";
import { STARTER_PROMPTS } from "../../copy";
import {
  conversationMessageDomId,
  matchConversationMessages,
  OPEN_CONVERSATION_SEARCH_EVENT,
  stepSearchIndex,
} from "../../lib/conversation-search";
import { useAgentStore } from "../../stores/agent-store";

type Props = {
  messages: TimelineMessage[];
  tools: ToolExecution[];
  canRewrite?: boolean;
  error?: string | null;
  onRetry?: (messageId: string, text: string) => void;
  onClone?: () => void;
  onOpenFile?: (path: string) => void;
  onUndoFile?: (path: string) => void;
  onStarter?: (prompt: string) => void;
};

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.setAttribute("readonly", "");
      el.style.position = "fixed";
      el.style.left = "-9999px";
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(el);
      return ok;
    } catch {
      return false;
    }
  }
}

function ThinkingBlock({ message, highlighted = false }: { message: TimelineMessage; highlighted?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!message.thinking) return null;
  const duration =
    typeof message.thinkingDurationMs === "number"
      ? `${Math.max(1, Math.round(message.thinkingDurationMs / 100) / 10)}s`
      : null;
  return (
    <div className="thinking-block mb-2">
      <button
        type="button"
        className="pressable min-h-7 text-left text-[12px] text-mute"
        onClick={() => setOpen((value) => !value)}
      >
        思考了 {duration ?? "片刻"} {open ? "▾" : "▸"}
      </button>
      {open || highlighted ? (
        <pre className="thinking-body fade-in mt-1 whitespace-pre-wrap text-xs leading-6">{message.thinking}</pre>
      ) : null}
    </div>
  );
}

function ThinkingGroup({ messages, activeMessageId }: { messages: TimelineMessage[]; activeMessageId: string | null }) {
  const [open, setOpen] = useState(false);
  const expanded = open || messages.some((message) => message.id === activeMessageId);
  return <div className="thinking-group"><button type="button" className="pressable text-[12px] text-mute" aria-expanded={expanded} onClick={() => setOpen(!expanded)}>{messages.length} 段思考记录 {expanded ? "▾" : "▸"}</button>
    {expanded ? <div className="thinking-group-body">{messages.map((message) => <article key={message.id} id={conversationMessageDomId(message.id)} className={message.id === activeMessageId ? "conversation-search-hit" : ""}><pre className="thinking-body whitespace-pre-wrap text-xs leading-6">{message.thinking}</pre></article>)}</div> : null}
  </div>;
}

function MessageImages({ images }: { images: NonNullable<TimelineMessage["images"]> }) {
  return (
    <ul className="mb-2 flex flex-wrap gap-1.5" aria-label={`附 ${images.length} 张图`}>
      {images.map((image, index) => (
        <li key={`${image.name ?? image.mimeType}-${index}`}>
          {image.dataUrl ? (
            <img
              src={image.dataUrl}
              alt={image.name ?? `图片 ${index + 1}`}
              className="h-16 w-16 rounded-md bg-fill object-cover"
            />
          ) : (
            <span className="inline-flex h-16 min-w-16 items-center justify-center rounded-md bg-fill px-2 text-[11px] text-mute">
              {image.name ?? `图片 ${index + 1}`}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function UserMessage({
  message,
  canRewrite,
  highlighted,
  onRetry,
}: {
  message: TimelineMessage;
  canRewrite?: boolean;
  highlighted?: boolean;
  onRetry?: (messageId: string, text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(stripModePrefix(message.text));
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const visible = stripModePrefix(message.text);
  return (
    <article
      id={conversationMessageDomId(message.id)}
      className={`flex w-fit max-w-[78%] shrink-0 flex-col self-end rounded-[16px] bg-bubble px-3.5 py-2 text-[13.5px] leading-[1.6] tracking-[-0.01em] text-ink ${
        message.isError ? "opacity-70 ring-1 ring-danger/40" : ""
      } ${highlighted ? "conversation-search-hit" : ""}`}
    >
      {editing ? (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="min-h-20 w-full resize-y bg-transparent text-[13.5px] leading-6 text-ink"
            aria-label="编辑消息"
          />
          <div className="flex justify-end gap-2">
            <button type="button" className="pressable h-7 px-2 text-[12px] text-mute" onClick={() => setEditing(false)}>
              取消
            </button>
            <button
              type="button"
              className="pressable h-7 px-2 text-[12px] text-accent"
              onClick={() => {
                onRetry?.(message.id, draft);
                setEditing(false);
              }}
            >
              从这里重来
            </button>
          </div>
        </div>
      ) : (
        <>
          {message.images?.length ? <MessageImages images={message.images} /> : null}
          {visible ? <p className="whitespace-pre-wrap">{visible}</p> : null}
          {!visible && message.images?.length ? (
            <p className="text-[12px] text-mute">附 {message.images.length} 张图</p>
          ) : null}
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {message.isError ? <span className="text-[11px] text-danger">发送失败</span> : null}
            {visible ? (
              <button
                type="button"
                className="pressable h-6 min-h-6 text-[11px] text-mute"
                aria-label="复制消息"
                onClick={() => {
                  void copyText(visible).then((ok) => {
                    setCopyState(ok ? "copied" : "failed");
                    window.setTimeout(() => setCopyState("idle"), 1600);
                  });
                }}
              >
                {copyState === "copied" ? "已复制" : copyState === "failed" ? "复制失败" : "复制"}
              </button>
            ) : null}
            {canRewrite && onRetry ? (
              <button
                type="button"
                className="pressable h-6 min-h-6 text-[11px] text-mute"
                onClick={() => {
                  setDraft(stripModePrefix(message.text));
                  setEditing(true);
                }}
              >
                编辑并重试
              </button>
            ) : null}
          </div>
        </>
      )}
    </article>
  );
}

function SystemNotice({
  message,
  highlighted,
}: {
  message: TimelineMessage;
  highlighted?: boolean;
}) {
  if (!message.text.trim()) return null;
  return (
    <article
      id={conversationMessageDomId(message.id)}
      role="status"
      className={`model-change-banner ${highlighted ? "conversation-search-hit" : ""}`}
    >
      <Box size={14} strokeWidth={1.75} aria-hidden className="model-change-icon" />
      <p>{message.text}</p>
      <span className="model-change-info" title="这条提示只显示在对话里，不会发给模型。">
        <Info size={13} strokeWidth={2} aria-label="说明" />
      </span>
    </article>
  );
}

const AssistantMessage = memo(function AssistantMessage({
  message,
  highlighted,
  taskId,
}: {
  message: TimelineMessage;
  highlighted?: boolean;
  taskId: string | null;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <article
      id={conversationMessageDomId(message.id)}
      className={`mr-auto w-full max-w-[90%] shrink-0 self-start ${highlighted ? "conversation-search-hit" : ""}`}
    >
      <ThinkingBlock message={message} highlighted={highlighted} />
      <AssistantMarkdown text={message.text} streaming={message.streaming} taskId={taskId} />
      {message.streaming ? <span className="sr-only" aria-live="polite">正在回复</span> : null}
      {message.text ? (
        <button
          type="button"
          className="pressable mt-1.5 h-6 min-h-6 text-[11px] text-mute"
          aria-label="复制回复"
          onClick={() => {
            void copyText(message.text).then((ok) => {
              setCopyState(ok ? "copied" : "failed");
              window.setTimeout(() => setCopyState("idle"), 1600);
            });
          }}
        >
          {copyState === "copied" ? "已复制" : copyState === "failed" ? "复制失败" : "复制"}
        </button>
      ) : null}
    </article>
  );
});

export function ConversationTimeline({
  messages,
  tools,
  canRewrite,
  error,
  onRetry,
  onClone,
  onOpenFile,
  onUndoFile,
  onStarter,
}: Props) {
  const taskId = useAgentStore((state) => state.activeTaskId);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const pinnedRef = useRef(true);
  const userCountRef = useRef(0);
  const scrollRafRef = useRef<number | null>(null);
  const [following, setFollowing] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const hits = useMemo(
    () => (searchOpen ? matchConversationMessages(messages, searchQuery) : []),
    [messages, searchOpen, searchQuery],
  );
  const safeIndex = hits.length === 0 ? 0 : Math.min(activeIndex, hits.length - 1);
  const activeMessageId = hits[safeIndex];

  useLayoutEffect(() => {
    const scroller = document.getElementById("main-content") ?? findScrollParent(rootRef.current);
    if (!scroller) return;

    const syncPin = () => {
      const pinned = isNearBottom(scroller);
      pinnedRef.current = pinned;
      setFollowing(pinned);
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        pinnedRef.current = false;
        setFollowing(false);
      } else syncPin();
    };
    scroller.addEventListener("scroll", syncPin, { passive: true });
    scroller.addEventListener("wheel", onWheel, { passive: true, capture: true });
    return () => {
      scroller.removeEventListener("scroll", syncPin);
      scroller.removeEventListener("wheel", onWheel, true);
    };
  }, []);

  useLayoutEffect(() => {
    if (searchOpen) {
      pinnedRef.current = false;
      setFollowing(false);
      return;
    }
    const scroller = document.getElementById("main-content") ?? findScrollParent(rootRef.current);
    if (!scroller) return;
    const userCount = messages.reduce((count, message) => count + (message.role === "user" ? 1 : 0), 0);
    if (userCount > userCountRef.current) {
      pinnedRef.current = true;
      setFollowing(true);
    } else if (!isNearBottom(scroller)) {
      pinnedRef.current = false;
      setFollowing(false);
    }
    userCountRef.current = userCount;
    if (!pinnedRef.current) return;
    if (scrollRafRef.current != null) return;
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = null;
      if (!pinnedRef.current) return;
      const node = document.getElementById("main-content") ?? findScrollParent(rootRef.current);
      if (node) node.scrollTop = node.scrollHeight;
    });
  }, [messages, tools, searchOpen]);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current != null) {
        window.cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!searchOpen || !activeMessageId) return;
    pinnedRef.current = false;
    document.getElementById(conversationMessageDomId(activeMessageId))?.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
  }, [activeMessageId, searchOpen, searchQuery]);

  useEffect(() => {
    const focusSearch = () => {
      setSearchOpen(true);
      window.requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || hasDialogLayer()) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        event.stopPropagation();
        focusSearch();
      }
      if (event.key === "Escape" && searchOpen) {
        event.preventDefault();
        event.stopPropagation();
        setSearchOpen(false);
        setSearchQuery("");
      }
    };
    const onOpen = () => focusSearch();
    window.addEventListener("keydown", onKey, true);
    window.addEventListener(OPEN_CONVERSATION_SEARCH_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener(OPEN_CONVERSATION_SEARCH_EVENT, onOpen);
    };
  }, [searchOpen]);

  const toolById = new Map(tools.map((tool) => [tool.toolCallId, tool]));
  const renderedTools = new Set<string>();

  function renderToolEntries(entries: ReturnType<typeof groupToolExecutions>) {
    return entries.map((entry) => {
      if (entry.kind === "group") {
        for (const tool of entry.tools) renderedTools.add(tool.toolCallId);
        return <ToolGroupRow key={entry.tools[0]?.toolCallId} tools={entry.tools} taskId={taskId} onOpen={onOpenFile} />;
      }
      renderedTools.add(entry.tool.toolCallId);
      return (
        <ToolExecutionRow
          key={entry.tool.toolCallId}
          tool={entry.tool}
          taskId={taskId}
          onOpen={onOpenFile}
          onUndo={onUndoFile}
        />
      );
    });
  }

  function renderTimelineRows() {
    const rows: ReactNode[] = [];
    let pendingTools: typeof tools = [];
    const flushTools = () => {
      if (pendingTools.length === 0) return;
      rows.push(...renderToolEntries(groupToolExecutions(pendingTools)));
      pendingTools = [];
    };

    for (const row of groupThinkingMessages(messages)) {
      if (Array.isArray(row)) {
        flushTools();
        rows.push(<ThinkingGroup key={row[0]!.id} messages={row} activeMessageId={searchOpen ? activeMessageId ?? null : null} />);
        continue;
      }
      const message = row;
      const highlighted = searchOpen && Boolean(searchQuery.trim()) && message.id === activeMessageId;
      if (message.role === "user") {
        flushTools();
        rows.push(
          <UserMessage
            key={message.id}
            message={message}
            canRewrite={canRewrite}
            highlighted={highlighted}
            onRetry={onRetry}
          />,
        );
        continue;
      }
      if (message.role === "toolResult") {
        const tool = message.toolCallId ? toolById.get(message.toolCallId) : undefined;
        if (tool && !renderedTools.has(tool.toolCallId)) pendingTools.push(tool);
        continue;
      }
      if (message.role === "system") {
        flushTools();
        rows.push(<SystemNotice key={message.id} message={message} highlighted={highlighted} />);
        continue;
      }
      if (message.role === "assistant" && !message.text && !message.thinking && !message.streaming) continue;
      flushTools();
      rows.push(<AssistantMessage key={message.id} message={message} highlighted={highlighted} taskId={taskId} />);
    }
    flushTools();
    const leftovers = tools.filter((tool) => !renderedTools.has(tool.toolCallId));
    rows.push(...renderToolEntries(groupToolExecutions(leftovers)));
    return rows;
  }

  function jumpToLatest() {
    const scroller = document.getElementById("main-content") ?? findScrollParent(rootRef.current);
    pinnedRef.current = true;
    setFollowing(true);
    setSearchOpen(false);
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }

  return (
    <div
      ref={rootRef}
      className="mx-auto flex w-full max-w-[720px] flex-col gap-5 px-4 py-5 sm:px-6"
      role="log"
      aria-live="off"
      aria-relevant="additions"
    >
      {searchOpen ? (
        <ConversationSearchBar
          query={searchQuery}
          current={hits.length === 0 ? 0 : safeIndex + 1}
          total={hits.length}
          inputRef={searchInputRef}
          onQueryChange={(value) => {
            setSearchQuery(value);
            setActiveIndex(0);
          }}
          onPrev={() => setActiveIndex((index) => stepSearchIndex(index, hits.length, -1))}
          onNext={() => setActiveIndex((index) => stepSearchIndex(index, hits.length, 1))}
          onClose={() => {
            setSearchOpen(false);
            setSearchQuery("");
          }}
        />
      ) : null}
      {messages.length === 0 ? (
        <div className="flex flex-col items-center gap-3 pt-16 text-center">
          {onStarter ? (
            <div className="flex w-full max-w-[320px] flex-col gap-2">
              {STARTER_PROMPTS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="pressable starter-prompt"
                  onClick={() => onStarter(item.prompt)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-[13px] leading-6 text-mute">在下面输入。</p>
          )}
        </div>
      ) : null}
      {messages.length > 0 && onClone ? (
        <div className="flex justify-end">
          <button type="button" className="pressable h-6 min-h-6 text-[11px] text-mute" onClick={onClone}>
            克隆会话
          </button>
        </div>
      ) : null}
      {renderTimelineRows()}
      {!following && messages.length > 0 ? (
        <button type="button" className="jump-latest pressable" onClick={jumpToLatest}>
          回到最新
        </button>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="whitespace-pre-wrap rounded-[14px] border border-[color-mix(in_oklch,var(--color-danger)_28%,transparent)] bg-[color-mix(in_oklch,var(--color-danger)_12%,var(--color-surface))] px-4 py-3 text-[13px] leading-6 text-danger"
        >
          <p className="font-medium">对话异常停止</p>
          <p className="mt-1 opacity-95">{error.replace(/^对话异常停止：?/, "") || "这次运行没有完成，请重试。"}</p>
        </div>
      ) : null}
    </div>
  );
}
