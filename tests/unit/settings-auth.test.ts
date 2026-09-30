import { describe, expect, it } from "vitest";
import {
  authEntryStatusLabel,
  authSourceLabel,
  authStatusLabel,
  connectedAuthEntries,
  envAuthEntries,
  findAuthEntry,
  isRemovableAuthEntry,
  logoutNotice,
  mergeAuthCatalog,
  oauthButtonLabel,
  pickDefaultProvider,
  providersForMode,
} from "../../apps/web/src/lib/settings-auth.ts";
import { OAUTH_PROVIDERS } from "../../apps/server/src/setup/auth-status.ts";

describe("settings auth catalog", () => {
  it("puts GitHub Copilot and OpenAI first and merges oauth with API keys", () => {
    const catalog = mergeAuthCatalog(
      [
        { id: "github", label: "GitHub Copilot" },
        { id: "openai", label: "OpenAI (ChatGPT)" },
      ],
      [
        { id: "anthropic", label: "Anthropic (Claude)", hint: "sk-ant" },
        { id: "openai", label: "OpenAI", hint: "sk-" },
        { id: "google", label: "Google Gemini", hint: "Gemini" },
      ],
      [{ id: "groq", label: "Groq" }],
    );
    expect(catalog.map((item) => item.id)).toEqual(["github", "openai", "anthropic", "google", "groq"]);
    expect(catalog.find((item) => item.id === "openai")).toEqual({
      id: "openai",
      label: "OpenAI (ChatGPT)",
      hint: "sk-",
      oauth: true,
      apiKey: true,
    });
    expect(catalog.find((item) => item.id === "github")?.oauth).toBe(true);
    expect(catalog.find((item) => item.id === "github")?.apiKey).toBe(false);
  });

  it("filters providers by auth mode so login and API key stay separate", () => {
    const catalog = mergeAuthCatalog(
      [
        { id: "github", label: "GitHub Copilot" },
        { id: "openai", label: "OpenAI (ChatGPT)" },
      ],
      [
        { id: "anthropic", label: "Anthropic (Claude)", hint: "sk-ant" },
        { id: "openai", label: "OpenAI", hint: "sk-" },
      ],
    );
    expect(providersForMode(catalog, "oauth").map((item) => item.id)).toEqual(["github", "openai"]);
    expect(providersForMode(catalog, "api_key").map((item) => item.id)).toEqual(["openai", "anthropic"]);
    expect(providersForMode(catalog, "env")).toEqual([]);
    expect(pickDefaultProvider(catalog, "oauth")).toBe("github");
    expect(pickDefaultProvider(catalog, "api_key", "anthropic")).toBe("anthropic");
    expect(pickDefaultProvider(catalog, "env")).toBe("");
  });

  it("keeps env credentials on their own tab", () => {
    const entries = [
      { id: "github", label: "GitHub Copilot", kind: "oauth" as const, source: "auth_file" as const },
      { id: "anthropic", label: "Anthropic (Claude)", kind: "api_key" as const, source: "auth_file" as const },
      { id: "deepseek", label: "DeepSeek", kind: "api_key" as const, source: "env" as const, envVar: "DEEPSEEK_API_KEY" },
      { id: "acme", label: "acme", kind: "api_key" as const, source: "models_json" as const },
    ];
    expect(envAuthEntries(entries).map((item) => item.id)).toEqual(["deepseek"]);
    expect(connectedAuthEntries(entries, "env").map((item) => item.id)).toEqual(["deepseek"]);
    expect(connectedAuthEntries(entries, "oauth").map((item) => item.id)).toEqual(["github"]);
    expect(connectedAuthEntries(entries, "api_key").map((item) => item.id)).toEqual(["anthropic", "acme"]);
  });

  it("labels saved api keys and oauth without sounding like buttons", () => {
    expect(authStatusLabel("oauth")).toBe("已登录");
    expect(authStatusLabel("api_key")).toBe("已保存密钥");
    expect(authStatusLabel(undefined, { oauth: true })).toBe("未登录");
    expect(authStatusLabel(undefined, { apiKey: true })).toBe("未配置密钥");
    expect(oauthButtonLabel(undefined)).toBe("订阅登录");
    expect(oauthButtonLabel("oauth")).toBe("重新登录");
    expect(logoutNotice("api_key")).toBe("已移除密钥。");
    expect(logoutNotice("oauth")).toBe("已退出登录。");
  });

  it("reports external credentials by their source", () => {
    expect(authSourceLabel({ source: "auth_file" })).toBeNull();
    expect(authSourceLabel(undefined)).toBeNull();
    expect(authSourceLabel({ source: "env", envVar: "KIMI_API_KEY" })).toBe("环境变量 KIMI_API_KEY");
    expect(authSourceLabel({ source: "env" })).toBe("环境变量");
    expect(authSourceLabel({ source: "models_json" })).toBe("models.json");
    const env = { id: "kimi-coding", label: "Kimi For Coding", kind: "api_key" as const, source: "env" as const, envVar: "KIMI_API_KEY" };
    expect(authEntryStatusLabel(env)).toBe("环境变量 KIMI_API_KEY");
    expect(authEntryStatusLabel({ ...env, source: "models_json", envVar: undefined })).toBe("models.json 中的密钥");
    expect(authEntryStatusLabel({ ...env, source: "auth_file", envVar: undefined })).toBe("已保存密钥");
    expect(authEntryStatusLabel({ ...env, source: undefined, envVar: undefined })).toBe("已保存密钥");
    expect(authEntryStatusLabel({ id: "github", label: "GitHub Copilot", kind: "oauth", source: "auth_file" })).toBe("已登录");
    expect(isRemovableAuthEntry(undefined)).toBe(false);
    expect(isRemovableAuthEntry({ source: "auth_file" })).toBe(true);
    expect(isRemovableAuthEntry({})).toBe(true);
    expect(isRemovableAuthEntry({ source: "env" })).toBe(false);
    expect(isRemovableAuthEntry({ source: "models_json" })).toBe(false);
    expect(isRemovableAuthEntry({ source: "other" })).toBe(false);
  });

  it("exposes OpenAI as an oauth login provider", () => {
    expect(OAUTH_PROVIDERS.map((item) => item.id)).toEqual(["github", "openai"]);
  });

  it("treats openai-codex auth as the OpenAI subscription login", () => {
    const entries = [
      { id: "openai-codex", label: "OpenAI (ChatGPT)", kind: "oauth" as const },
      { id: "openai", label: "OpenAI", kind: "api_key" as const },
    ];
    expect(findAuthEntry(entries, "openai", "oauth")?.id).toBe("openai-codex");
    expect(findAuthEntry(entries, "openai", "api_key")?.id).toBe("openai");
  });
});
