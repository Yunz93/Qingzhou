import { Component, createContext, isValidElement, memo, useContext, useDeferredValue, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import hljs from "highlight.js";
import {
  escapeHtml,
  isWorkspaceMediaPath,
  markdownUrlTransform,
  shouldOpenMarkdownLink,
  stabilizeMarkdown,
} from "../../lib/assistant-markdown";
import { WorkspaceMediaPreview } from "./WorkspaceMediaPreview";
import { copyText } from "../../lib/clipboard";

const MarkdownContext = createContext<{ taskId: string | null; streaming: boolean }>({ taskId: null, streaming: false });

class MarkdownErrorBoundary extends Component<{ text: string; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return <div className="markdown whitespace-pre-wrap">{this.props.text}</div>;
    }
    return this.props.children;
  }
}

function highlightCode(content: string, language?: string): string {
  try {
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(content, { language }).value;
    }
    if (content.length > 8_000) return escapeHtml(content);
    return hljs.highlightAuto(content).value;
  } catch {
    return escapeHtml(content);
  }
}

function onMarkdownLinkClick(event: MouseEvent<HTMLAnchorElement>, href: string | undefined): void {
  event.preventDefault();
  if (!shouldOpenMarkdownLink(href) || !href) return;
  window.open(href, "_blank", "noopener,noreferrer");
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const { streaming } = useContext(MarkdownContext);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  let language = "";
  let code = "";
  if (isValidElement(children)) {
    const props = children.props as { className?: string; children?: unknown };
    language = /language-([\w-]+)/.exec(props.className ?? "")?.[1] ?? "";
    code = String(props.children ?? "").replace(/\n$/, "");
  }
  const html = useMemo(() => streaming ? escapeHtml(code) : highlightCode(code, language), [code, language, streaming]);
  return <div className="markdown-code-block">
    <div className="markdown-code-head"><span className="markdown-pre-lang">{language || "代码"}</span>
      <button type="button" className="pressable" aria-label="复制代码" onClick={() => {
        void copyText(code).then((copied) => setCopyState(copied ? "copied" : "failed"));
      }}>{copyState === "copied" ? "已复制" : copyState === "failed" ? "复制失败" : "复制代码"}</button>
    </div>
    <pre className="markdown-pre"><code dangerouslySetInnerHTML={{ __html: html }} /></pre>
  </div>;
}

// Stable component identities preserve mounted media and code blocks across deltas.
const markdownComponents: Components = {
  pre: CodeBlock,
  code({ children }) { return <code className="markdown-inline">{children}</code>; },
  a({ href, children }) {
    if (!shouldOpenMarkdownLink(href)) return <span>{children}</span>;
    return <a href={href} target="_blank" rel="noreferrer noopener" onClick={(event) => onMarkdownLinkClick(event, href)}>{children}</a>;
  },
  img: function MarkdownImage({ src, alt }) {
    const { taskId } = useContext(MarkdownContext);
    if (shouldOpenMarkdownLink(src)) return <img src={src} alt={alt ?? ""} className="my-2 max-h-[360px] max-w-full rounded-md" />;
    if (isWorkspaceMediaPath(src)) return <WorkspaceMediaPreview src={src!} alt={alt} taskId={taskId} />;
    return alt ? <span className="text-mute">{alt}</span> : null;
  },
  input({ checked }) { return <input type="checkbox" checked={checked ?? false} disabled readOnly />; },
};

function AssistantMarkdownView({ text, taskId, streaming }: { text: string; taskId: string | null; streaming: boolean }) {
  const context = useMemo(() => ({ taskId, streaming }), [taskId, streaming]);
  return (
    <MarkdownContext.Provider value={context}>
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        urlTransform={markdownUrlTransform}
        components={markdownComponents}
      >
        {stabilizeMarkdown(text)}
      </ReactMarkdown>
    </div>
    </MarkdownContext.Provider>
  );
}

export const AssistantMarkdown = memo(function AssistantMarkdown({
  text,
  streaming,
  taskId = null,
}: {
  text: string;
  streaming?: boolean;
  taskId?: string | null;
}) {
  const deferredText = useDeferredValue(text);
  if (!text) return null;
  return (
    <MarkdownErrorBoundary text={text}>
      <AssistantMarkdownView text={streaming ? deferredText : text} taskId={taskId} streaming={Boolean(streaming)} />
    </MarkdownErrorBoundary>
  );
});
