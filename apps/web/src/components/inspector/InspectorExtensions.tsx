import { packageSourceNames, type PiResources } from "@qingzhou/protocol";

type Extension = PiResources["extensions"][number];
type Package = PiResources["packages"][number];

type Props = {
  extensions: Extension[];
  packages: Package[];
  trustProject: boolean;
  onToggle: (path: string, enabled: boolean) => void;
  error?: string;
  onOpenCatalog?: () => void;
};

function matchingExtension(source: string, extensions: Extension[]): Extension | undefined {
  const names = new Set(packageSourceNames(source).map((name) => name.toLowerCase()));
  if (names.size === 0) return undefined;
  return extensions.find((item) => names.has(item.name.toLowerCase()));
}

export function InspectorExtensions({
  extensions,
  packages,
  trustProject,
  onToggle,
  error = "",
  onOpenCatalog,
}: Props) {
  const extraPackages = packages.filter((item) => !matchingExtension(item.source, extensions));

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <p className={`panel-count min-w-0 flex-1 ${extensions.length === 0 && packages.length === 0 ? "panel-count-empty" : ""}`}>
          {extensions.length === 0 && packages.length === 0
            ? trustProject
              ? "还没有本地插件。打开插件中心安装。"
              : "未信任项目，只显示用户插件。"
            : `${extensions.length} 个已安装`}
        </p>
        {onOpenCatalog ? (
          <button
            type="button"
            className="pressable h-7 shrink-0 rounded-md bg-fill-strong px-2 text-[12px] text-ink"
            onClick={() => onOpenCatalog()}
          >
            插件中心
          </button>
        ) : null}
      </div>
      {error ? <p className="text-[12px] text-danger">{error}</p> : null}

      {extensions.length > 0 ? (
        <div className="space-y-2">
          <p className="text-[12px] text-mute">已安装</p>
          <ul className="inset-list">
            {extensions.map((item) => (
              <li key={item.path} className="inset-row">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-medium leading-snug text-ink">{item.name}</p>
                  <p className="text-[11px] text-mute">{item.scope === "user" ? "用户" : "项目"}</p>
                </div>
                <label className="mac-toggle mac-toggle-sm">
                  <input
                    type="checkbox"
                    checked={item.enabled !== false}
                    onChange={(event) => onToggle(item.path, event.target.checked)}
                    aria-label={item.enabled === false ? `启用 ${item.name}` : `停用 ${item.name}`}
                  />
                  <span />
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {extraPackages.length > 0 ? (
        <div className="space-y-2">
          <p className="text-[12px] text-mute">已安装的包</p>
          <ul className="inset-list">
            {extraPackages.map((item) => (
              <li key={`${item.scope}:${item.source}`} className="inset-row">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-medium leading-snug text-ink">{item.source}</p>
                  <p className="text-[11px] text-mute">{item.scope === "user" ? "用户" : "项目"} · 只读</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
