import { useEffect, useMemo, useState } from "react";
import { escapeHtml } from "../lib/assistant-markdown";

type Highlighter = typeof import("highlight.js").default;

export function useHighlightedCode(content: string, language?: string, enabled = true): string {
  const [highlighter, setHighlighter] = useState<Highlighter | null>(null);
  useEffect(() => {
    if (!enabled || highlighter) return;
    let mounted = true;
    void import("highlight.js").then(({ default: library }) => {
      if (mounted) setHighlighter(() => library);
    }).catch(() => { /* Plain code remains readable if the optional chunk is unavailable. */ });
    return () => { mounted = false; };
  }, [enabled, highlighter]);

  return useMemo(() => {
    if (enabled && highlighter) {
      try {
        if (language && highlighter.getLanguage(language)) {
          return highlighter.highlight(content, { language }).value;
        }
        if (content.length <= 8000) return highlighter.highlightAuto(content).value;
      } catch { /* Fall back to the original text. */ }
    }
    return escapeHtml(content);
  }, [content, enabled, highlighter, language]);
}
