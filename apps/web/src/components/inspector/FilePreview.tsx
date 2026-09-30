import hljs from "highlight.js";
import type { FilePreviewPayload } from "@qingzhou/protocol";

type Props = {
  path: string;
  content: string;
  language?: string;
  truncated?: boolean;
  chrome?: boolean;
  kind?: FilePreviewPayload["kind"];
  mimeType?: string;
  dataUrl?: string;
};

function highlight(content: string, language?: string): string {
  if (language && hljs.getLanguage(language)) {
    return hljs.highlight(content, { language }).value;
  }
  return hljs.highlightAuto(content).value;
}

function fileName(pathValue: string): string {
  return pathValue.replaceAll("\\", "/").split("/").pop() || pathValue;
}

export function FilePreview({
  path: filePath,
  content,
  language,
  truncated,
  chrome = true,
  kind = "text",
  mimeType,
  dataUrl,
}: Props) {
  const name = fileName(filePath);

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas" aria-label={filePath}>
      {chrome ? (
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-3">
          <span className="min-w-0 truncate text-[12px] text-ink">{name}</span>
          {mimeType ? <span className="shrink-0 text-[11px] text-mute">{mimeType}</span> : null}
          {truncated ? <span className="ml-auto shrink-0 text-[11px] text-mute">已截断</span> : null}
        </div>
      ) : null}
      {kind === "image" && dataUrl ? (
        <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto p-3">
          <img src={dataUrl} alt={name} className="max-h-full max-w-full object-contain" />
        </div>
      ) : kind === "audio" && dataUrl ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          <audio controls preload="metadata" src={dataUrl} className="w-full max-w-md">
            浏览器无法播放此音频。
          </audio>
        </div>
      ) : kind === "video" && dataUrl ? (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3">
          <video controls preload="metadata" src={dataUrl} className="max-h-full max-w-full">
            浏览器无法播放此视频。
          </video>
        </div>
      ) : kind === "binary" ? (
        <p className="p-4 text-sm text-mute">{content || "这个文件暂不支持预览。"}</p>
      ) : (
        <TextPreview content={content} language={language} />
      )}
    </div>
  );
}

function TextPreview({ content, language }: { content: string; language?: string }) {
  const html = highlight(content, language);
  const lines = (html || " ").split("\n");
  return (
    <div className="min-h-0 flex-1 overflow-auto py-2 font-mono text-[12px] leading-5 text-ink">
      {lines.map((line, index) => (
        <div key={index} className="flex">
          <span
            aria-hidden
            className="w-8 shrink-0 select-none pr-2 text-right text-[11px] text-mute tabular"
          >
            {index + 1}
          </span>
          <span
            className="min-w-0 flex-1 whitespace-pre-wrap break-words px-1"
            dangerouslySetInnerHTML={{ __html: line || "&nbsp;" }}
          />
        </div>
      ))}
    </div>
  );
}
