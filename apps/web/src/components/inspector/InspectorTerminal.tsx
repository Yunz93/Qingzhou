import { useEffect, useRef, useState } from "react";
import { Square, Trash2 } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { useAgentStore } from "../../stores/agent-store";
import { socketClient } from "../../transport/socket-client";
import { useTheme } from "../../hooks/useTheme";
import { readTheme } from "../../lib/theme";
import { termTheme } from "../../lib/term-theme";

type Props = { taskId: string | null; cwd: string | null };

export function InspectorTerminal({ taskId, cwd }: Props) {
  const [theme] = useTheme();
  const session = useAgentStore((state) => (taskId ? state.termByTask[taskId] : undefined));
  const clearTerm = useAgentStore((state) => state.clearTerm);
  const [error, setError] = useState("");
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const writtenRef = useRef(0);
  const text = session?.text ?? "";
  const connected = Boolean(session?.connected);
  const shell = session?.shell ? session.shell.split(/[/\\]/).pop() : null;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !taskId) return;
    setError("");
    let cancelled = false;
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: '"Commit Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.2,
      scrollback: 5000,
      // FitAddon reserves this width when scrollback > 0; keep 0 so cols match the host.
      overviewRuler: { width: 0 },
      theme: termTheme(readTheme()),
      macOptionIsMeta: true,
      allowTransparency: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(host);
    term.textarea?.setAttribute("aria-label", "终端");
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;
    writtenRef.current = 0;
    const buffered = useAgentStore.getState().termByTask[taskId]?.text ?? "";
    if (buffered) {
      term.write(buffered);
      writtenRef.current = buffered.length;
    }
    const dataSub = term.onData((data) => {
      void socketClient.send("term.input", { data }, taskId).catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "输入发送失败。");
      });
    });
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === "c" && term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection());
        return false;
      }
      if ((event.metaKey || event.ctrlKey) && key === "v") {
        void navigator.clipboard.readText().then((value) => {
          if (value) void socketClient.send("term.input", { data: value }, taskId);
        });
        return false;
      }
      if ((event.metaKey || event.ctrlKey) && key === "k") {
        clearTerm(taskId);
        return false;
      }
      return true;
    });
    const resize = () => {
      try {
        fit.fit();
      } catch {
        return;
      }
      void socketClient.send("term.resize", { cols: term.cols, rows: term.rows }, taskId).catch(() => undefined);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    // Start the PTY only after the first fit so the shell opens at the real size
    // (starting at the 80×24 default then resizing can leave blank rows above the prompt).
    void (async () => {
      let lastError: unknown;
      for (let attempt = 0; attempt < 5 && !cancelled; attempt += 1) {
        try {
          fit.fit();
          await socketClient.send("term.start", { cols: term.cols, rows: term.rows }, taskId);
          return;
        } catch (cause) {
          lastError = cause;
          await new Promise((resolve) => window.setTimeout(resolve, 250));
        }
      }
      if (!cancelled) setError(lastError instanceof Error ? lastError.message : "终端启动失败。");
    })();
    term.focus();
    return () => {
      cancelled = true;
      dataSub.dispose();
      observer.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [taskId, clearTerm]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = termTheme(theme);
  }, [theme]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    if (text.length < writtenRef.current) {
      term.reset();
      writtenRef.current = 0;
    }
    if (text.length > writtenRef.current) {
      term.write(text.slice(writtenRef.current));
      writtenRef.current = text.length;
    }
  }, [text]);

  function interrupt(): void {
    if (!taskId) return;
    void socketClient.send("term.interrupt", {}, taskId);
    termRef.current?.focus();
  }

  if (!taskId) return <p className="p-3 text-sm text-mute">先打开一个对话。</p>;

  return (
    <div className="term-shell flex h-full min-h-0 flex-col">
      <div className="term-head h-8">
        <span aria-hidden="true" className={`term-status ${connected ? "term-status-running" : ""}`} />
        <span className="term-path truncate" title={cwd ?? undefined}>
          {cwd || "—"}
        </span>
        <span className="ml-auto text-[10px] text-mute">{shell ?? ""}</span>
        <button type="button" className="term-head-btn pressable" onClick={interrupt} disabled={!connected} aria-label="中断" title="Ctrl-C">
          <Square size={11} />
        </button>
        <button
          type="button"
          className="term-head-btn pressable"
          onClick={() => {
            if (!taskId) return;
            clearTerm(taskId);
            termRef.current?.focus();
          }}
          aria-label="清屏"
        >
          <Trash2 size={11} />
        </button>
      </div>
      {error ? <p className="term-error px-3 py-1.5 text-[12px]">{error}</p> : null}
      <div className="term-xterm-frame">
        <div
          ref={hostRef}
          className="term-xterm"
          onClick={() => {
            termRef.current?.focus();
            if (!connected && taskId) {
              const cols = termRef.current?.cols ?? 80;
              const rows = termRef.current?.rows ?? 24;
              void socketClient.send("term.start", { cols, rows }, taskId).catch(() => undefined);
            }
          }}
        />
      </div>
    </div>
  );
}
