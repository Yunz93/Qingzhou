import { useEditorDraft } from "../../hooks/useEditorDraft";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PiResources } from "@qingzhou/protocol";

type AgentFile = PiResources["agentsFiles"][number];
type Preview = { path: string; content: string; truncated: boolean };

type Props = {
  files: AgentFile[];
  cwd?: string | null;
  loading?: boolean;
  onRead: (path: string) => Promise<Preview>;
  onWrite: (path: string, content: string) => Promise<void>;
  onCreate?: () => void;
};

function fileLabel(file: AgentFile): string {
  const name = file.path.replaceAll("\\", "/").split("/").pop() || file.path;
  return name;
}

export function InspectorRules({ files, cwd, loading = false, onRead, onWrite, onCreate }: Props) {
  const ordered = useMemo(() => {
    const root = cwd ? cwd.replace(/\/$/, "") : "";
    return [...files].sort((a, b) => {
      const aLocal = root && a.path.startsWith(root) ? 0 : 1;
      const bLocal = root && b.path.startsWith(root) ? 0 : 1;
      if (aLocal !== bLocal) return aLocal - bLocal;
      return a.path.localeCompare(b.path);
    });
  }, [cwd, files]);
  const [selected, setSelected] = useState<string | null>(ordered[0]?.path ?? null);
  const [saved, setSaved] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = ordered.find((file) => file.path === selected) ?? ordered[0] ?? null;
  const currentPathRef = useRef(current?.path);
  currentPathRef.current = current?.path;
  const editor = useEditorDraft(`qingzhou:rules:${current?.path ?? "none"}`, { content: saved });
  const draft = editor.draft.content;
  const dirty = Boolean(current) && draft !== saved && !truncated;
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;

  useEffect(() => {
    if (current) return;
    setSelected(ordered[0]?.path ?? null);
  }, [current, ordered]);

  useEffect(() => {
    if (!current) {
      setSaved("");
      setTruncated(false);
      return;
    }
    let cancelled = false;
    setBusy(true);
    setError("");
    void onReadRef.current(current.path)
      .then((preview) => {
        if (cancelled) return;
        setSaved(preview.content);
        setTruncated(preview.truncated);
      })
      .catch((item: unknown) => {
        if (cancelled) return;
        setError(item instanceof Error ? item.message : "读不了这个文件");
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
    // Reload when the selected path changes; `current` is derived from that path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.path]);

  async function save(): Promise<void> {
    if (!current || !dirty || truncated || busy) return;
    const savePath = current.path;
    setBusy(true);
    setError("");
    try {
      await onWrite(savePath, draft);
      editor.clear({ content: draft });
      if (currentPathRef.current === savePath) setSaved(draft);
    } catch (item: unknown) {
      if (currentPathRef.current === savePath) setError(item instanceof Error ? item.message : "保存失败");
    } finally {
      if (currentPathRef.current === savePath) setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3 p-3">
        <p className="text-sm leading-6 text-mute">正在读取约定…</p>
      </div>
    );
  }

  if (ordered.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3 p-3">
        <p className="text-sm leading-6 text-mute">还没有 AGENTS.md。</p>
        {onCreate ? (
          <button type="button" className="pressable btn btn-secondary self-start" onClick={() => onCreate()}>
            创建 AGENTS.md
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line px-1.5 py-1">
        {ordered.map((file) => (
          <button
            key={file.path}
            type="button"
            title={file.path}
            disabled={busy}
            className={`pressable h-7 shrink-0 rounded-md px-2 text-[12px] ${
              file.path === current?.path ? "bg-fill-strong text-ink" : "hover-fill text-mute"
            }`}
            onClick={() => setSelected(file.path)}
          >
            {fileLabel(file)}
          </button>
        ))}
        <button
          type="button"
          className="pressable btn btn-primary ml-auto h-7 shrink-0"
          disabled={!dirty || busy}
          onClick={() => void save()}
        >
          {busy ? "处理中…" : "保存"}
        </button>
      </div>
      {dirty ? <div className="draft-notice"><span>草稿已暂存，切换后可继续编辑</span><button type="button" className="pressable text-accent" disabled={busy} onClick={() => editor.discard()}>放弃修改</button></div> : null}
      {error ? <p role="alert" className="shrink-0 px-3 py-1.5 text-[12px] text-danger">{error}</p> : null}
      {truncated ? (
        <p className="shrink-0 px-3 py-1.5 text-[12px] text-mute">文件太大，这里只能看前一段，不能改。</p>
      ) : null}
      {busy && !draft ? <p className="shrink-0 px-3 py-1.5 text-[12px] text-mute">正在读取约定…</p> : null}
      <textarea
        aria-label="约定内容"
        className="min-h-0 flex-1 resize-none border-0 bg-transparent px-3 py-2 font-mono text-[12px] leading-5 text-ink outline-none"
        value={draft}
        disabled={busy || truncated || !current}
        onChange={(event) => editor.update({ content: event.target.value })}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "s") {
            event.preventDefault();
            void save();
          }
        }}
      />
    </div>
  );
}
