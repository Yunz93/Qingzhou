const FENCE_LINE = /^```/;

const MEDIA_EXT =
  /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif|mp3|wav|ogg|m4a|aac|flac|mp4|webm|mov|m4v|ogv)(?:$|[?#])/i;

export function stabilizeMarkdown(text: string): string {
  const fences = text.split("\n").filter((line) => FENCE_LINE.test(line)).length;
  return fences % 2 === 1 ? `${text}\n\`\`\`` : text;
}

export function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function shouldOpenMarkdownLink(href: string | undefined): boolean {
  if (!href) return false;
  try {
    const url = new URL(href, "http://127.0.0.1");
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]") {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Decode markdown/file URL encoding and strip file:// so fs paths match disk. */
export function normalizeWorkspaceMediaPath(href: string): string {
  let value = href.trim().replace(/^['"]|['"]$/g, "");
  if (!value) return value;

  if (/^file:/i.test(value)) {
    try {
      const url = new URL(value);
      value = decodeURIComponent(url.pathname);
      // file:///C:/... on Windows → /C:/...; keep a drive path Node can open.
      if (/^\/[A-Za-z]:\//.test(value)) value = value.slice(1);
    } catch {
      value = value.replace(/^file:\/\//i, "");
      try {
        value = decodeURIComponent(value);
      } catch {
        // keep raw
      }
    }
  } else if (/%[0-9A-Fa-f]{2}/.test(value)) {
    try {
      value = decodeURIComponent(value);
    } catch {
      // keep raw when malformed
    }
  }

  // Drop trailing markdown junk sometimes left on paths.
  value = value.replace(/[)#]+$/g, "");
  return value;
}

/** Local / workspace paths that may be previewed via files.read (not opened as browser links). */
export function isWorkspaceMediaPath(href: string | undefined): boolean {
  if (!href) return false;
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("blob:")) return false;
  if (/^(javascript|vbscript|data):/i.test(trimmed)) return false;
  if (shouldOpenMarkdownLink(trimmed)) return false;
  const normalized = normalizeWorkspaceMediaPath(trimmed);
  // Bare filenames / relative / absolute paths: do not resolve against http base.
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(normalized)) {
    return MEDIA_EXT.test(normalized) || /^[./~]/.test(normalized) || /^[A-Za-z]:[\\/]/.test(normalized);
  }
  try {
    const url = new URL(normalized);
    if (url.protocol === "file:") return MEDIA_EXT.test(url.pathname);
  } catch {
    return MEDIA_EXT.test(normalized);
  }
  return false;
}

export function markdownUrlTransform(url: string): string {
  if (shouldOpenMarkdownLink(url) || isWorkspaceMediaPath(url)) return url;
  return "";
}

export function humanizeWorkspaceMediaError(message: string): string {
  if (/ENOENT|no such file or directory/i.test(message)) {
    return "找不到这个文件。";
  }
  if (/Path escapes|不在允许的范围|escapes working directory/i.test(message)) {
    return "文件不在当前工作文件夹内。";
  }
  return message;
}
