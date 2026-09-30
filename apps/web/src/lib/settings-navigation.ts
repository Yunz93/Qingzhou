export function settingsReturnPath(state: unknown): string {
  const from = state && typeof state === "object" ? (state as { from?: unknown }).from : null;
  return typeof from === "string" && (from === "/" || /^\/board(?:[?#]|$)/.test(from)) ? from : "/";
}
