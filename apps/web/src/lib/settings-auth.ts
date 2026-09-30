export type AuthEntryLike = {
  id: string;
  label: string;
  kind: "api_key" | "oauth" | "other";
  source?: "auth_file" | "env" | "models_json" | "other";
  envVar?: string;
};

export type AuthCatalogItem = {
  id: string;
  label: string;
  hint?: string;
  oauth: boolean;
  apiKey: boolean;
};

export type AuthMode = "oauth" | "api_key" | "env";

const PREFERRED_ORDER = ["github", "openai"];

/** Credentials detected from process env — shown in the env tab only. */
export function envAuthEntries(entries: AuthEntryLike[]): AuthEntryLike[] {
  return entries.filter((entry) => entry.source === "env");
}

/** Connected list for a tab; env credentials stay on the env tab. */
export function connectedAuthEntries(entries: AuthEntryLike[], mode: AuthMode): AuthEntryLike[] {
  if (mode === "env") return envAuthEntries(entries);
  if (mode === "oauth") {
    return entries.filter((entry) => entry.kind === "oauth" && entry.source !== "env");
  }
  return entries.filter(
    (entry) => entry.kind === "api_key" && entry.source !== "env",
  );
}

/** auth.json keys that count as logged-in for a UI oauth provider. */
export function oauthAuthIds(providerId: string): string[] {
  if (providerId === "github" || providerId === "github-copilot") {
    return ["github-copilot", "github"];
  }
  if (providerId === "openai" || providerId === "openai-codex") {
    return ["openai-codex"];
  }
  return [providerId];
}

export function findAuthEntry(
  entries: AuthEntryLike[],
  providerId: string,
  mode: Exclude<AuthMode, "env">,
): AuthEntryLike | undefined {
  if (mode === "oauth") {
    const ids = new Set(oauthAuthIds(providerId));
    return entries.find((entry) => ids.has(entry.id) && entry.kind === "oauth");
  }
  return entries.find((entry) => entry.id === providerId && entry.kind === "api_key");
}

export function mergeAuthCatalog(
  oauthProviders: Array<{ id: string; label: string }>,
  keyProviders: Array<{ id: string; label: string; hint: string }>,
  extraEntries: Array<{ id: string; label: string }> = [],
): AuthCatalogItem[] {
  const items = new Map<string, AuthCatalogItem>();

  const touch = (partial: AuthCatalogItem) => {
    const current = items.get(partial.id);
    if (!current) {
      items.set(partial.id, { ...partial });
      return;
    }
    items.set(partial.id, {
      id: partial.id,
      label: current.label || partial.label,
      hint: current.hint ?? partial.hint,
      oauth: current.oauth || partial.oauth,
      apiKey: current.apiKey || partial.apiKey,
    });
  };

  for (const provider of oauthProviders) {
    touch({ id: provider.id, label: provider.label, oauth: true, apiKey: false });
  }
  for (const provider of keyProviders) {
    touch({
      id: provider.id,
      label: provider.label,
      hint: provider.hint,
      oauth: false,
      apiKey: true,
    });
  }
  for (const entry of extraEntries) {
    touch({ id: entry.id, label: entry.label, oauth: false, apiKey: false });
  }

  const preferred = PREFERRED_ORDER.filter((id) => items.has(id));
  const rest = [...items.keys()]
    .filter((id) => !preferred.includes(id))
    .sort((left, right) => {
      const leftIndex = keyProviders.findIndex((item) => item.id === left);
      const rightIndex = keyProviders.findIndex((item) => item.id === right);
      if (leftIndex >= 0 && rightIndex >= 0) return leftIndex - rightIndex;
      if (leftIndex >= 0) return -1;
      if (rightIndex >= 0) return 1;
      return left.localeCompare(right);
    });

  return [...preferred, ...rest].map((id) => items.get(id)!);
}

/** Providers available in the current auth mode (login vs API key). Env tab has none. */
export function providersForMode(catalog: AuthCatalogItem[], mode: AuthMode): AuthCatalogItem[] {
  if (mode === "env") return [];
  return catalog.filter((item) => (mode === "oauth" ? item.oauth : item.apiKey));
}

export function pickDefaultProvider(
  catalog: AuthCatalogItem[],
  mode: AuthMode,
  preferredId?: string | null,
): string {
  if (mode === "env") return "";
  const list = providersForMode(catalog, mode);
  if (preferredId && list.some((item) => item.id === preferredId)) return preferredId;
  return list[0]?.id ?? "";
}

export function authStatusLabel(
  kind: "api_key" | "oauth" | "other" | undefined,
  capabilities: { oauth?: boolean; apiKey?: boolean } = {},
): string {
  if (kind === "oauth") return "已登录";
  if (kind === "api_key") return "已保存密钥";
  if (kind === "other") return "已连接";
  if (capabilities.oauth) return "未登录";
  return "未配置密钥";
}

/** Where a saved credential lives, for entries the UI does not manage itself. */
export function authSourceLabel(entry?: Pick<AuthEntryLike, "source" | "envVar">): string | null {
  if (!entry?.source || entry.source === "auth_file") return null;
  if (entry.source === "env") return entry.envVar ? `环境变量 ${entry.envVar}` : "环境变量";
  if (entry.source === "models_json") return "models.json";
  return "外部设置";
}

/** Entries the UI can remove from auth.json (external credentials cannot be unset here). */
export function isRemovableAuthEntry(entry?: Pick<AuthEntryLike, "source">): boolean {
  return entry !== undefined && (entry.source === undefined || entry.source === "auth_file");
}

/** Status text for an auth entry; external credentials report their origin instead of "saved". */
export function authEntryStatusLabel(
  entry?: AuthEntryLike,
  capabilities: { oauth?: boolean; apiKey?: boolean } = {},
): string {
  const source = authSourceLabel(entry);
  if (entry?.source === "env") return source ?? "环境变量";
  if (entry?.source === "models_json") return `${source} 中的密钥`;
  if (entry?.source === "other") return "外部设置";
  return authStatusLabel(entry?.kind, capabilities);
}

export function oauthButtonLabel(kind: "api_key" | "oauth" | "other" | undefined): string {
  return kind === "oauth" ? "重新登录" : "订阅登录";
}

export function logoutNotice(kind: "api_key" | "oauth" | "other" | undefined): string {
  return kind === "api_key" ? "已移除密钥。" : "已退出登录。";
}
