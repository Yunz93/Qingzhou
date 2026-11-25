import { useState, type FormEvent, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, RotateCw } from "lucide-react";
import { getDesktop, type WebPreviewAction } from "../../desktop-bridge";
import { normalizeBrowserUrl } from "../../lib/browser-url";

export function InspectorBrowser() {
  const desktop = getDesktop();
  const nativePreview = desktop?.previewNavigation;
  const [draft, setDraft] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [index, setIndex] = useState(-1);
  const [reloadKey, setReloadKey] = useState(0);
  const [previewError, setPreviewError] = useState("");
  const url = index >= 0 ? (history[index] ?? "") : "";
  const canBack = nativePreview ? Boolean(url) : index > 0;
  const canForward = nativePreview ? Boolean(url) : index >= 0 && index < history.length - 1;

  function preview(action: WebPreviewAction, address?: string) {
    if (!nativePreview) return;
    setPreviewError("");
    void nativePreview(action, address).catch((error: unknown) => setPreviewError(String(error)));
  }

  function navigate(raw: string): void {
    const next = normalizeBrowserUrl(raw);
    if (!next) return;
    const trimmed = history.slice(0, index + 1);
    setHistory([...trimmed, next]);
    setIndex(trimmed.length);
    setDraft(next);
    setReloadKey((value) => value + 1);
    preview("open", next);
  }

  function onSubmit(event: FormEvent): void {
    event.preventDefault();
    navigate(draft);
  }

  function onDraftKey(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Escape") {
      setDraft(url);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <form className="flex h-8 shrink-0 items-center gap-0.5 border-b border-line px-1.5" onSubmit={onSubmit}>
        <button
          type="button"
          className="pressable icon-btn"
          aria-label="后退"
          disabled={!canBack}
          onClick={() => {
            if (!canBack) return;
            if (nativePreview) { preview("back"); return; }
            const next = index - 1;
            setIndex(next);
            setDraft(history[next] ?? "");
          }}
        >
          <ChevronLeft size={14} />
        </button>
        <button
          type="button"
          className="pressable icon-btn"
          aria-label="前进"
          disabled={!canForward}
          onClick={() => {
            if (!canForward) return;
            if (nativePreview) { preview("forward"); return; }
            const next = index + 1;
            setIndex(next);
            setDraft(history[next] ?? "");
          }}
        >
          <ChevronRight size={14} />
        </button>
        <button
          type="button"
          className="pressable icon-btn"
          aria-label="刷新"
          disabled={!url}
          onClick={() => nativePreview ? preview("reload") : setReloadKey((value) => value + 1)}
        >
          <RotateCw size={13} />
        </button>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onDraftKey}
          aria-label="网址"
          placeholder="example.com"
          className="field ml-0.5 h-6 min-h-6 min-w-0 flex-1 rounded-md px-2 font-mono text-[11px]"
        />
        {url ? (
          <button
            type="button"
            className="pressable icon-btn"
            aria-label="用系统浏览器打开"
            onClick={() => {
              if (desktop?.openExternal) {
                void desktop.openExternal(url).catch((error: unknown) => setPreviewError(String(error)));
              } else {
                window.open(url, "_blank", "noopener");
              }
            }}
          >
            <ExternalLink size={13} />
          </button>
        ) : null}
      </form>
      {previewError ? <p className="px-3 py-2 text-sm text-danger" role="alert">{previewError}</p> : null}
      {url ? (
        nativePreview ? (
          <div className="space-y-2 px-3 py-4 text-sm">
            <p className="break-all text-mute">{url}</p>
            <button type="button" className="btn btn-secondary" onClick={() => preview("open", url)}>打开预览窗口</button>
          </div>
        ) : (
          <iframe
            key={`${url}:${reloadKey}`}
            title="浏览器预览"
            src={url}
            sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-same-origin"
            className="min-h-0 flex-1 border-0 bg-surface"
          />
        )
      ) : (
        <div className="flex min-h-0 flex-1 items-start p-3">
          <p className="text-sm leading-6 text-mute">
            输入网址打开网页，例如 <span className="font-mono text-[12px] text-ink">example.com</span>
            。{nativePreview ? "网页在独立预览窗口中打开。" : null}
          </p>
        </div>
      )}
    </div>
  );
}
