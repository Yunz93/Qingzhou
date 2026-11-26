import { geminiTargetSchema, type GeminiTarget } from "@qingzhou/protocol";
import { getDesktop } from "../desktop-bridge";
import { WorkspaceRail, WorkspaceToolbar } from "../components/workspace/WorkspaceChrome";
import { settingsReturnPath } from "../lib/settings-navigation";
import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { useAgentStore } from "../stores/agent-store";
import { SetupWizard, type SetupStatus, setupStorePayload } from "../components/setup/SetupWizard";
import { useTheme } from "../hooks/useTheme";
import { socketClient } from "../transport/socket-client";
import { canSaveProviderKey, authEntryStatusLabel, connectedAuthEntries, envAuthEntries, findAuthEntry, initialAuthChoice, isRemovableAuthEntry, logoutNotice, mergeAuthCatalog, oauthButtonLabel, pickDefaultProvider, providersForMode, type AuthMode } from "../lib/settings-auth";
import { ProviderKeyField } from "../components/setup/ProviderKeyField";
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
  const location = useLocation();
  const sectionId = location.hash.replace("#settings-", "");
  const section = ["auth", "engine", "project", "appearance", "about"].includes(sectionId) ? sectionId : "auth";
  const [returnPath] = useState(() => settingsReturnPath(location.state));
  const [setupLoading, setSetupLoading] = useState(true);
  const [setupError, setSetupError] = useState("");
  const [trustError, setTrustError] = useState("");
  const piVersion = useAgentStore((state) => state.piVersion);
  const piError = useAgentStore((state) => state.piError);
  const allowedRoots = useAgentStore((state) => state.allowedRoots);
  const dataDir = useAgentStore((state) => state.dataDir);
  const workspaceRoot = useAgentStore((state) => state.workspaceRoot);
  const authEntries = useAgentStore((state) => state.authEntries);
  const trustProject = useAgentStore((state) => state.trustProject);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [theme, setTheme] = useTheme();
  const [models, setModels] = useState<{ present: boolean; count: number; path: string }>({ present: false, count: 0, path: "" });
  const [trustBusy, setTrustBusy] = useState(false);
  const [installBusy, setInstallBusy] = useState(false);
  const [installError, setInstallError] = useState("");
  const [canInstallPi, setCanInstallPi] = useState(false);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [oauthProviders, setOauthProviders] = useState<Array<{ id: string; label: string }>>([
    { id: "github", label: "GitHub Copilot" },
    { id: "openai", label: "OpenAI (ChatGPT)" },
  ]);
  const [geminiTarget, setGeminiTarget] = useState<GeminiTarget>();
  const [confirmedTarget, setConfirmedTarget] = useState<string>();
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [keyBusy, setKeyBusy] = useState("");
  const [piLatest, setPiLatest] = useState<PiLatest | null>(null);
  const [checkBusy, setCheckBusy] = useState(false);
  const [authBusy, setAuthBusy] = useState("");
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [flash, setFlash] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [choice, setChoice] = useState<{ mode: AuthMode; provider: string } | null>(null);

  const applySetup = useCallback((setup: SetupStatus) => {
    setSetupError("");
    setGeminiTarget(setup.geminiTarget);
    setModels({ present: Boolean(setup.hasModelsFile), count: setup.modelCount ?? 0, path: setup.modelsFilePath ?? "" });
    setCanInstallPi(setup.canInstallPi !== false && !setup.piBundled);
    if (setup.providers?.length) {
      setProviders(setup.providers);
    }
    if (setup.oauthProviders?.length) {
      setOauthProviders(setup.oauthProviders);
    }
    const catalog = mergeAuthCatalog(setup.oauthProviders ?? [], setup.providers ?? []);
    setChoice((current) => current ?? initialAuthChoice(catalog, setup.authEntries ?? []));
    useAgentStore.getState().setSetupState(setupStorePayload(setup));
  }, []);

  const loadSetup = useCallback(async (signal?: AbortSignal) => {
    setSetupLoading(true);
    setSetupError("");
    try {
      const response = await fetch("/api/setup", { credentials: "same-origin", signal });
      if (!response.ok) throw new Error("读取设置失败，请重试。");
      const setup = await response.json() as SetupStatus;
      if (!signal?.aborted) applySetup(setup);
    } catch (error: unknown) {
      if (!signal?.aborted) setSetupError(error instanceof Error ? error.message : "无法连接服务，请重试。");
    } finally {
      if (!signal?.aborted) setSetupLoading(false);
    }
  }, [applySetup]);

  useEffect(() => {
    const controller = new AbortController();
    void loadSetup(controller.signal);
    void fetch("/api/setup/pi-latest", { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((json: PiLatest | null) => {
        if (json) setPiLatest(json);
      })
      .catch(() => { /* 检查失败可手动重试。 */ });
    return () => controller.abort();
  }, [loadSetup]);

  async function toggleTrust(next: boolean) {
    setTrustBusy(true);
    setTrustError("");
    try {
      const response = await fetch("/api/setup/trust", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trust: next }),
      });
      const setup = (await response.json()) as SetupStatus & { error?: string };
      if (!response.ok) throw new Error(setup.error ?? "保存信任设置失败，请重试。");
      applySetup(setup);
    } catch (error: unknown) {
      setTrustError(error instanceof Error ? error.message : "保存失败，请检查连接后重试。");
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
      void socketClient.send("snapshot.request").catch(() => undefined);
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

  function updateTarget(target: GeminiTarget) {
    setGeminiTarget(target);
    setConfirmedTarget(undefined);
  }

  async function saveApiKey(providerId: string) {
    const apiKey = keyDrafts[providerId]?.trim() ?? "";
    if (keyBusy || apiKey.length < 8 || !canSaveProviderKey(providerId, geminiTarget, confirmedTarget)) return;
    setChoice({ mode: "api_key", provider: providerId });
    setKeyBusy(providerId);
    setFlash(null);
    try {
      const response = await fetch("/api/setup/api-key", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: providerId, apiKey, confirmedGeminiTarget: providerId === "google" ? confirmedTarget : undefined }),
      });
      const json = (await response.json()) as SetupStatus & { error?: string };
      if (!response.ok) {
        const current = geminiTargetSchema.safeParse(json.geminiTarget);
        if (current.success) updateTarget(current.data);
        setFlash({ tone: "err", text: json.error ?? "密钥保存失败。" });
        return;
      }
      applySetup(json);
      setConfirmedTarget(undefined);
      setKeyDrafts((current) => ({ ...current, [providerId]: "" }));
      const label = providers.find((item) => item.id === providerId)?.label ?? providerId;
      setFlash({ tone: "ok", text: providerId === "google" ? "已保存密钥。可在对话的「模型和思考」中选择 Gemini。" : `已保存 ${label} 的密钥。` });
      void socketClient.send("snapshot.request").catch(() => undefined);
    } catch {
      setFlash({ tone: "err", text: "密钥保存失败。" });
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
        setFlash({ tone: "err", text: "刷新登录状态失败。" });
        return;
      }
      applySetup(setup);
      void socketClient.send("snapshot.request").catch(() => undefined);
      setFlash({ tone: "ok", text: "已刷新登录状态。" });
    } catch {
      setFlash({ tone: "err", text: "刷新登录状态失败。" });
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
        setFlash({ tone: "err", text: json.error ?? "退出失败。" });
        return;
      }
      applySetup(json);
      void socketClient.send("snapshot.request").catch(() => undefined);
      setFlash({ tone: "ok", text: logoutNotice(kind) });
    } catch {
      setFlash({ tone: "err", text: "退出失败。" });
    } finally {
      setAuthBusy("");
    }
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
        setFlash({ tone: "err", text: json.error ?? "无法打开登录。" });
        return;
      }
      applySetup(json);
      void socketClient.send("snapshot.request").catch(() => undefined);
      if (json.loginCompleted) {
        setFlash({ tone: "ok", text: json.hint ?? "订阅登录已完成。" });
      } else {
        setFlash({
          tone: json.loginStarted ? "ok" : "err",
          text: json.hint ?? "完成订阅登录后，点下面的刷新同步状态。",
        });
      }
    } catch {
      setFlash({ tone: "err", text: "无法打开登录。" });
    } finally {
      setAuthBusy("");
    }
  }

  const catalog = mergeAuthCatalog(oauthProviders, providers, authEntries);
  const { mode: authMode, provider } = choice ?? initialAuthChoice(catalog, authEntries);
  const modeProviders = providersForMode(catalog, authMode);
  const activeProviderId = pickDefaultProvider(catalog, authMode, provider);
  const activeItem = modeProviders.find((item) => item.id === activeProviderId) ?? modeProviders[0] ?? null;
  const activeEntry =
    activeItem && authMode !== "env" ? findAuthEntry(authEntries, activeItem.id, authMode) : undefined;
  const activeDraft = activeItem ? (keyDrafts[activeItem.id] ?? "") : "";
  const envEntries = envAuthEntries(authEntries);
  const connectedEntries = connectedAuthEntries(authEntries, authMode).filter((entry) => entry.id !== activeEntry?.id);
  const engineDetail = piVersion ? `已就绪（Pi ${piVersion}）` : (piError ?? "还没准备好");
  let updateDetail: string | null = null;
  if (piLatest?.error) updateDetail = piLatest.error;
  else if (piLatest?.updateAvailable && piLatest.latest) {
    updateDetail = `有新版本 ${piLatest.latest}`;
  } else if (piLatest && piVersion && !piLatest.updateAvailable && piLatest.latest) {
    updateDetail = "已是最新";
  }
  return (
    <div className="settings-page flex h-dvh overflow-hidden bg-canvas text-ink">
      <a className="skip-link" href="#main-content">
        跳到正文
      </a>
      <div className="hidden md:flex"><WorkspaceRail section="settings" /></div>
      <div className="flex min-w-0 flex-1 flex-col">
      <WorkspaceToolbar>
        <Link
          to={returnPath}
          className="pressable inline-flex min-h-10 items-center gap-1 rounded-md px-2 text-sm text-accent"
        >
          <ChevronLeft size={16} />
          {returnPath.startsWith("/board") ? "返回工作" : "返回对话"}
        </Link>
        <h1 className="flex-1 text-sm font-semibold">设置</h1>
        <UpdateBanner />
      </WorkspaceToolbar>
      <main id="main-content" className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
        <div className="mx-auto flex max-w-[960px] flex-col gap-6 xl:flex-row">
          <nav className="flex shrink-0 gap-1 overflow-x-auto xl:w-40 xl:flex-col xl:border-r xl:border-divider xl:pr-4" aria-label="设置分组">{[["auth", "账号与认证"], ["engine", "模型与引擎"], ["project", "项目"], ["appearance", "外观"], ["about", "关于与更新"]].map(([id, label]) => <Link key={id} className={`flex min-h-10 shrink-0 items-center rounded-md px-2.5 text-sm ${section === id ? "bg-accent-soft font-medium text-accent" : "hover:bg-fill"}`} to={`#settings-${id}`} state={{ from: returnPath }} replace aria-current={section === id ? "page" : undefined}>{label}</Link>)}</nav>
          <div className="w-full min-w-0 max-w-[720px] space-y-5">
          {setupLoading ? <p role="status" className="settings-load-note">正在读取设置…</p> : setupError ? <div className="settings-load-note text-danger" role="alert"><span>{setupError}</span><button type="button" className="pressable text-accent" onClick={() => void loadSetup()}>重试</button></div> : null}


          <section id="settings-auth" hidden={section !== "auth"}>
            <h2 className="settings-label">账号与认证</h2>
            <div className="settings-card">
              <div className="settings-row flex-col items-stretch gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[13px] text-ink">连接方式</p>
                  <div className="seg w-[300px] max-w-full" role="group" aria-label="连接方式">
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
                        disabled={Boolean(keyBusy || authBusy)}
                        onClick={() => {
                          const mode = item.id;
                          if (authMode === mode) return;
                          const connected = mode === "env" ? undefined : providersForMode(catalog, mode)
                            .find((provider) => findAuthEntry(authEntries, provider.id, mode));
                          setConfirmedTarget(undefined);
                          setChoice({ mode, provider: pickDefaultProvider(catalog, mode, connected?.id ?? (mode === "api_key" ? "google" : undefined)) });
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
                        修改系统环境或 .env 后需重启应用；刷新只检测当前进程。
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
                    <p className="text-[13px] text-mute">{setupLoading ? "正在检测环境变量…" : setupError ? "暂时无法检测环境变量。" : "未检测到环境变量中的密钥。"}</p>
                  )}
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
                      disabled={Boolean(keyBusy || authBusy) || modeProviders.length === 0}
                      onChange={(event) => {
                        setConfirmedTarget(undefined);
                        setChoice({ mode: authMode, provider: event.target.value });
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
                          <p className="text-[13px] text-ink">连接状态</p>
                          <p className="mt-0.5 text-[12px] text-mute">
                            {setupLoading ? "正在读取…" : setupError ? "暂时无法读取认证状态" : authEntryStatusLabel(activeEntry, {
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
                                  disabled={authBusy === activeItem.id || authBusy === activeEntry?.id}
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
                              disabled={Boolean(authBusy || keyBusy)}
                              onClick={() => void logoutProvider(activeEntry?.id ?? activeItem.id)}
                            >
                              {(authBusy === activeItem.id || authBusy === activeEntry?.id)
                                ? "正在退出…"
                                : activeEntry.kind === "api_key"
                                  ? "移除密钥"
                                  : "退出"}
                            </button>
                          ) : null}
                        </div>
                      </div>

                      {authMode === "api_key" ? (
                        <form className="grid w-full gap-3" onSubmit={(event) => { event.preventDefault(); void saveApiKey(activeItem.id); }}>
                          <ProviderKeyField key={activeItem.id} provider={activeItem} entry={activeEntry} value={activeDraft}
                            target={geminiTarget} confirmedTarget={confirmedTarget} onConfirm={setConfirmedTarget} onTargetChange={updateTarget}
                            disabled={Boolean(keyBusy || authBusy)} onChange={(value) => {
                              setConfirmedTarget(undefined);
                              setKeyDrafts((current) => ({ ...current, [activeItem.id]: value }));
                              setFlash(null);
                            }} />
                          <button type="submit" className="pressable btn btn-primary justify-self-end"
                            disabled={Boolean(keyBusy || authBusy) || activeDraft.trim().length < 8 || !canSaveProviderKey(activeItem.id, geminiTarget, confirmedTarget)}>
                            {keyBusy === activeItem.id ? "正在保存…" : activeEntry?.kind === "api_key" && isRemovableAuthEntry(activeEntry) ? "更新密钥" : "保存密钥"}
                          </button>
                        </form>
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
                      <p className="text-[12px] text-mute">其他已连接账号</p>
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
                                disabled={Boolean(authBusy || keyBusy)}
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
              {flash ? <p role={flash.tone === "err" ? "alert" : "status"} className={`pb-2 text-[13px] ${flash.tone === "err" ? "text-danger" : "text-success"}`}>{flash.text}</p> : null}
            </div>
          </section>

          <section id="settings-engine" hidden={section !== "engine"}>
            <h2 className="settings-label">模型与引擎</h2>
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
                    {setupLoading ? "正在读取…" : setupError ? "暂时无法读取" : models.present ? `已配置 · ${models.count} 个自定义模型` : "可选的自定义模型配置，内置模型无需此文件。"}
                  </p>
                  {models.path ? <p className="mt-1 break-all font-mono text-[11px] text-mute">{models.path}</p> : null}
                  {models.path && getDesktop()?.openPath ? <button type="button" className="pressable mt-2 text-[12px] text-accent" onClick={() => {
                    const target = models.present ? models.path : models.path.replace(/[\\/][^\\/]+$/, "");
                    void getDesktop()?.openPath?.(target).then((error) => { if (error) setSetupError(error); }).catch(() => setSetupError("无法打开配置位置。"));
                  }}>{models.present ? "打开配置文件" : "打开配置目录"}</button> : null}
                </div>
              </div>
            </div>
          </section>

          <section id="settings-project" hidden={section !== "project"}>
            <h2 className="settings-label">项目</h2>
            <div className="settings-card">
              <div className="settings-row items-center">
                <div className="min-w-0 pr-3">
                  <p className="text-[13px] text-ink">信任默认工作区</p>
                  <p className="mt-0.5 text-[12px] text-mute">仅信任下方的默认工作文件夹。</p>
                </div>
                <label className="mac-toggle">
                  <input
                    type="checkbox"
                    checked={trustProject}
                    disabled={trustBusy || setupLoading || Boolean(setupError)}
                    onChange={(event) => void toggleTrust(event.target.checked)}
                    aria-label="信任默认工作区"
                  />
                  <span />
                </label>
              </div>
              {trustError ? <p role="alert" className="px-4 py-2 text-[12px] text-danger">{trustError}</p> : null}
              <div className="settings-row">
                <div className="min-w-0">
                  <p className="text-[13px] text-ink">默认工作文件夹</p>
                  <p className="mt-0.5 text-[12px] text-mute">
                    新对话默认使用此目录，可在会话中切换。
                  </p>
                  <p className="mt-1 break-all font-mono text-[11px] text-mute">
                    {workspaceRoot ?? allowedRoots[0] ?? "—"}
                  </p>
                </div>
              </div>
              <div className="settings-row">
                <div className="min-w-0">
                  <p className="text-[13px] text-ink">应用数据目录</p>
                  <p className="mt-0.5 text-[12px] text-mute">会话和应用配置保存在此。</p>
                  <p className="mt-1 break-all font-mono text-[11px] text-mute">{dataDir}</p>
                </div>
              </div>
            </div>
          </section>

          <section id="settings-appearance" hidden={section !== "appearance"}>
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

          <div hidden={section !== "about"}><AppUpdateSection /></div>

          <button
            type="button"
            className="pressable btn btn-ghost"
            hidden={section !== "auth"}
            onClick={() => setWizardOpen(true)}
          >
            打开设置向导
          </button>
          </div>
        </div>
      </main>
      </div>

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
