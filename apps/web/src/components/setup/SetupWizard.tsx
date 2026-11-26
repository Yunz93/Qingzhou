import { useDialogLayer } from "../../hooks/useDialogLayer";
import { useEffect, useRef, useState } from "react";
import { geminiTargetSchema, type GeminiTarget } from "@qingzhou/protocol";
import { X } from "lucide-react";
import { FolderPicker } from "./FolderPicker";
import { ProviderKeyField } from "./ProviderKeyField";
import { canSaveProviderKey, authEntryStatusLabel, findAuthEntry, initialAuthChoice, mergeAuthCatalog, oauthButtonLabel, pickDefaultProvider, providersForMode, type AuthEntryLike, type AuthMode } from "../../lib/settings-auth";

type WizardAuthMode = Exclude<AuthMode, "env">;

export type SetupStatus = {
  ready: boolean;
  piAvailable: boolean;
  piVersion: string | null;
  piError: string | null;
  authConfigured: boolean;
  configuredProviders: string[];
  providers: Array<{ id: string; label: string; hint: string }>;
  oauthProviders?: Array<{ id: string; label: string }>;
  workspaceRoot: string | null;
  setupCompleted: boolean;
  allowedRoots: string[];
  homeDir: string;
  dataDir: string;
  needsSetup: boolean;
  piBundled?: boolean;
  canInstallPi?: boolean;
  authEntries?: AuthEntryLike[];
  geminiTarget?: GeminiTarget;
  hasModelsFile?: boolean;
  modelsFilePath?: string;
  modelCount?: number;
  trustProject?: boolean;
  devSelfWorkspace?: boolean;
};

type Props = {
  onFinished: (status: SetupStatus) => void;
  onCancel?: () => void;
  initialStatus?: SetupStatus;
};

type Step = "pi" | "auth" | "workspace";

async function fetchSetup(signal?: AbortSignal): Promise<SetupStatus> {
  const response = await fetch("/api/setup", { credentials: "same-origin", signal });
  if (!response.ok) throw new Error("无法加载设置状态");
  return (await response.json()) as SetupStatus;
}

export function setupStorePayload(status: SetupStatus) {
  return {
    needsSetup: status.needsSetup,
    authConfigured: status.authConfigured,
    configuredProviders: status.configuredProviders,
    homeDir: status.homeDir,
    workspaceRoot: status.workspaceRoot,
    allowedRoots: status.allowedRoots,
    authEntries: status.authEntries,
    trustProject: status.trustProject,
    piVersion: status.piVersion,
    piAvailable: status.piAvailable,
    piError: status.piError,
    devSelfWorkspace: status.devSelfWorkspace,
  };
}

export function SetupWizard({ onFinished, onCancel, initialStatus }: Props) {
  const [status, setStatus] = useState<SetupStatus | null>(initialStatus ?? null);
  const [step, setStep] = useState<Step>(initialStatus?.piAvailable === false ? "pi" : "auth");
  const [choice, setChoice] = useState<{ mode: WizardAuthMode; provider: string } | null>(null);
  const [confirmedTarget, setConfirmedTarget] = useState<string>();
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [workspace, setWorkspace] = useState(initialStatus?.workspaceRoot ?? initialStatus?.allowedRoots[0] ?? initialStatus?.homeDir ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installLog, setInstallLog] = useState("");
  const [attempt, setAttempt] = useState(0);
  const existingLogins = status?.authEntries ?? [];
  const hasExistingLogin = existingLogins.length > 0 || Boolean(status?.authConfigured);
  const catalog = mergeAuthCatalog(
    status?.oauthProviders ?? [
      { id: "github", label: "GitHub Copilot" },
      { id: "openai", label: "OpenAI (ChatGPT)" },
    ],
    status?.providers ?? [],
  );
  const { mode: authMode, provider } = choice ?? initialAuthChoice(catalog, existingLogins);
  const modeProviders = providersForMode(catalog, authMode);
  const activeProviderId = pickDefaultProvider(catalog, authMode, provider);
  const apiKey = keyDrafts[activeProviderId] ?? "";
  const canSaveKey = canSaveProviderKey(activeProviderId, status?.geminiTarget, confirmedTarget);
  const activeItem = modeProviders.find((item) => item.id === activeProviderId);
  const activeEntry = activeItem ? findAuthEntry(existingLogins, activeItem.id, authMode) : undefined;
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useDialogLayer(panelRef, () => { if (!busy) onCancel?.(); });

  useEffect(() => {
    if (initialStatus) return;
    const controller = new AbortController();
    void fetchSetup(controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setStatus(next);
        setWorkspace(next.workspaceRoot ?? next.allowedRoots[0] ?? next.homeDir);
        setStep(next.piAvailable ? "auth" : "pi");
      })
      .catch(() => { if (!controller.signal.aborted) setError("无法读取设置，请检查墨问服务后重试。"); });
    return () => controller.abort();
  }, [initialStatus, attempt]);

  const loaded = status !== null;
  useEffect(() => { if (loaded) titleRef.current?.focus(); }, [step, loaded]);

  function chooseProvider(mode: WizardAuthMode, next: string) {
    if (authMode === mode && activeProviderId === next) return;
    setChoice({ mode, provider: next });
    setConfirmedTarget(undefined);
    setError("");
  }

  function updateTarget(target: GeminiTarget) {
    setStatus((current) => current && { ...current, geminiTarget: target });
    setConfirmedTarget(undefined);
  }

  async function saveApiKey() {
    if (!activeProviderId || busy || apiKey.trim().length < 8 || !canSaveKey) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/setup/api-key", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: activeProviderId, apiKey: apiKey.trim(), confirmedGeminiTarget: activeProviderId === "google" ? confirmedTarget : undefined }),
      });
      const json = (await response.json()) as SetupStatus & { error?: string };
      if (!response.ok) {
        const current = geminiTargetSchema.safeParse(json.geminiTarget);
        if (current.success) updateTarget(current.data);
        setError(json.error ?? "密钥保存失败。");
        return;
      }
      setChoice({ mode: authMode, provider: activeProviderId });
      setStatus(json);
      setConfirmedTarget(undefined);
      setKeyDrafts((drafts) => ({ ...drafts, [activeProviderId]: "" }));
      setStep("workspace");
    } catch {
      setError("密钥保存失败。");
    } finally {
      setBusy(false);
    }
  }

  async function loginProvider(providerId: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/setup/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: providerId }),
      });
      const json = (await response.json()) as SetupStatus & {
        error?: string;
        hint?: string;
        loginCompleted?: boolean;
      };
      if (!response.ok) {
        setError(json.error ?? "无法打开登录。");
        return;
      }
      setStatus(json);
      if (!json.loginCompleted && json.hint) setError(json.hint);
    } catch {
      setError("无法打开登录。");
    } finally {
      setBusy(false);
    }
  }

  async function saveWorkspace() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/setup/workspace", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: workspace }),
      });
      const json = (await response.json()) as SetupStatus & { error?: string };
      if (!response.ok) {
        setError(json.error ?? "文件夹保存失败。");
        return;
      }
      onFinished(json);
    } catch {
      setError("文件夹保存失败。");
    } finally {
      setBusy(false);
    }
  }

  async function recheckPi() {
    setBusy(true);
    setError("");
    try {
      const next = await fetchSetup();
      setStatus(next);
      if (next.piAvailable) setStep("auth");
    } catch {
      setError("检查 Pi 失败。");
    } finally {
      setBusy(false);
    }
  }

  async function installPi() {
    setBusy(true);
    setInstalling(true);
    setError("");
    setInstallLog("");
    try {
      const response = await fetch("/api/setup/install-pi", {
        method: "POST",
        credentials: "same-origin",
      });
      const json = (await response.json()) as SetupStatus & { error?: string; log?: string };
      if (json.log) setInstallLog(json.log);
      if (!response.ok) {
        setError(json.error ?? "安装 Pi 失败。");
        if (json.piAvailable) {
          setStatus(json);
          setStep("auth");
        }
        return;
      }
      setStatus(json);
      if (json.piAvailable) setStep("auth");
    } catch {
      setError("安装 Pi 失败。");
    } finally {
      setBusy(false);
      setInstalling(false);
    }
  }

  function goBack() {
    setError("");
    if (step === "workspace") setStep("auth");
  }

  const titles: Record<Step, string> = {
    pi: status?.piBundled ? "检查 AI 引擎" : "安装 AI 引擎",
    auth: "连接模型服务",
    workspace: "选一个工作文件夹",
  };

  return (
    <div className="dialog-scrim">
      {onCancel ? <button type="button" className="absolute inset-0" tabIndex={-1} aria-hidden="true" disabled={busy} onClick={onCancel} /> : null}
      <div ref={panelRef} tabIndex={-1} className="dialog-panel dialog-panel-solid dialog-panel-lg connection-setup" role="dialog" aria-modal="true" aria-labelledby="setup-title">
        <div className="dialog-head">
          <img className="connection-setup-brand" src="/mowen.svg" alt="墨问" width={36} height={36} />
          <div className="dialog-head-text">
            <p className="dialog-kicker">{!status || step === "pi" ? "墨问设置" : step === "auth" ? "墨问设置 · 1 / 2" : "墨问设置 · 2 / 2"}</p>
            <h1 id="setup-title" ref={titleRef} tabIndex={-1} className="dialog-title">{status ? titles[step] : "读取设置"}</h1>
          </div>
          {onCancel ? (
            <button type="button" className="pressable icon-btn" aria-label="关闭" disabled={busy} onClick={onCancel}>
              <X size={16} />
            </button>
          ) : null}
        </div>

        <div className="dialog-body space-y-4">
          {!status && !error ? <p role="status" className="text-sm text-mute">正在检查这台电脑…</p> : null}
          {status && step === "pi" ? (
            <>
              <p className="text-sm leading-6 text-mute">
                {status?.piBundled
                  ? "内置 AI 引擎没能启动。请退出后重新打开墨问。如果还是不行，重新安装一次。"
                  : "Pi 是墨问使用的 AI 引擎。点「安装 Pi」会在这台电脑上运行官方安装脚本。装好后也可以点「再检查」。"}
              </p>
              <div className="rounded-md border border-line bg-canvas px-3 py-2 text-[12px] text-mute">
                {status?.piAvailable
                  ? `已找到 Pi ${status.piVersion}`
                  : (status?.piError ?? "还没有安装 Pi，或找不到可执行文件。")}
              </div>
              {installLog ? (
                <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-canvas px-3 py-2 font-mono text-[11px] leading-5 text-mute">
                  {installLog}
                </pre>
              ) : null}
            </>
          ) : null}

          {status && step === "auth" ? (
            <>
              <div className="seg w-full max-w-[280px]" role="group" aria-label="连接方式">
                {([
                  { id: "oauth" as const, label: "订阅登录" },
                  { id: "api_key" as const, label: "API Key" },
                ]).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`pressable btn ${authMode === item.id ? "seg-active" : "text-mute"}`}
                    disabled={busy}
                    aria-pressed={authMode === item.id}
                    onClick={() => {
                      if (item.id === authMode) return;
                      chooseProvider(item.id, pickDefaultProvider(catalog, item.id, item.id === "api_key" ? "google" : undefined));
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div>
                <label className="block text-sm text-mute" htmlFor="provider">
                  服务商
                </label>
                <select
                  id="provider"
                  className="field mt-1 w-full text-sm text-ink"
                  value={activeProviderId}
                  disabled={busy || modeProviders.length === 0}
                  onChange={(event) => {
                    chooseProvider(authMode, event.target.value);
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
                <div className="space-y-2">
                  {authMode === "oauth" || activeEntry ? <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[12px] text-mute">
                        {authEntryStatusLabel(activeEntry, {
                          oauth: authMode === "oauth",
                          apiKey: authMode === "api_key",
                        })}
                      </p>
                    </div>
                    {authMode === "oauth" && activeEntry?.kind !== "oauth" ? (
                      <button
                        type="button"
                        className="pressable btn btn-ghost shrink-0"
                        disabled={busy}
                        onClick={() => void loginProvider(activeItem.id)}
                      >
                        {oauthButtonLabel(activeEntry?.kind)}
                      </button>
                    ) : null}
                  </div> : null}
                  {authMode === "oauth" ? (
                    <details className="text-[12px] leading-5 text-mute"><summary>无法打开登录页？</summary><p className="mt-2">在终端运行 <code className="font-mono text-ink">pi</code>，输入 <code className="font-mono text-ink">/login</code> 完成授权，再刷新状态。</p></details>
                  ) : (
                    <form id="setup-api-key" onSubmit={(event) => { event.preventDefault(); void saveApiKey(); }}>
                      <ProviderKeyField key={activeItem.id} provider={activeItem} entry={activeEntry} value={apiKey}
                        target={status.geminiTarget} confirmedTarget={confirmedTarget} onConfirm={setConfirmedTarget} onTargetChange={updateTarget}
                        disabled={busy} onChange={(value) => {
                          setConfirmedTarget(undefined);
                          setKeyDrafts((drafts) => ({ ...drafts, [activeProviderId]: value }));
                          setError("");
                        }} />
                    </form>
                  )}
                </div>
              ) : null}
              {status?.hasModelsFile && !activeEntry ? (
                <p className="text-sm text-mute">已配置 models.json · {status.modelCount ?? 0} 个自定义模型</p>
              ) : null}
            </>
          ) : null}

          {status && step === "workspace" ? (
            <>
              <p className="text-sm leading-6 text-mute">
                选择默认工作文件夹，之后可为会话选择其他目录。
              </p>
              <FolderPicker
                initialPath={workspace || status?.homeDir}
                selectedPath={workspace}
                onSelect={setWorkspace}
              />
            </>
          ) : null}

          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        </div>

        <div className="dialog-actions">
          {!status && error ? <button type="button" className="pressable btn btn-primary" onClick={() => { setError(""); setAttempt((count) => count + 1); }}>重试</button> : null}
          {status && step === "pi" ? (
            <>
              {status?.piAvailable ? (
                <button
                  type="button"
                  className="pressable btn btn-primary"
                  onClick={() => setStep("auth")}
                >
                  继续
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className={`pressable btn ${status?.canInstallPi === false || status?.piBundled ? "btn-primary" : "btn-ghost"}`}
                    disabled={busy}
                    onClick={() => void recheckPi()}
                  >
                    再检查
                  </button>
                  {status?.piBundled || status.canInstallPi === false ? null : (
                    <button
                      type="button"
                      className="pressable btn btn-primary"
                      disabled={busy}
                      onClick={() => void installPi()}
                    >
                      {installing ? "正在安装…" : "安装 Pi"}
                    </button>
                  )}
                </>
              )}
            </>
          ) : null}

          {status && step === "auth" ? (
            <>
              {authMode === "oauth" ? <button type="button" className="pressable btn btn-ghost" disabled={busy} onClick={() => {
                setBusy(true);
                setError("");
                void fetchSetup().then(setStatus).catch(() => setError("刷新登录状态失败。")).finally(() => setBusy(false));
              }}>刷新</button> : null}
              <button type="button" className={`pressable btn ${hasExistingLogin && !apiKey.trim() ? "btn-primary" : "btn-ghost"}`}
                disabled={busy} onClick={() => { setError(""); setStep("workspace"); }}>
                {hasExistingLogin ? "使用现有连接" : "暂时跳过"}
              </button>
              {authMode === "api_key" && (!hasExistingLogin || apiKey.trim()) ? (
                <button type="submit" form="setup-api-key" className="pressable btn btn-primary"
                  disabled={busy || apiKey.trim().length < 8 || !activeItem || !canSaveKey}>
                  {busy ? "正在保存…" : "保存并继续"}
                </button>
              ) : null}
            </>
          ) : null}

          {status && step === "workspace" ? (
            <>
              <button type="button" className="pressable btn btn-ghost" disabled={busy} onClick={goBack}>
                上一步
              </button>
              <button
                type="button"
                className="pressable btn btn-primary"
                disabled={busy || !workspace}
                onClick={() => void saveWorkspace()}
              >
                完成设置
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
