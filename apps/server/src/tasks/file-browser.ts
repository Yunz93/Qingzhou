import { opendir, readFile } from "node:fs/promises";
import path from "node:path";
import type { FilePreviewPayload } from "@qingzhou/protocol";
import { resolveAllowedPath } from "../security/path-policy.js";

export type FileEntry = { path: string; name: string; kind: "file" | "dir" };

const MAX_ENTRIES = 400;
const MAX_DEPTH = 6;
const MAX_PREVIEW_BYTES = 200_000;
const MAX_MEDIA_PREVIEW_BYTES = 2_500_000;

const IGNORED_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".parcel-cache",
  "__pycache__",
  "venv",
  ".venv",
  "target",
  ".mypi-test",
  "vendor",
  "bower_components",
  ".DS_Store",
]);

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
};

const AUDIO_MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
};

const VIDEO_MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/mp4",
  ".ogv": "video/ogg",
};

export async function listProjectFiles(root: string): Promise<FileEntry[]> {
  const entries: FileEntry[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || entries.length >= MAX_ENTRIES) return;
    const directory = await opendir(dir);
    for await (const child of directory) {
      if (entries.length >= MAX_ENTRIES) break;
      if (child.name.startsWith(".") || IGNORED_DIR_NAMES.has(child.name)) continue;
      const full = path.join(dir, child.name);
      const relative = path.relative(root, full);
      if (child.isDirectory()) {
        entries.push({ path: relative, name: child.name, kind: "dir" });
        await walk(full, depth + 1);
      } else {
        entries.push({ path: relative, name: child.name, kind: "file" });
      }
    }
  };
  await walk(root, 0);
  return entries;
}

export function mediaKindForPath(filePath: string): "image" | "audio" | "video" | null {
  const ext = path.extname(filePath).toLowerCase();
  if (IMAGE_MIME[ext]) return "image";
  if (AUDIO_MIME[ext]) return "audio";
  if (VIDEO_MIME[ext]) return "video";
  return null;
}

export function mimeTypeForPath(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_MIME[ext] ?? AUDIO_MIME[ext] ?? VIDEO_MIME[ext];
}

function toDataUrl(mimeType: string, buffer: Buffer, ext: string): string {
  if (ext === ".svg") {
    const text = buffer.toString("utf8");
    return `data:${mimeType};charset=utf-8,${encodeURIComponent(text)}`;
  }
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

export async function previewProjectFile(
  relativePath: string,
  cwd: string,
  allowedRoots: string[],
): Promise<FilePreviewPayload> {
  const resolved = await resolveAllowedPath(relativePath, cwd, allowedRoots);
  const buffer = await readFile(resolved);
  const ext = path.extname(relativePath).toLowerCase();
  const mediaKind = mediaKindForPath(relativePath);
  const mimeType = mimeTypeForPath(relativePath);

  if (mediaKind && mimeType) {
    if (buffer.byteLength > MAX_MEDIA_PREVIEW_BYTES) {
      return {
        path: relativePath,
        kind: "binary",
        content: `文件过大（${Math.ceil(buffer.byteLength / 1024)} KB），无法在应用内预览。`,
        truncated: true,
        language: ext.slice(1) || undefined,
        mimeType,
      };
    }
    return {
      path: relativePath,
      kind: mediaKind,
      content: "",
      truncated: false,
      language: ext.slice(1) || undefined,
      mimeType,
      dataUrl: toDataUrl(mimeType, buffer, ext),
    };
  }

  // Heuristic: high NUL ratio ⇒ binary, not text.
  const sample = buffer.subarray(0, Math.min(buffer.byteLength, 8_192));
  let nul = 0;
  for (const byte of sample) if (byte === 0) nul += 1;
  if (sample.byteLength > 0 && nul / sample.byteLength > 0.02) {
    return {
      path: relativePath,
      kind: "binary",
      content: "这个文件是二进制内容，暂不支持预览。",
      truncated: false,
      language: ext.slice(1) || undefined,
    };
  }

  return {
    path: relativePath,
    kind: "text",
    content: buffer.subarray(0, MAX_PREVIEW_BYTES).toString("utf8"),
    truncated: buffer.byteLength > MAX_PREVIEW_BYTES,
    language: ext.slice(1) || undefined,
  };
}
