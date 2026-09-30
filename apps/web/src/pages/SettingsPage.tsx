import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { useAgentStore } from "../stores/agent-store";
import { SetupWizard, type SetupStatus, setupStorePayload } from "../components/setup/SetupWizard";
import { useTheme } from "../hooks/useTheme";
import { socketClient } from "../transport/socket-client";
import { authEntryStatusLabel, connectedAuthEntries, envAuthEntries, findAuthEntry, isRemovableAuthEntry, logoutNotice, mergeAuthCatalog, oauthButtonLabel, pickDefaultProvider, providersForMode, type AuthMode } from "../lib/settings-auth";
import { UpdateBanner } from "../components/app/UpdateBanner";
import { AppUpdateSection } from "../components/settings/AppUpdateSection";

type ProviderOption = { id: string; label: string; hint: string };

type PiLatest = {
  current: string | null;
  latest: string | null;
  updateAvailable: boolean;
  canUpdate: boolean;
  piBundled: boolean;
  error: string | null;
};

export function SettingsPage() {
  const piVersion = useAgentStore((state) => state.piVersion);
  const piError = useAgentStore((state) => state.piError);
  const allowedRoots = useAgentStore((state) => state.allowedRoots);
  const dataDir = useAgentStore((state) => state.dataDir);
  const workspaceRoot = useAgentStore((state) => state.workspaceRoot);
  const authEntries = useAgentStore((state) => state.authEntries);
  const trustProject = useAgentStore((state) => state.trustProject);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [theme, setTheme] = useTheme();
  const [models, setModels] = useState<{ present: boolean; count: number }>({ present: false, count: 0 });
  const [trustBusy, setTrustBusy] = useState(false);
  const [installBusy, setInstallBusy] = useState(false);
  const [installError, setInstallError] = useState("");
  const [canInstallPi, setCanInstallPi] = useState(false);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [oauthProviders, setOauthProviders] = useState<Array<{ id: string; label: string }>>([
    { id: "github", label: "GitHub Copilot" },
    { id: "openai", label: "OpenAI (ChatGPT)" },
  ]);
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [keyBusy, setKeyBusy] = useState("");
  const [piLatest, setPiLatest] = useState<PiLatest | null>(null);
  const [checkBusy, setCheckBusy] = useState(false);
  const [authBusy, setAuthBusy] = useState("");
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [flash, setFlash] = useState<{ id: string; tone: "ok" | "err"; text: string } | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("oauth");
  const [selectedProvider, setSelectedProvider] = useState("github");

  function applySetup(setup: SetupStatus) {
    setModels({ present: Boolean(setup.hasModelsFile), count: setup.modelCount ?? 0 });
    setCanInstallPi(setup.canInstallPi !== false && !setup.piBundled);
    if (setup.providers?.length) {
      setProviders(setup.providers);
    }
    if (setup.oauthProviders?.length) {
      setOauthProviders(setup.oauthProviders);
    }
    useAgentStore.getState().setSetupState(setupStorePayload(setup));
  }

  useEffect(() => {
    void fetch("/api/setup", { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((setup: SetupStatus | null) => {
        if (!setup) return;
        applySetup(setup);
      });
    void fetch("/api/setup/pi-latest", { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((json: PiLatest | null) => {
        if (json) setPiLatest(json);
      })
      .catch(() => {
        /* 打开设置页时检查失败不挡操作，可再点「检查更新」。 */
      });
  }, []);

  async function toggleTrust(next: boolean) {
    setTrustBusy(true);
    try {
      const response = await fetch("/api/setup/trust", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trust: next }),
      });
      if (!response.ok) return;
      const setup = (await response.json()) as SetupStatus;
      applySetup(setup);
    } finally {
      setTrustBusy(false);
    }
  }

  async function installPi(force = false) {
    setInstallBusy(true);
    setInstallError("");
    try {
      const response = await fetch("/api/setup/install-pi", {
        method: "POST",
        credentials: "same-origin",
        headers: force ? { "content-type": "application/json" } : undefined,
        body: force ? JSON.stringify({ force: true }) : undefined,
      });
      const json = (await response.json()) as SetupStatus & { error?: string };
      if (!response.ok) {
        setInstallError(json.error ?? "安装 Pi 失败。");
        return;
      }
      applySetup(json);
      void socketClient.send("snapshot.request");
      await checkPiUpdate();
    } catch {
      setInstallError(force ? "更新 Pi 失败。" : "安装 Pi 失败。");
    } finally {
      setInstallBusy(false);
    }
  }

  async function checkPiUpdate() {
    setCheckBusy(true);
    try {
      const response = await fetch("/api/setup/pi-latest", { credentials: "same-origin" });
      const json = (await response.json()) as PiLatest & { error?: string };
      if (!response.ok) {
        setPiLatest({
          current: piVersion,
          latest: null,
          updateAvailable: false,
          canUpdate: canInstallPi,
          piBundled: !canInstallPi,
          error: json.error ?? "检查更新失败。",
        });
        return;
      }
      setPiLatest(json);
      if (json.current !== undefined) {
        useAgentStore.getState().setSetupState({
          ...useAgentStore.getState(),
          piVersion: json.current,
          piAvailable: Boolean(json.current),
        });
      }
    } catch {
      setPiLatest({
        current: piVersion,
        latest: null,
        updateAvailable: false,
        canUpdate: canInstallPi,
        piBundled: !canInstallPi,
        error: "检查更新失败。",
      });
    } finally {
      setCheckBusy(false);
    }
  }

  async function saveApiKey(providerId: string) {
    const apiKey = keyDrafts[providerId] ?? "";
    setKeyBusy(providerId);
    setFlash(null);
    try {
      const response = await fetch("/api/setup/api-key", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: providerId, apiKey }),
      });
      const json = (await response.json()) as SetupStatus & { error?: string };
      if (!response.ok) {
        setFlash({ id: providerId, tone: "err", text: json.error ?? "密钥保存失败。" });
        return;
      }
      applySetup(json);
      setKeyDrafts((current) => ({ ...current, [providerId]: "" }));
      const label = providers.find((item) => item.id === providerId)?.label ?? providerId;
      setFlash({ id: providerId, tone: "ok", text: `已保存 ${label} 的密钥。` });
      void socketClient.send("snapshot.request");
    } catch {
      setFlash({ id: providerId, tone: "err", text: "密钥保存失败。" });
    } finally {
      setKeyBusy("");
    }
  }

  async function refreshAuth() {
    setRefreshBusy(true);
    setFlash(null);
    try {
      const response = await fetch("/api/setup", { credentials: "same-origin" });
      const setup = (await response.json()) as SetupStatus;
      if (!response.ok) {
        setFlash({ id: "sync", tone: "err", text: "刷新登录状态失败。" });
        return;
      }
      applySetup(setup);
      void socketClient.send("snapshot.request");
      setFlash({ id: "sync", tone: "ok", text: "已刷新登录状态。" });
    } catch {
      setFlash({ id: "sync", tone: "err", text: "刷新登录状态失败。" });
    } finally {
      setRefreshBusy(false);
    }
  }

  async function logoutProvider(provider: string) {
    const kind = authEntries.find((entry) => entry.id === provider)?.kind;
    setAuthBusy(provider);
    setFlash(null);
    try {
      const response = await fetch("/api/setup/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const json = (await response.json()) as SetupStatus & { error?: string };
      if (!response.ok) {
        setFlash({ id: flashIdForProvider(provider), tone: "err", text: json.error ?? "退出失败。" });
        return;
      }
      applySetup(json);
      void socketClient.send("snapshot.request");
      setFlash({ id: flashIdForProvider(provider), tone: "ok", text: logoutNotice(kind) });
    } catch {
      setFlash({ id: flashIdForProvider(provider), tone: "err", text: "退出失败。" });
    } finally {
      setAuthBusy("");
    }
  }

  function flashIdForProvider(provider: string): string {
    if (provider === "openai-codex") return "openai";
    if (provider === "github-copilot") return "github";
    return provider;
  }

  async function loginProvider(provider: string) {
    setAuthBusy(provider);
    setFlash(null);
    try {
      const response = await fetch("/api/setup/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const json = (await response.json()) as SetupStatus & {
        error?: string;
        hint?: string;
        loginCompleted?: boolean;
        loginStarted?: boolean;
      };
      if (!response.ok) {
        setFlash({ id: provider, tone: "err", text: json.error ?? "无法打开登录。" });
        return;
      }
      applySetup(json);
      void socketClient.send("snapshot.request");
      if (json.loginCompleted) {
        setFlash({ id: provider, tone: "ok", text: json.hint ?? "订阅登录已完成。" });
      } else {
        setFlash({
          id: provider,
          tone: json.loginStarted ? "ok" : "err",
          text: json.hint ?? "完成订阅登录后，点下面的刷新同步状态。",
        });
      }
    } catch {
      setFlash({ id: provider, tone: "err", text: "无法打开登录。" });
    } finally {
      setAuthBusy("");
    }
  }

  const catalog = mergeAuthCatalog(oauthProviders, providers, authEntries);
  const modeProviders = providersForMode(catalog, authMode);
  const activeProviderId = pickDefaultProvider(catalog, authMode, selectedProvider);
  const activeItem = modeProviders.find((item) => item.id === activeProviderId) ?? modeProviders[0] ?? null;
  const activeEntry =
    activeItem && authMode !== "env" ? findAuthEntry(authEntries, activeItem.id, authMode) : undefined;
  const activeDraft = activeItem ? (keyDrafts[activeItem.id] ?? "") : "";
  const activeFlash = activeItem && flash?.id === activeItem.id ? flash : flash?.id === "sync" ? flash : null;
  const envEntries = envAuthEntries(authEntries);
  const connectedEntries = connectedAuthEntries(authEntries, authMode);
  const engineDetail = piVersion ? `已就绪（Pi ${piVersion}）` : (piError ?? "还没准备好");
  let updateDetail: string | null = null;
  if (piLatest?.error) updateDetail = piLatest.error;
  else if (piLatest?.updateAvailable && piLatest.latest) {
    updateDetail = `有新版本 ${piLatest.latest}`;
  } else if (piLatest && piVersion && !piLatest.updateAvailable && piLatest.latest) {
    updateDetail = "已是最新";
  }
  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-ink">
      <a className="skip-link" href="#main-content">
        跳到正文
      </a>
      <header className="titlebar app-drag traffic-inline flex items-center gap-2 border-b border-line px-3">
        <Link
          to="/"
          className="pressable app-no-drag inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[13px] text-accent"
        >
          <ChevronLeft size={16} />
          返回对话
        </Link>
        <h1 className="flex-1 text-center text-[13px] font-semibold tracking-tight">设置</h1>
        <div className="app-no-drag flex w-[72px] justify-end">
          <UpdateBanner />
        </div>
      </header>
      <main id="main-content" className="flex-1 overflow-y-auto px-5 py-8">
        <div className="settings-shell space-y-7">
          <AppUpdateSection />

          <section>
            <h2 className="settings-label">外观</h2>
            <div className="settings-card">
              <div className="settings-row flex-col items-stretch gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[13px] text-ink">主题</p>
                  <div className="seg w-[168px]">
                    {(["light", "dark"] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        className={`pressable btn ${theme === value ? "seg-active" : "text-mute"}`}
                        aria-pressed={theme === value}
                        onClick={() => setTheme(value)}
                      >
                        {value === "dark" ? "深色" : "浅色"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section>
            <h2 className="settings-label">认证</h2>
            <div className="settings-card">
              <div className="settings-row flex-col items-stretch gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[13px] text-ink">方式</p>
                  <div className="seg w-[300px]">
                    {([
                      { id: "oauth" as const, label: "订阅登录" },
                      { id: "api_key" as const, label: "API Key" },
                      { id: "env" as const, label: "环境变量" },
                    ]).map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`pressable btn ${authMode === item.id ? "seg-active" : "text-mute"}`}
                        aria-pressed={authMode === item.id}
                        onClick={() => {
                          setAuthMode(item.id);
                          setSelectedProvider(pickDefaultProvider(catalog, item.id));
                          setFlash(null);
                        }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {authMode === "env" ? (
                <div className="settings-row flex-col items-stretch gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] text-ink">环境变量</p>
                      <p className="mt-0.5 text-[12px] text-mute">
                        仅检测进程环境中的密钥，不在此编辑；请在系统或 .env 中修改。
                      </p>
                    </div>
                    <button
                      type="button"
                      className="pressable btn btn-ghost shrink-0"
                      disabled={refreshBusy}
                      onClick={() => void refreshAuth()}
                    >
                      {refreshBusy ? "正在刷新…" : "刷新状态"}
                    </button>
                  </div>
                  {envEntries.length > 0 ? (
                    <ul className="m-0 list-none space-y-1 p-0" aria-label="检测到的环境变量密钥">
                      {envEntries.map((entry) => (
                        <li key={entry.id} className="flex items-center justify-between gap-2 text-[13px] text-ink">
                          <span className="min-w-0 truncate">
                            {entry.label}
                            <span className="ml-2 text-[12px] text-mute">{authEntryStatusLabel(entry)}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[13px] text-mute">未检测到环境变量中的密钥。</p>
                  )}
                  {flash?.id === "sync" ? (
                    <p className={`text-[12px] ${flash.tone === "err" ? "text-danger" : "text-success"}`}>
                      {flash.text}
                    </p>
                  ) : null}
                </div>
              ) : (
                <>
                  <div className="settings-row flex-col items-stretch gap-3">
                    <label className="block text-[13px] text-ink" htmlFor="settings-auth-provider">
                      服务商
                    </label>
                    <select
                      id="settings-auth-provider"
                      className="field w-full text-[13px] text-ink"
                      value={activeProviderId}
                      disabled={modeProviders.length === 0}
                      onChange={(event) => {
                        setSelectedProvider(event.target.value);
                        setFlash(null);
                      }}
                    >
                      {modeProviders.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {activeItem ? (
                    <div className="settings-row flex-col items-stretch gap-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[13px] text-ink">{activeItem.label}</p>
                          <p className="mt-0.5 text-[12px] text-mute">
                            {authEntryStatusLabel(activeEntry, {
                              oauth: authMode === "oauth",
                              apiKey: authMode === "api_key",
                            })}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap justify-end gap-2">
                          {authMode === "oauth" ? (
                            <>
                              {activeEntry?.kind !== "oauth" ? (
                                <button
                                  type="button"
                                  className="pressable btn btn-ghost"
                                  disabled={authBusy === activeItem.id}
                                  onClick={() => void loginProvider(activeItem.id)}
                                >
                                  {authBusy === activeItem.id ? "正在登录…" : oauthButtonLabel(activeEntry?.kind)}
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className="pressable btn btn-ghost"
                                disabled={refreshBusy}
                                onClick={() => void refreshAuth()}
                              >
                                {refreshBusy ? "正在刷新…" : "刷新状态"}
                              </button>
                            </>
                          ) : null}
                          {activeEntry && isRemovableAuthEntry(activeEntry) ? (
                            <button
                              type="button"
                              className="pressable btn btn-ghost"
                              disabled={authBusy === activeItem.id}
                              onClick={() => void logoutProvider(activeEntry?.id ?? activeItem.id)}
                            >
                              {authBusy === activeItem.id
                                ? "正在退出…"
                                : activeEntry.kind === "api_key"
                                  ? "移除密钥"
                                  : "退出"}
                            </button>
                          ) : null}
                        </div>
                      </div>

                      {authMode === "api_key" ? (
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <label className="sr-only" htmlFor={`settings-api-key-${activeItem.id}`}>
                            {activeItem.label} API Key
                          </label>
                          <input
                            id={`settings-api-key-${activeItem.id}`}
                            type="password"
                            autoComplete="off"
                            className="field min-w-0 flex-1 font-mono text-[13px] text-ink"
                            value={activeDraft}
                            placeholder={
                              activeEntry?.kind === "api_key" ? "粘贴新的密钥以替换" : (activeItem.hint ?? "API Key")
                            }
                            onChange={(event) => {
                              const value = event.target.value;
                              setKeyDrafts((current) => ({ ...current, [activeItem.id]: value }));
                              setFlash(null);
                            }}
                          />
                          <button
                            type="button"
                            className="pressable btn btn-primary shrink-0"
                            disabled={keyBusy === activeItem.id || activeDraft.trim().length < 8}
                            onClick={() => void saveApiKey(activeItem.id)}
                          >
                            {keyBusy === activeItem.id
                              ? "正在保存…"
                              : activeEntry?.kind === "api_key"
                                ? "更新密钥"
                                : "保存密钥"}
                          </button>
                        </div>
                      ) : null}

                      {activeFlash ? (
                        <p className={`text-[12px] ${activeFlash.tone === "err" ? "text-danger" : "text-success"}`}>
                          {activeFlash.text}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <div className="settings-row">
                      <p className="text-[13px] text-mute">
                        {authMode === "oauth" ? "当前没有可订阅登录的服务商。" : "当前没有支持 API Key 的服务商。"}
                      </p>
                    </div>
                  )}

                  {connectedEntries.length > 0 ? (
                    <div className="settings-row flex-col items-stretch gap-2">
                      <p className="text-[12px] text-mute">已连接</p>
                      <ul className="m-0 list-none space-y-1 p-0">
                        {connectedEntries.map((entry) => (
                          <li key={entry.id} className="flex items-center justify-between gap-2 text-[13px] text-ink">
                            <span className="min-w-0 truncate">
                              {entry.label}
                              <span className="ml-2 text-[12px] text-mute">{authEntryStatusLabel(entry)}</span>
                            </span>
                            {isRemovableAuthEntry(entry) ? (
                              <button
                                type="button"
                                className="pressable btn btn-ghost shrink-0"
                                disabled={authBusy === entry.id}
                                onClick={() => void logoutProvider(entry.id)}
                              >
                                {entry.kind === "api_key" ? "移除" : "退出"}
                              </button>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </section>

          <section>
            <h2 className="settings-label">引擎</h2>
            <div className="settings-card">
              <div className="settings-row items-center">
                <div className="min-w-0 pr-3">
                  <p className="text-[13px] text-ink">AI 引擎</p>
                  <p className="mt-0.5 text-[12px] text-mute">{engineDetail}</p>
                  {updateDetail ? (
                    <p className={`mt-1 text-[12px] ${piLatest?.error ? "text-danger" : "text-mute"}`}>{updateDetail}</p>
                  ) : null}
                  {installError ? <p className="mt-1 text-[12px] text-danger">{installError}</p> : null}
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                  {piVersion ? (
                    <button
                      type="button"
                      className="pressable btn btn-ghost"
                      disabled={checkBusy || installBusy}
                      onClick={() => void checkPiUpdate()}
                    >
                      {checkBusy ? "正在检查…" : "检查更新"}
                    </button>
                  ) : null}
                  {!piVersion && canInstallPi ? (
                    <button
                      type="button"
                      className="pressable btn btn-primary"
                      disabled={installBusy}
                      onClick={() => void installPi(false)}
                    >
                      {installBusy ? "正在安装…" : "安装 Pi"}
                    </button>
                  ) : null}
                  {piLatest?.updateAvailable && piLatest.canUpdate ? (
                    <button
                      type="button"
                      className="pressable btn btn-primary"
                      disabled={installBusy || checkBusy}
                      onClick={() => void installPi(true)}
                    >
                      {installBusy ? "正在更新…" : "更新 Pi"}
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="settings-row">
                <div>
                  <p className="text-[13px] text-ink">models.json</p>
                  <p className="mt-0.5 text-[12px] text-mute">
                    {models.present ? `已找到${models.count ? ` · ${models.count} 个模型` : ""}` : "未找到"}
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section>
            <h2 className="settings-label">项目</h2>
            <div className="settings-card">
              <div className="settings-row items-center">
                <div className="min-w-0 pr-3">
                  <p className="text-[13px] text-ink">信任当前项目</p>
                </div>
                <label className="mac-toggle">
                  <input
                    type="checkbox"
                    checked={trustProject}
                    disabled={trustBusy}
                    onChange={(event) => void toggleTrust(event.target.checked)}
                    aria-label="信任当前项目"
                  />
                  <span />
                </label>
              </div>
              <div className="settings-row">
                <div className="min-w-0">
                  <p className="text-[13px] text-ink">工作文件夹</p>
                  <p className="mt-0.5 break-all font-mono text-[11px] text-mute">
                    {workspaceRoot ?? allowedRoots[0] ?? "—"}
                  </p>
                </div>
              </div>
              <div className="settings-row">
                <div className="min-w-0">
                  <p className="text-[13px] text-ink">数据保存在</p>
                  <p className="mt-0.5 break-all font-mono text-[11px] text-mute">{dataDir}</p>
                </div>
              </div>
            </div>
          </section>

          <button
            type="button"
            className="pressable btn btn-ghost"
            onClick={() => setWizardOpen(true)}
          >
            打开设置向导
          </button>
        </div>
      </main>

      {wizardOpen ? (
        <SetupWizard
          onCancel={() => setWizardOpen(false)}
          onFinished={(status: SetupStatus) => {
            applySetup(status);
            setWizardOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
