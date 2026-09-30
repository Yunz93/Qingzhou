import { useEffect, useState } from "react";
import { useUpdateStore, RELEASES_PAGE_URL } from "../../stores/update-store";
import { getDesktop } from "../../desktop-bridge";
import { UpdateProgressPanel } from "./UpdateProgressPanel";

function formatTimestamp(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("zh-CN");
}

export function AppUpdateSection() {
  const [expanded, setExpanded] = useState(false);
  const current = useUpdateStore((state) => state.current);
  const latest = useUpdateStore((state) => state.latest);
  const body = useUpdateStore((state) => state.body);
  const publishedAt = useUpdateStore((state) => state.publishedAt);
  const url = useUpdateStore((state) => state.url);
  const updateAvailable = useUpdateStore((state) => state.updateAvailable);
  const canUpdate = useUpdateStore((state) => state.canUpdate);
  const error = useUpdateStore((state) => state.error);
  const notice = useUpdateStore((state) => state.notice);
  const busy = useUpdateStore((state) => state.busy);
  const installing = useUpdateStore((state) => state.installing);
  const autoCheckForUpdates = useUpdateStore((state) => state.autoCheckForUpdates);
  const skippedUpdateVersion = useUpdateStore((state) => state.skippedUpdateVersion);
  const lastUpdateCheckAt = useUpdateStore((state) => state.lastUpdateCheckAt);
  const progress = useUpdateStore((state) => state.progress);
  const check = useUpdateStore((state) => state.check);
  const install = useUpdateStore((state) => state.install);
  const setPreferences = useUpdateStore((state) => state.setPreferences);
  const skipCurrent = useUpdateStore((state) => state.skipCurrent);
  const resumeSkipped = useUpdateStore((state) => state.resumeSkipped);
  const hydrate = useUpdateStore((state) => state.hydrate);

  useEffect(() => {
    void hydrate().then(() => {
      void check();
    });
  }, [hydrate, check]);

  const desktop = getDesktop();
  const isMac = desktop?.platform === "darwin";
  const lastCheckedLabel = formatTimestamp(lastUpdateCheckAt);
  const publishedLabel = formatTimestamp(publishedAt);
  const notes = body.trim();
  const skipped = Boolean(latest && skippedUpdateVersion === latest);

  let status = "尚未检查";
  let statusTone: "mute" | "danger" | "success" = "mute";
  if (error) {
    status = error;
    statusTone = "danger";
  } else if (notice) {
    status = notice;
  } else if (updateAvailable && latest) {
    status = `发现新版本 ${latest}。`;
    statusTone = "success";
  } else if (latest) {
    status = "已是最新";
    statusTone = "success";
  }

  const installLabel =
    progress.phase === "downloading"
      ? "正在下载安装包…"
      : progress.phase === "preparing"
        ? latest
          ? `正在准备安装 ${latest}…`
          : "正在准备安装…"
        : installing
          ? "正在安装更新…"
          : "下载安装更新";

  return (
    <section id="settings-about">
      <h2 className="settings-label">关于与更新</h2>
      <div className="settings-card">
        <div className="settings-row items-center">
          <div className="min-w-0"><p className="text-[13px] text-ink">轻舟 <span className="ml-2 font-mono text-mute">{current || "—"}</span></p><p className={`mt-1 text-[12px] ${statusTone === "danger" ? "text-danger" : "text-mute"}`}>{busy ? "正在检查…" : status}</p></div>
          <button type="button" className="pressable btn btn-ghost shrink-0" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "收起详情" : "更新详情"}</button>
        </div>
        <div hidden={!expanded && !updateAvailable && !installing}>
        <p className="px-4 pt-3 text-[12px] text-mute">上次检查：{lastCheckedLabel || "尚未检查更新"}</p>

        <div className="settings-row items-center">
          <div className="min-w-0 pr-3">
            <p className="text-[13px] text-ink">启动后自动检查更新</p>
            <p className="mt-0.5 text-[12px] text-mute">有新版本时在顶栏提示，也可以忽略某个版本。</p>
          </div>
          <label className="mac-toggle">
            <input
              type="checkbox"
              checked={autoCheckForUpdates}
              disabled={installing}
              onChange={(event) => void setPreferences({ autoCheckForUpdates: event.target.checked })}
              aria-label="启动后自动检查更新"
            />
            <span />
          </label>
        </div>

        <div className="settings-row flex-col items-stretch gap-3">
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className="pressable btn btn-ghost"
              disabled={busy || installing}
              onClick={() => void check(true)}
            >
              {busy ? "正在检查…" : "立即检查"}
            </button>
            {updateAvailable && canUpdate ? (
              <button
                type="button"
                className="pressable btn btn-primary"
                disabled={installing || busy}
                onClick={() => void install()}
              >
                {installLabel}
              </button>
            ) : null}
            {updateAvailable && latest && !skipped ? (
              <button
                type="button"
                className="pressable btn btn-ghost"
                disabled={installing}
                onClick={() => void skipCurrent()}
              >
                忽略这个版本
              </button>
            ) : null}
            {skippedUpdateVersion ? (
              <button
                type="button"
                className="pressable btn btn-ghost"
                disabled={installing}
                onClick={() => void resumeSkipped()}
              >
                恢复已跳过的版本
              </button>
            ) : null}
          </div>

          {progress.phase === "idle" ? (
            <p className={`text-[12px] ${statusTone === "danger" ? "text-danger" : statusTone === "success" ? "text-success" : "text-mute"}`}>
              {status}
            </p>
          ) : null}

          <UpdateProgressPanel progress={progress} version={latest ?? undefined} />
        </div>

        {updateAvailable && latest ? (
          <div className="settings-row flex-col items-stretch gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[13px] font-medium text-ink">可更新到 {latest}</p>
              {skipped ? (
                <span className="rounded-full bg-[color-mix(in_oklch,var(--color-warn)_18%,transparent)] px-2 py-0.5 text-[11px] text-ink">
                  已忽略
                </span>
              ) : null}
            </div>
            <p className="text-[12px] text-mute">
              当前版本：<span className="font-mono">{current || "—"}</span>
              {publishedLabel ? <span className="ml-3">发布于 {publishedLabel}</span> : null}
            </p>
            {notes ? (
              <div>
                <p className="text-[11px] uppercase tracking-[0.16em] text-mute">发布说明</p>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-fill px-3 py-3 text-[12px] leading-6 text-ink">
                  {notes}
                </pre>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="settings-row flex-col items-stretch gap-2 text-[12px] leading-6 text-mute">
          <p>
            {isMac
              ? "应用内更新会下载已校验的安装包，替换当前应用后自动重启。不要双击 DMG。"
              : "应用内更新会下载已校验的安装包并安装，完成后自动打开。"}
          </p>
          <p>
            <a
              href={url || RELEASES_PAGE_URL}
              target="_blank"
              rel="noreferrer"
              className="text-accent underline decoration-transparent underline-offset-4 hover:decoration-current"
            >
              打开 GitHub Releases
            </a>
          </p>
        </div>
        </div>
      </div>
    </section>
  );
}
