import { useMemo, useState } from "react";
import { X } from "lucide-react";
import {
  packageSourceInstalled,
  type PiPackageCatalogItem,
  type PiResources,
} from "@qingzhou/protocol";
import { hotPackageItems } from "../../lib/package-center";

type Extension = PiResources["extensions"][number];
type Package = PiResources["packages"][number];

type Props = {
  items: PiPackageCatalogItem[];
  loading: boolean;
  error: string;
  extensions: Extension[];
  packages: Package[];
  busy: string | null;
  onClose: () => void;
  onInstall: (source: string) => void;
  onRetry: () => void;
};

function typeLabel(type: string): string {
  if (type === "extension") return "扩展";
  if (type === "skill") return "技能";
  if (type === "prompt") return "模板";
  if (type === "theme") return "主题";
  return type;
}

function PackageRows({
  items,
  extensions,
  packages,
  busy,
  onInstall,
}: {
  items: PiPackageCatalogItem[];
  extensions: Extension[];
  packages: Package[];
  busy: string | null;
  onInstall: (source: string) => void;
}) {
  return (
    <ul className="inset-list">
      {items.map((item) => {
        const installed = packageSourceInstalled(item.source, packages, extensions);
        return (
          <li key={item.source} className="inset-row inset-row-start">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-medium leading-snug text-ink">{item.name}</p>
              {item.summary ? <p className="text-[11px] text-mute">{item.summary}</p> : null}
              {item.types.length > 0 ? (
                <p className="mt-0.5 text-[11px] text-mute">{item.types.map(typeLabel).join(" · ")}</p>
              ) : null}
            </div>
            {installed ? (
              <span className="mt-0.5 shrink-0 text-[11px] text-mute">已安装</span>
            ) : (
              <button
                type="button"
                className="pressable mt-0.5 h-7 shrink-0 rounded-md bg-fill-strong px-2 text-[12px] text-ink"
                disabled={busy !== null}
                onClick={() => onInstall(item.source)}
                aria-label={`安装 ${item.name}`}
              >
                {busy === item.source ? "正在安装…" : "安装"}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function InspectorPackageCenter({
  items,
  loading,
  error,
  extensions,
  packages,
  busy,
  onClose,
  onInstall,
  onRetry,
}: Props) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const hot = useMemo(() => hotPackageItems(items), [items]);
  const filtered = useMemo(() => {
    if (!needle) return items;
    return items.filter((item) => {
      const haystack = `${item.name} ${item.summary} ${item.source} ${item.types.join(" ")}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [items, needle]);
  const hotSources = useMemo(() => new Set(hot.map((item) => item.source)), [hot]);
  const rest = useMemo(
    () => (needle ? filtered : items.filter((item) => !hotSources.has(item.source))),
    [filtered, hotSources, items, needle],
  );
  const showHot = !needle && hot.length > 0;
  const showRest = rest.length > 0;
  const empty = !loading && !error && filtered.length === 0;

  return (
    <div className="dialog-scrim z-[60]">
      <button type="button" className="absolute inset-0" aria-label="关闭" onClick={onClose} />
      <div
        className="dialog-panel dialog-panel-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="package-center-title"
      >
        <div className="dialog-head">
          <div className="dialog-head-text">
            <h2 id="package-center-title" className="dialog-title">
              插件中心
            </h2>
            <p className="dialog-copy">热门插件可直接安装，也可搜索 Pi 官方目录。</p>
          </div>
          <button type="button" className="pressable icon-btn -mr-1 -mt-1" aria-label="关闭" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="px-[18px] pt-3">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="搜索插件"
            placeholder="搜索插件"
            className="field h-8 w-full rounded-md px-2.5 text-[13px]"
          />
        </div>

        <div className="dialog-body space-y-4">
          {error ? (
            <div className="space-y-2">
              <p className="text-[12px] text-danger">{error}</p>
              <button
                type="button"
                className="pressable h-7 rounded-md bg-fill-strong px-2 text-[12px] text-ink"
                onClick={onRetry}
              >
                重试
              </button>
            </div>
          ) : null}
          {loading && items.length === 0 ? <p className="text-[12px] text-mute">正在加载插件中心…</p> : null}
          {empty ? (
            <p className="text-[12px] text-mute">{needle ? "没有匹配的插件。" : "插件中心暂时是空的。"}</p>
          ) : null}

          {showHot ? (
            <div className="space-y-2">
              <p className="text-[12px] font-medium text-mute">热门</p>
              <PackageRows
                items={hot}
                extensions={extensions}
                packages={packages}
                busy={busy}
                onInstall={onInstall}
              />
            </div>
          ) : null}

          {showRest ? (
            <div className="space-y-2">
              {showHot || needle ? (
                <p className="text-[12px] font-medium text-mute">{needle ? "搜索结果" : "全部"}</p>
              ) : null}
              <PackageRows
                items={rest}
                extensions={extensions}
                packages={packages}
                busy={busy}
                onInstall={onInstall}
              />
            </div>
          ) : null}
        </div>

        <div className="dialog-actions">
          <a
            className="pressable btn btn-ghost"
            href="https://pi.dev/packages"
            target="_blank"
            rel="noreferrer"
          >
            在 pi.dev 打开
          </a>
          <button type="button" className="pressable btn btn-primary" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
