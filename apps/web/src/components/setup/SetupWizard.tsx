import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { FolderPicker } from "./FolderPicker";
import { isDesktopApp } from "../../desktop-bridge";
import { authStatusLabel, findAuthEntry, mergeAuthCatalog, oauthButtonLabel, pickDefaultProvider, providersForMode, type AuthMode } from "../../lib/settings-auth";

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
  authEntries?: Array<{ id: string; label: string; kind: "api_key" | "oauth" | "other" }>;
  hasModelsFile?: boolean;
  modelCount?: number;
  trustProject?: boolean;
  devSelfWorkspace?: boolean;
};

type Props = {
  onFinished: (status: SetupStatus) => void;
  onCancel?: () => void;
};

type Step = "welcome" | "pi" | "auth" | "workspace";

async function fetchSetup(): Promise<SetupStatus> {
  const response = await fetch("/api/setup", { credentials: "same-origin" });
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

export function SetupWizard({ onFinished, onCancel }: Props) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [step, setStep] = useState<Step>("welcome");
  const [provider, setProvider] = useState("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installLog, setInstallLog] = useState("");
  const [authMode, setAuthMode] = useState<WizardAuthMode>("oauth");
  const existingLogins = status?.authEntries ?? [];
  const hasExistingLogin = existingLogins.length > 0 || Boolean(status?.authConfigured);
  const catalog = mergeAuthCatalog(
    status?.oauthProviders ?? [
      { id: "github", label: "GitHub Copilot" },
      { id: "openai", label: "OpenAI (ChatGPT)" },
    ],
    status?.providers ?? [],
  );
  const modeProviders = providersForMode(catalog, authMode);
  const activeProviderId = pickDefaultProvider(catalog, authMode, provider);
  const activeItem = modeProviders.find((item) => item.id === activeProviderId) ?? modeProviders[0] ?? null;
  const activeEntry = activeItem ? findAuthEntry(existingLogins, activeItem.id, authMode) : undefined;

  useEffect(() => {
    void fetchSetup()
      .then((next) => {
        setStatus(next);
        setWorkspace(next.workspaceRoot ?? next.allowedRoots[0] ?? next.homeDir);
        setProvider(next.providers[0]?.id ?? "anthropic");
        setStep("welcome");
      })
      .catch(() => setError("连不上轻舟。确认应用正在运行。"));
  }, []);

  useEffect(() => {
    if (!onCancel) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  async function saveApiKey() {
    const providerId = activeProviderId || provider;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/setup/api-key", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: providerId, apiKey }),
      });
      const json = (await response.json()) as SetupStatus & { error?: string };
      if (!response.ok) {
        setError(json.error ?? "密钥保存失败。");
        return;
      }
      setStatus(json);
      setApiKey("");
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
    if (step === "pi") setStep("welcome");
    else if (step === "auth") setStep(status?.piAvailable ? "welcome" : "pi");
    else if (step === "workspace") setStep("auth");
  }

  function goNextFromWelcome() {
    setError("");
    setStep(status?.piAvailable ? "auth" : "pi");
  }

  const titles: Record<Step, string> = {
    welcome: "先花半分钟准备一下",
    pi: status?.piBundled ? "AI 引擎出了点问题" : "需要安装 Pi",
    auth: "连接一个 AI",
    workspace: "选一个工作文件夹",
  };

  if (!status && !error) {
    return (
      <div className="dialog-scrim">
        <p className="text-sm text-mute">正在检查这台电脑…</p>
      </div>
    );
  }

  return (
    <div className="dialog-scrim">
      {onCancel ? (
        <button type="button" className="absolute inset-0" aria-label="关闭" onClick={onCancel} />
      ) : null}
      <div className="dialog-panel dialog-panel-lg" role="dialog" aria-modal="true" aria-labelledby="setup-title">
        <div className="dialog-head">
          <div className="dialog-head-text">
            <p className="dialog-kicker">{isDesktopApp() ? "欢迎使用轻舟" : "轻舟设置"}</p>
            <h1 id="setup-title" className="dialog-title">
              {titles[step]}
            </h1>
          </div>
          {onCancel ? (
            <button type="button" className="pressable icon-btn -mr-1 -mt-1" aria-label="关闭" onClick={onCancel}>
              <X size={16} />
            </button>
          ) : null}
        </div>

        <div className="dialog-body space-y-4">
          {step === "welcome" ? (
            <>
              <p className="text-sm leading-6 text-mute">
                {isDesktopApp()
                  ? "轻舟是这台电脑上的私人对话。接下来粘贴一把密钥，再选一个它可以工作的文件夹。"
                  : "轻舟让 AI 帮你处理这台电脑上的文件。我们会准备三件事：Pi、AI 密钥、工作文件夹。"}
              </p>
              <ol className="list-decimal space-y-1 pl-5 text-sm leading-6 text-mute">
                <li>使用已有的 Pi 登录，或粘贴一把 API Key</li>
                <li>选一个工作文件夹</li>
                <li>开始聊天 — 改文件前会先问你</li>
              </ol>
            </>
          ) : null}

          {step === "pi" ? (
            <>
              <p className="text-sm leading-6 text-mute">
                {status?.piBundled
                  ? "内置 AI 引擎没能启动。请退出后重新打开轻舟。如果还是不行，重新安装一次。"
                  : "Pi 是轻舟使用的 AI 引擎。点「安装 Pi」会在这台电脑上运行官方安装脚本。装好后也可以点「再检查」。"}
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

          {step === "auth" ? (
            <>
              <p className="text-sm leading-6 text-mute">
                先选方式，再选服务商。订阅登录适合 GitHub Copilot / OpenAI；也可以给支持的服务商粘贴 API Key。
              </p>
              <div className="seg w-full max-w-[240px]">
                {([
                  { id: "oauth" as const, label: "订阅登录" },
                  { id: "api_key" as const, label: "API Key" },
                ]).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`pressable btn ${authMode === item.id ? "seg-active" : "text-mute"}`}
                    aria-pressed={authMode === item.id}
                    onClick={() => {
                      setAuthMode(item.id);
                      const id = pickDefaultProvider(catalog, item.id);
                      setProvider(id);
                      setError("");
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
                  disabled={modeProviders.length === 0}
                  onChange={(event) => {
                    setProvider(event.target.value);
                    setError("");
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
                <div className="space-y-3 rounded-md border border-line bg-canvas px-3 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm text-ink">{activeItem.label}</p>
                      <p className="text-[12px] text-mute">
                        {authStatusLabel(activeEntry?.kind, {
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
                  </div>
                  {authMode === "oauth" ? (
                    <p className="text-[12px] leading-5 text-mute">
                      点「订阅登录」会打开系统浏览器完成授权。若没打开，可在终端运行
                      <code className="mx-1 font-mono text-ink">pi</code>
                      后输入 <code className="font-mono text-ink">/login</code>
                      ，再点刷新。
                    </p>
                  ) : (
                    <div>
                      <label className="block text-sm text-mute" htmlFor="api-key">
                        API Key
                      </label>
                      <input
                        id="api-key"
                        type="password"
                        autoComplete="off"
                        className="field mt-1 w-full font-mono text-sm text-ink"
                        value={apiKey}
                        placeholder={activeItem.hint ?? "API Key"}
                        onChange={(event) => setApiKey(event.target.value)}
                      />
                    </div>
                  )}
                </div>
              ) : null}
              {status?.hasModelsFile ? (
                <p className="text-sm text-mute">已找到 models.json{status.modelCount ? ` · ${status.modelCount} 个模型` : ""}</p>
              ) : null}
            </>
          ) : null}

          {step === "workspace" ? (
            <>
              <p className="text-sm leading-6 text-mute">
                选一个文件夹，轻舟只在这里面工作。之后可以在这个文件夹里打开具体项目。
              </p>
              <FolderPicker
                initialPath={workspace || status?.homeDir}
                selectedPath={workspace}
                onSelect={setWorkspace}
              />
            </>
          ) : null}

          {error ? <p className="text-sm text-danger">{error}</p> : null}
        </div>

        <div className="dialog-actions">
          {step === "welcome" ? (
            <button type="button" className="pressable btn btn-primary" onClick={goNextFromWelcome}>
              继续
            </button>
          ) : null}

          {step === "pi" ? (
            <>
              <button type="button" className="pressable btn btn-ghost" disabled={busy} onClick={goBack}>
                上一步
              </button>
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
                  {status?.piBundled ? null : (
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

          {step === "auth" ? (
            <>
              <button
                type="button"
                className="pressable btn btn-ghost"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void fetchSetup()
                    .then((next) => {
                      setStatus(next);
                    })
                    .catch(() => setError("刷新登录状态失败。"))
                    .finally(() => setBusy(false));
                }}
              >
                刷新
              </button>
              <button type="button" className="pressable btn btn-ghost" onClick={() => setStep("workspace")}>
                {hasExistingLogin ? "使用已有登录" : "暂时跳过"}
              </button>
              {authMode === "api_key" ? (
                <button
                  type="button"
                  className="pressable btn btn-primary"
                  disabled={busy || apiKey.trim().length < 8 || !activeProviderId}
                  onClick={() => {
                    setProvider(activeProviderId);
                    void saveApiKey();
                  }}
                >
                  保存密钥
                </button>
              ) : (
                <button
                  type="button"
                  className="pressable btn btn-primary"
                  disabled={busy || (!hasExistingLogin && activeEntry?.kind !== "oauth")}
                  onClick={() => setStep("workspace")}
                >
                  继续
                </button>
              )}
            </>
          ) : null}

          {step === "workspace" ? (
            <>
              <button type="button" className="pressable btn btn-ghost" onClick={goBack}>
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
