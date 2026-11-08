import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Folder } from "lucide-react";
import { isDesktopApp, getDesktop } from "../../desktop-bridge";

export type FolderBrowseResult = {
  cwd: string;
  parent: string | null;
  entries: Array<{ path: string; name: string; kind: "dir" }>;
  roots: string[];
};

type Props = {
  initialPath?: string;
  onSelect: (path: string) => void;
  selectedPath?: string;
};

export function FolderPicker({ initialPath, onSelect, selectedPath }: Props) {
  if (isDesktopApp()) {
    return <NativeFolderPicker initialPath={initialPath} onSelect={onSelect} selectedPath={selectedPath} />;
  }
  return <WebFolderPicker initialPath={initialPath} onSelect={onSelect} selectedPath={selectedPath} />;
}

function NativeFolderPicker({ initialPath, onSelect, selectedPath }: Props) {
  const current = selectedPath || initialPath || "";

  async function choose() {
    const picked = await getDesktop()?.pickFolder(current || undefined);
    if (picked) onSelect(picked);
  }

  return (
    <div className="rounded-[10px] bg-fill p-3">
      <p className="text-[12px] text-mute">文件夹</p>
      <div className="mt-1.5 flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink" title={current || undefined}>
          {current || "还没选择文件夹"}
        </p>
        <button type="button" className="pressable btn btn-secondary shrink-0" onClick={() => void choose()}>
          选择文件夹…
        </button>
      </div>
    </div>
  );
}

function WebFolderPicker({ initialPath, onSelect, selectedPath }: Props) {
  const requestRef = useRef<AbortController | null>(null);
  const [data, setData] = useState<FolderBrowseResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load(path?: string) {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const query = path ? `?path=${encodeURIComponent(path)}` : "";
      const response = await fetch(`/api/folders${query}`, { credentials: "same-origin", signal: controller.signal });
      const json = (await response.json()) as FolderBrowseResult & { error?: string };
      if (controller.signal.aborted) return;
      if (!response.ok) {
        setError(json.error ?? "打不开这个文件夹。");
        return;
      }
      setData(json);
      onSelect(json.cwd);
    } catch {
      if (!controller.signal.aborted) setError("无法浏览文件夹。");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    void load(initialPath);
    return () => requestRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPath]);

  return (
    <div className="overflow-hidden rounded-[10px] bg-fill">
      <div className="flex items-center gap-2 border-b border-line px-2 py-1.5">
        <button
          type="button"
          className="pressable inline-flex h-7 w-7 items-center justify-center rounded-md text-mute disabled:opacity-40"
          disabled={!data?.parent || loading}
          aria-label="上一级"
          onClick={() => data?.parent && void load(data.parent)}
        >
          <ChevronLeft size={18} />
        </button>
        <p className="min-w-0 flex-1 truncate font-mono text-[12px] text-mute" title={data?.cwd}>
          {data?.cwd ?? "…"}
        </p>
      </div>
      <div className="max-h-56 overflow-y-auto p-1">
        {loading ? <p className="px-3 py-2 text-sm text-mute">正在加载文件夹…</p> : null}
        {error ? <p className="px-3 py-2 text-sm text-danger">{error}</p> : null}
        {!loading && data
          ? data.entries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                className={`pressable flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-[13px] ${
                  selectedPath === entry.path ? "bg-accent-soft text-ink" : "text-ink"
                }`}
                onClick={() => void load(entry.path)}
              >
                <Folder size={16} className="shrink-0 text-mute" />
                <span className="truncate">{entry.name}</span>
              </button>
            ))
          : null}
        {!loading && data && data.entries.length === 0 ? (
          <p className="px-3 py-2 text-sm text-mute">这里没有子文件夹，就用当前文件夹。</p>
        ) : null}
      </div>
      <div className="border-t border-line px-3 py-2 text-sm text-mute">
        已选：<span className="font-mono text-[12px] text-ink">{selectedPath || data?.cwd || "—"}</span>
      </div>
    </div>
  );
}
