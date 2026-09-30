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

/** Local / workspace paths that may be previewed via files.read (not opened as browser links). */
export function isWorkspaceMediaPath(href: string | undefined): boolean {
  if (!href) return false;
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("blob:")) return false;
  if (/^(javascript|vbscript|data):/i.test(trimmed)) return false;
  if (shouldOpenMarkdownLink(trimmed)) return false;
  // Bare filenames / relative paths: do not resolve against http base (that invents a host).
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return MEDIA_EXT.test(trimmed) || /^[./~]/.test(trimmed) || /^[A-Za-z]:[\\/]/.test(trimmed);
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol === "file:") return MEDIA_EXT.test(url.pathname);
  } catch {
    return MEDIA_EXT.test(trimmed);
  }
  return false;
}

export function markdownUrlTransform(url: string): string {
  if (shouldOpenMarkdownLink(url) || isWorkspaceMediaPath(url)) return url;
  return "";
}
