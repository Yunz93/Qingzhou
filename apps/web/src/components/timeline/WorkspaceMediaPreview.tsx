import { useEffect, useState } from "react";
import type { FilePreviewPayload } from "@qingzhou/protocol";
import { socketClient } from "../../transport/socket-client";

type Props = {
  src: string;
  alt?: string;
  taskId: string | null;
};

export function WorkspaceMediaPreview({ src, alt, taskId }: Props) {
  const [preview, setPreview] = useState<FilePreviewPayload | null>(null);
  const [error, setError] = useState("");
  const label = alt?.trim() || src.replaceAll("\\", "/").split("/").pop() || "媒体";

  useEffect(() => {
    if (!taskId) {
      setError("没有可用会话，无法预览本地文件。");
      return;
    }
    let cancelled = false;
    setPreview(null);
    setError("");
    void socketClient
      .send<FilePreviewPayload>("files.read", { path: src, emit: false }, taskId)
      .then((result) => {
        if (cancelled) return;
        if (!result?.dataUrl && result?.kind !== "binary" && result?.kind !== "text") {
          setError("无法预览这个文件。");
          return;
        }
        setPreview(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "预览失败");
      });
    return () => {
      cancelled = true;
    };
  }, [src, taskId]);

  if (error) {
    return (
      <span className="inline-flex flex-col gap-1 rounded-md border border-line bg-fill px-2 py-1.5 text-[12px] text-mute">
        <span>{label}</span>
        <span className="text-danger">{error}</span>
      </span>
    );
  }

  if (!preview) {
    return <span className="text-[12px] text-mute">正在加载 {label}…</span>;
  }

  if (preview.kind === "image" && preview.dataUrl) {
    return (
      <a
        className="my-2 block max-w-full overflow-hidden rounded-md border border-line bg-fill"
        href={preview.dataUrl}
        target="_blank"
        rel="noreferrer"
        title={src}
      >
        <img src={preview.dataUrl} alt={label} className="max-h-[360px] max-w-full object-contain" />
      </a>
    );
  }

  if (preview.kind === "audio" && preview.dataUrl) {
    return (
      <div className="my-2 rounded-md border border-line bg-fill px-3 py-2">
        <p className="mb-1 text-[12px] text-mute">{label}</p>
        <audio controls preload="metadata" src={preview.dataUrl} className="w-full max-w-md" />
      </div>
    );
  }

  if (preview.kind === "video" && preview.dataUrl) {
    return (
      <div className="my-2 overflow-hidden rounded-md border border-line bg-fill">
        <p className="border-b border-line px-3 py-1.5 text-[12px] text-mute">{label}</p>
        <video controls preload="metadata" src={preview.dataUrl} className="max-h-[360px] w-full bg-black" />
      </div>
    );
  }

  if (preview.kind === "text" && preview.language === "svg" && preview.content) {
    const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(preview.content)}`;
    return (
      <a className="my-2 block max-w-full overflow-hidden rounded-md border border-line bg-fill" href={dataUrl} target="_blank" rel="noreferrer">
        <img src={dataUrl} alt={label} className="max-h-[360px] max-w-full object-contain" />
      </a>
    );
  }

  return (
    <span className="inline-flex flex-col gap-1 rounded-md border border-line bg-fill px-2 py-1.5 text-[12px] text-mute">
      <span>{label}</span>
      <span>{preview.content || "暂不支持预览这个文件。"}</span>
    </span>
  );
}
