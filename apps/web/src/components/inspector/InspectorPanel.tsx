import { useEffect, useMemo, useRef, useState } from "react";
import { Pin, PinOff, X, PanelRight, PanelRightClose } from "lucide-react";
import {
  parseGitPatch,
  patchLineCounts,
  type PiPackageCatalogItem,
  type PiResources,
  type SkillUpdateApplyResult,
  type SkillUpdateCheckResult,
  type SkillUpdateItem,
} from "@qingzhou/protocol";
import { ancestorDirs, buildFileTree, gitMarksByPath, gitPatchesForEntry, type InspectorFileEntry } from "../../lib/inspector-files";
import { FileTree } from "./FileTree";
import { FilePreview } from "./FilePreview";
import { DiffView } from "../diff/DiffView";
import { InspectorTerminal } from "./InspectorTerminal";
import { InspectorBrowser } from "./InspectorBrowser";
import { InspectorRules } from "./InspectorRules";
import { InspectorSkills } from "./InspectorSkills";
import { InspectorExtensions } from "./InspectorExtensions";
import { InspectorPackageCenter } from "./InspectorPackageCenter";

type Tab = "files" | "git" | "term" | "browser" | "resources";
type ResourceTab = "rules" | "skills" | "plugins";

type FileEntry = InspectorFileEntry;
type GitSnapshot = {
  isRepo?: boolean;
  branch: string | null;
  dirty: boolean;
  entries: Array<{ path: string; status: string }>;
  remoteUrl?: string | null;
};
type Props = {
  taskId?: string | null;
  cwd?: string | null;
  files: FileEntry[];
  preview: { path: string; content: string; truncated: boolean; language?: string } | null;
  git: GitSnapshot | null;
  resources?: PiResources | null;
  gitDiff?: string | null;
  onReadFile: (path: string) => void;
  onLoadTree: () => void;
  onLoadGit: () => void;
  onLoadResources?: () => void;
  onReloadResources?: () => void;
  onCreateAgents?: () => void;
  onGitDiff?: () => void;
  onGitCommit?: (message: string, push?: boolean) => void | Promise<void>;
  onGitRestore?: (path?: string) => void;
  onGitInit?: () => void;
  onReadResource?: (path: string) => Promise<{ path: string; content: string; truncated: boolean }>;
  onWriteResource?: (path: string, content: string) => Promise<void>;
  onToggleSkill?: (path: string, enabled: boolean) => void;
  onToggleExtension?: (path: string, enabled: boolean) => void;
  onInstallPackages?: (sources: string[]) => Promise<void>;
  onLoadPackageCatalog?: () => Promise<{ items: PiPackageCatalogItem[] }>;
  onCheckSkillUpdates?: () => Promise<SkillUpdateCheckResult>;
  onUpdateSkills?: (paths?: string[]) => Promise<SkillUpdateApplyResult>;
  drawer?: boolean;
  pinned?: boolean;
  onPinToggle?: () => void;
  onClose?: () => void;
};

function isNewGitEntry(status: string): boolean {
  const mark = status.trim();
  return mark === "??" || mark.includes("A");
}

export function InspectorPanel({
  taskId = null,
  cwd = null,
  files,
  preview,
  git,
  resources = null,
  gitDiff = null,
  onReadFile,
  onLoadTree,
  onLoadGit,
  onLoadResources,
  onCreateAgents,
  onGitDiff,
  onGitCommit,
  onGitRestore,
  onGitInit,
  onReadResource,
  onWriteResource,
  onToggleSkill,
  onToggleExtension,
  onInstallPackages,
  onLoadPackageCatalog,
  onCheckSkillUpdates,
  onUpdateSkills,
  drawer,
  pinned = false,
  onPinToggle,
  onClose,
}: Props) {
  const [tab, setTab] = useState<Tab>("files");
  const [resourceTab, setResourceTab] = useState<ResourceTab>("rules");
  const [awaitingTree, setAwaitingTree] = useState(files.length === 0);
  const [commitOpen, setCommitOpen] = useState(false);
  const [restoreAllOpen, setRestoreAllOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [commitMode, setCommitMode] = useState<"commit" | "push">("commit");
  const [commitBusy, setCommitBusy] = useState(false);
  const [commitError, setCommitError] = useState("");
  const commitInputRef = useRef<HTMLTextAreaElement>(null);
  const [expandedGitPath, setExpandedGitPath] = useState<string | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set());
  const [treeOpen, setTreeOpen] = useState(true);
  const [skillBusy, setSkillBusy] = useState<string | null>(null);
  const [skillError, setSkillError] = useState("");
  const [skillUpdates, setSkillUpdates] = useState<SkillUpdateItem[] | null>(null);
  const [pluginBusy, setPluginBusy] = useState<string | null>(null);
  const [pluginError, setPluginError] = useState("");
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogItems, setCatalogItems] = useState<PiPackageCatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const skillAutoChecked = useRef(false);
  const onLoadTreeRef = useRef(onLoadTree);
  const onLoadGitRef = useRef(onLoadGit);
  const onLoadResourcesRef = useRef(onLoadResources);
  onLoadTreeRef.current = onLoadTree;
  onLoadGitRef.current = onLoadGit;
  onLoadResourcesRef.current = onLoadResources;

  useEffect(() => {
    skillAutoChecked.current = false;
    setSkillUpdates(null);
    setPluginError("");
    setCatalogOpen(false);
    setCatalogItems([]);
    setCatalogError("");
  }, [taskId]);

  useEffect(() => {
    if (tab === "resources") onLoadResourcesRef.current?.();
  }, [taskId, tab]);

  useEffect(() => {
    if (tab !== "files" && tab !== "git") return;
    setAwaitingTree(true);
    if (tab === "files") onLoadTreeRef.current();
    onLoadGitRef.current();
    const timer = window.setTimeout(() => setAwaitingTree(false), 600);
    return () => window.clearTimeout(timer);
  }, [taskId, tab]);

  useEffect(() => {
    if (files.length > 0) setAwaitingTree(false);
  }, [files]);

  const fileTree = useMemo(() => buildFileTree(files), [files]);
  const gitMarks = useMemo(() => gitMarksByPath(git?.entries ?? []), [git?.entries]);
  const gitPatches = useMemo(() => parseGitPatch(gitDiff ?? ""), [gitDiff]);
  const gitTotals = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const file of gitPatches) {
      const counts = patchLineCounts(file.lines);
      added += counts.added;
      removed += counts.removed;
    }
    return { added, removed };
  }, [gitPatches]);

  useEffect(() => {
    if (!git?.entries.length) {
      setExpandedGitPath(null);
      return;
    }
    setExpandedGitPath((current) =>
      current && git.entries.some((entry) => entry.path === current) ? current : (git.entries[0]?.path ?? null),
    );
  }, [git?.entries]);

  useEffect(() => {
    if (!preview?.path) return;
    setTab("files");
    onLoadGitRef.current();
  }, [preview?.path]);

  useEffect(() => {
    if (!preview?.path) return;
    setExpandedDirs((current) => {
      const next = new Set(current);
      for (const dir of ancestorDirs(preview.path)) next.add(dir);
      return next;
    });
  }, [preview?.path]);

  useEffect(() => {
    if (!commitOpen) return;
    commitInputRef.current?.focus();
  }, [commitOpen]);

  const canCommit = Boolean(onGitCommit && git && git.isRepo !== false && git.dirty);
  const canPush = Boolean(git?.remoteUrl);
  const closeCommit = () => {
    if (commitBusy) return;
    setCommitOpen(false);
    setCommitMessage("");
    setCommitMode("commit");
    setCommitError("");
  };
  const submitCommit = () => {
    const message = commitMessage.trim();
    if (!message || !onGitCommit || commitBusy) return;
    setCommitBusy(true);
    setCommitError("");
    void Promise.resolve(onGitCommit(message, commitMode === "push" && canPush))
      .then(() => {
        setCommitOpen(false);
        setCommitMessage("");
        setCommitMode("commit");
      })
      .catch((cause: unknown) => {
        setCommitError(cause instanceof Error ? cause.message : "提交失败");
      })
      .finally(() => {
        setCommitBusy(false);
      });
  };

  async function checkSkillUpdates() {
    if (!onCheckSkillUpdates) return;
    setSkillBusy("check");
    setSkillError("");
    try {
      const result = await onCheckSkillUpdates();
      setSkillUpdates(result.items);
    } catch (caught) {
      setSkillError(caught instanceof Error ? caught.message : "检查更新失败");
      setSkillUpdates((current) => current ?? []);
    } finally {
      setSkillBusy(null);
    }
  }

  useEffect(() => {
    if (tab !== "resources" || resourceTab !== "skills") return;
    if (!onCheckSkillUpdates || skillAutoChecked.current) return;
    skillAutoChecked.current = true;
    void checkSkillUpdates();
  }, [tab, resourceTab, taskId, onCheckSkillUpdates]);

  async function updateSkills(paths?: string[]) {
    if (!onUpdateSkills) return;
    setSkillBusy(paths?.length === 1 ? paths[0]! : "all");
    setSkillError("");
    try {
      const result = await onUpdateSkills(paths);
      setSkillUpdates(result.items);
      if (result.failed.length > 0) {
        setSkillError(result.failed.map((item) => item.error).join("；"));
      }
    } catch (caught) {
      setSkillError(caught instanceof Error ? caught.message : "更新失败");
    } finally {
      setSkillBusy(null);
    }
  }

  async function loadCatalog() {
    if (!onLoadPackageCatalog) return;
    setCatalogLoading(true);
    setCatalogError("");
    try {
      const result = await onLoadPackageCatalog();
      setCatalogItems(result.items);
    } catch (caught) {
      setCatalogError(caught instanceof Error ? caught.message : "无法加载插件中心");
    } finally {
      setCatalogLoading(false);
    }
  }

  async function openCatalog() {
    setCatalogOpen(true);
    await loadCatalog();
  }

  async function installPackages(sources: string[]) {
    if (!onInstallPackages) return;
    setPluginBusy(sources.length === 1 ? sources[0]! : "all");
    setPluginError("");
    try {
      await onInstallPackages(sources);
    } catch (caught) {
      setPluginError(caught instanceof Error ? caught.message : "安装失败");
    } finally {
      setPluginBusy(null);
    }
  }

  return (
    <>
    <aside
      className={`material-sidebar flex h-full w-full shrink-0 flex-col border-l border-line ${drawer ? "shadow-dialog" : ""}`}
      aria-label="详情"
    >
      <div className="flex items-center gap-1 border-b border-line px-2 py-1">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {(["files", "git", "term", "browser", "resources"] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={`pressable h-6 min-h-6 shrink-0 whitespace-nowrap rounded-md px-1.5 text-[11px] font-medium ${tab === item ? "bg-fill-strong text-ink" : "hover-fill text-mute"}`}
              onClick={() => {
                setTab(item);
                if (item === "files") {
                  onLoadTree();
                  onLoadGit();
                }
                if (item === "git") {
                  onLoadGit();
                  onGitDiff?.();
                }
                if (item === "resources") onLoadResources?.();
              }}
            >
              {item === "files"
                ? "文件"
                : item === "git"
                  ? "Git"
                  : item === "term"
                    ? "终端"
                    : item === "browser"
                      ? "浏览器"
                      : "资源"}
            </button>
          ))}
        </div>
        {onPinToggle ? (
          <button
            type="button"
            className="pressable icon-btn"
            aria-label={pinned ? "取消固定详情" : "固定详情"}
            aria-pressed={pinned}
            title={pinned ? "取消固定" : "固定在右侧"}
            onClick={onPinToggle}
          >
            {pinned ? <Pin size={14} /> : <PinOff size={14} />}
          </button>
        ) : null}
        {onClose ? (
          <button type="button" className="pressable h-7 shrink-0 px-2 text-[12px] text-mute" onClick={onClose}>
            关闭
          </button>
        ) : null}
      </div>
      <div className={`min-h-0 flex-1 ${tab === "files" || tab === "term" || tab === "browser" || tab === "resources" ? "flex flex-col overflow-hidden" : "overflow-y-auto p-3"}`}>
        {tab === "files" ? (
          <div className="flex min-h-0 flex-1 flex-col">
            {awaitingTree && fileTree.length === 0 && !preview ? (
              <InspectorSkeleton />
            ) : fileTree.length === 0 && !preview ? (
              <p className="p-3 text-sm text-mute">这个文件夹里还没有可预览的文件。</p>
            ) : (
              <>
                <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line px-1.5">
                  <span className="min-w-0 flex-1 truncate text-[12px] text-ink">
                    {preview?.path.replaceAll("\\", "/").split("/").pop() || "文件"}
                  </span>
                  {preview?.truncated ? <span className="shrink-0 pr-1.5 text-[11px] text-mute">已截断</span> : null}
                  {fileTree.length > 0 ? (
                    <button
                      type="button"
                      className="pressable icon-btn"
                      aria-label={treeOpen ? "隐藏文件树" : "显示文件树"}
                      aria-expanded={treeOpen}
                      title={treeOpen ? "隐藏文件树" : "显示文件树"}
                      onClick={() => setTreeOpen((open) => !open)}
                    >
                      {treeOpen ? <PanelRightClose size={14} /> : <PanelRight size={14} />}
                    </button>
                  ) : null}
                </div>
                <div className="relative min-h-0 flex-1 overflow-hidden">
                  {preview ? (
                    <FilePreview
                      path={preview.path}
                      content={preview.content}
                      language={preview.language}
                      truncated={preview.truncated}
                      chrome={false}
                    />
                  ) : (
                    <p className="p-3 text-sm text-mute">选择文件</p>
                  )}
                  {treeOpen && fileTree.length > 0 ? (
                    <aside
                      className="slide-in-right absolute inset-y-0 right-0 z-10 flex w-[168px] flex-col border-l border-line bg-surface"
                      aria-label="文件树"
                    >
                      <div className="min-h-0 flex-1 overflow-auto px-0.5">
                        <FileTree
                          nodes={fileTree}
                          expanded={expandedDirs}
                          selectedPath={preview?.path}
                          gitMarks={gitMarks}
                          onToggleDir={(path) => {
                            setExpandedDirs((current) => {
                              const next = new Set(current);
                              if (next.has(path)) next.delete(path);
                              else next.add(path);
                              return next;
                            });
                          }}
                          onOpenFile={onReadFile}
                        />
                      </div>
                    </aside>
                  ) : null}
                </div>
              </>
            )}
          </div>
        ) : null}
        {tab === "git" ? (
          <div className="flex min-h-0 flex-col gap-3">
            {git == null ? (
              <InspectorSkeleton />
            ) : git.isRepo !== false ? (
              <>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-ink">
                    未提交
                    {gitTotals.added > 0 || gitTotals.removed > 0 ? (
                      <>
                        <span className="ml-2 font-mono text-[12px] text-success tabular">+{gitTotals.added}</span>
                        <span className="ml-1.5 font-mono text-[12px] text-danger tabular">-{gitTotals.removed}</span>
                      </>
                    ) : (
                      <span className="ml-2 text-mute">{git.dirty ? "有未提交改动" : "工作区干净"}</span>
                    )}
                  </p>
                  <div className="flex shrink-0 items-center gap-1">
                    {onGitRestore ? (
                      <button
                        type="button"
                        className="pressable btn btn-ghost h-7"
                        disabled={!git.dirty}
                        onClick={() => setRestoreAllOpen(true)}
                      >
                        全部撤销
                      </button>
                    ) : null}
                    {onGitCommit ? (
                      <button
                        type="button"
                        className="pressable btn btn-primary h-7"
                        disabled={!canCommit}
                        onClick={() => setCommitOpen(true)}
                      >
                        提交
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-[11px] text-mute">remote</p>
                  <p className="break-all font-mono text-[11px] text-ink">
                    {git.remoteUrl ? git.remoteUrl : "还没有配置 remote"}
                  </p>
                  <p className="pt-1 text-[11px] text-mute">分支</p>
                  <p className="text-sm text-ink">{git.branch ?? "无分支"}</p>
                </div>
                {git.entries.length === 0 ? <p className="text-sm text-mute">没有改动。</p> : null}
                <ul className="divide-y divide-line overflow-hidden rounded-md border border-line">
                  {git.entries.map((entry) => {
                    const patches = gitPatchesForEntry(gitPatches, entry.path);
                    const counts = patches.reduce(
                      (total, item) => {
                        const next = patchLineCounts(item.lines);
                        return { added: total.added + next.added, removed: total.removed + next.removed };
                      },
                      { added: 0, removed: 0 },
                    );
                    const open = expandedGitPath === entry.path;
                    const isNew = isNewGitEntry(entry.status);
                    return (
                      <li key={entry.path} className="bg-surface">
                        <div className={`flex min-h-8 items-center gap-1 px-1 ${open ? "bg-fill" : ""}`}>
                          <button
                            type="button"
                            aria-expanded={open}
                            className={`pressable flex min-h-8 min-w-0 flex-1 items-center gap-2 px-1 py-1.5 text-left ${
                              open ? "" : "hover-fill"
                            }`}
                            onClick={() => setExpandedGitPath(open ? null : entry.path)}
                          >
                            <span className="min-w-0 flex-1 break-all text-[12px] leading-4 text-ink">{entry.path}</span>
                            {isNew ? <span className="shrink-0 text-[11px] text-success">新</span> : null}
                            {counts.added > 0 ? (
                              <span className="shrink-0 font-mono text-[11px] text-success tabular">+{counts.added}</span>
                            ) : null}
                            {counts.removed > 0 ? (
                              <span className="shrink-0 font-mono text-[11px] text-danger tabular">-{counts.removed}</span>
                            ) : null}
                          </button>
                          {onGitRestore ? (
                            <button
                              type="button"
                              className="pressable mr-1 shrink-0 rounded-md px-1.5 py-1 text-[11px] text-mute hover:text-ink"
                              aria-label={`撤销 ${entry.path}`}
                              onClick={() => onGitRestore(entry.path)}
                            >
                              撤销
                            </button>
                          ) : null}
                        </div>
                        {open ? (
                          <div className="border-t border-line p-1.5">
                            {patches.some((item) => item.binary) && patches.every((item) => item.binary || item.lines.length === 0) ? (
                              <p className="px-1 py-2 text-sm text-mute">这是二进制文件，无法预览差异。</p>
                            ) : patches.some((item) => item.lines.length > 0) ? (
                              <div className="space-y-2">
                                {patches.map((item) =>
                                  item.binary ? (
                                    <p key={item.path} className="px-1 py-1 text-sm text-mute">
                                      {item.path} 是二进制文件。
                                    </p>
                                  ) : (
                                    <DiffView key={item.path} review lines={item.lines} fallback="还没有差异。" />
                                  ),
                                )}
                              </div>
                            ) : (
                              <p className="px-1 py-2 text-sm text-mute">
                                {isNew ? "这是新文件，但没有可预览的文本。" : "这个文件没有文本 diff。"}
                              </p>
                            )}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-mute">不是 Git 仓库。</p>
                {onGitInit ? (
                  <button
                    type="button"
                    className="pressable h-7 rounded-md bg-fill-strong px-3 text-[12px] text-ink"
                    onClick={() => onGitInit()}
                  >
                    git init
                  </button>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
        {tab === "term" ? <InspectorTerminal taskId={taskId} cwd={cwd} /> : null}
        {tab === "browser" ? <InspectorBrowser /> : null}
        {tab === "resources" ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex items-center gap-0.5 border-b border-line px-2 py-1">
              {(["rules", "skills", "plugins"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`pressable h-6 min-h-6 rounded-md px-1.5 text-[11px] font-medium ${resourceTab === item ? "bg-fill-strong text-ink" : "hover-fill text-mute"}`}
                  onClick={() => {
                    setResourceTab(item);
                    onLoadResources?.();
                  }}
                >
                  {item === "rules" ? "约定" : item === "skills" ? "技能" : "插件"}
                </button>
              ))}
            </div>
            <div className={`min-h-0 flex-1 ${resourceTab === "rules" ? "flex flex-col overflow-hidden" : "overflow-y-auto p-3"}`}>
              {resourceTab === "rules" ? (
                <InspectorRules
                  files={resources?.agentsFiles ?? []}
                  cwd={cwd}
                  loading={!resources}
                  onRead={onReadResource ?? (async () => ({ path: "", content: "", truncated: false }))}
                  onWrite={onWriteResource ?? (async () => {})}
                  onCreate={onCreateAgents}
                />
              ) : null}
              {resourceTab === "skills" ? (
                <InspectorSkills
                  skills={resources?.skills ?? []}
                  trustProject={Boolean(resources?.trustProject)}
                  onToggle={(path, enabled) => onToggleSkill?.(path, enabled)}
                  busy={skillBusy}
                  error={skillError}
                  updates={skillUpdates}
                  onCheckUpdates={onCheckSkillUpdates ? () => void checkSkillUpdates() : undefined}
                  onUpdateSkills={onUpdateSkills ? (paths) => void updateSkills(paths) : undefined}
                />
              ) : null}
              {resourceTab === "plugins" ? (
                <InspectorExtensions
                  extensions={resources?.extensions ?? []}
                  packages={resources?.packages ?? []}
                  trustProject={Boolean(resources?.trustProject)}
                  onToggle={(path, enabled) => onToggleExtension?.(path, enabled)}
                  error={pluginError}
                  onOpenCatalog={onLoadPackageCatalog ? () => void openCatalog() : undefined}
                />
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </aside>
    {restoreAllOpen ? (
      <div className="dialog-scrim z-[60]">
        <button type="button" className="absolute inset-0" aria-label="关闭" onClick={() => setRestoreAllOpen(false)} />
        <div className="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="git-restore-title">
          <div className="dialog-head">
            <div className="dialog-head-text">
              <h2 id="git-restore-title" className="dialog-title">
                撤销全部改动
              </h2>
              <p className="dialog-copy">未提交的修改和未跟踪文件都会丢掉，无法恢复。</p>
            </div>
          </div>
          <div className="dialog-actions">
            <button type="button" className="pressable btn btn-ghost" onClick={() => setRestoreAllOpen(false)}>
              取消
            </button>
            <button
              type="button"
              className="pressable btn btn-primary"
              onClick={() => {
                setRestoreAllOpen(false);
                onGitRestore?.();
              }}
            >
              全部撤销
            </button>
          </div>
        </div>
      </div>
    ) : null}
    {commitOpen ? (
      <div className="dialog-scrim z-[60]">
        <button type="button" className="absolute inset-0" aria-label="关闭" onClick={closeCommit} />
        <form
          className="dialog-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="git-commit-title"
          onSubmit={(event) => {
            event.preventDefault();
            submitCommit();
          }}
        >
          <div className="dialog-head">
            <div className="dialog-head-text">
              <h2 id="git-commit-title" className="dialog-title">
                {commitMode === "push" ? "提交并推送" : "提交改动"}
              </h2>
              <p className="dialog-copy">
                {gitTotals.added > 0 || gitTotals.removed > 0 ? (
                  <>
                    <span className="font-mono text-success tabular">+{gitTotals.added}</span>
                    <span className="ml-1.5 font-mono text-danger tabular">-{gitTotals.removed}</span>
                    <span className="ml-2">{git?.entries.length ?? 0} 个文件</span>
                  </>
                ) : (
                  "填写这次改动的说明。"
                )}
              </p>
            </div>
            <button type="button" className="pressable icon-btn -mr-1 -mt-1" aria-label="关闭" onClick={closeCommit}>
              <X size={16} />
            </button>
          </div>
          <div className="dialog-body">
            <div className="mb-3 flex rounded-md bg-fill p-0.5">
              <button
                type="button"
                className={`pressable h-7 flex-1 rounded-[6px] text-[12px] ${commitMode === "commit" ? "bg-surface text-ink" : "text-mute"}`}
                onClick={() => setCommitMode("commit")}
              >
                仅提交
              </button>
              <button
                type="button"
                className={`pressable h-7 flex-1 rounded-[6px] text-[12px] ${commitMode === "push" ? "bg-surface text-ink" : "text-mute"}`}
                disabled={!canPush}
                title={canPush ? undefined : "还没有 remote"}
                onClick={() => canPush && setCommitMode("push")}
              >
                提交并推送
              </button>
            </div>
            <label className="block text-[12px] text-mute" htmlFor="git-commit-message">
              提交说明
            </label>
            <textarea
              ref={commitInputRef}
              id="git-commit-message"
              className="field mt-1.5 w-full text-[13px] text-ink"
              rows={4}
              value={commitMessage}
              placeholder="简述这次改动"
              disabled={commitBusy}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeCommit();
                }
              }}
              onChange={(event) => setCommitMessage(event.target.value)}
            />
            {commitError ? (
              <p className="mt-2 text-[12px] text-danger" role="alert">
                {commitError}
              </p>
            ) : null}
          </div>
          <div className="dialog-actions">
            <button type="button" className="pressable btn btn-ghost" onClick={closeCommit} disabled={commitBusy}>
              取消
            </button>
            <button type="submit" className="pressable btn btn-primary" disabled={!commitMessage.trim() || commitBusy}>
              {commitMode === "push" ? "提交并推送" : "提交"}
            </button>
          </div>
        </form>
      </div>
    ) : null}
    {catalogOpen ? (
      <InspectorPackageCenter
        items={catalogItems}
        loading={catalogLoading}
        error={catalogError || pluginError}
        extensions={resources?.extensions ?? []}
        packages={resources?.packages ?? []}
        busy={pluginBusy}
        onClose={() => setCatalogOpen(false)}
        onInstall={(source) => void installPackages([source])}
        onRetry={() => void loadCatalog()}
      />
    ) : null}
    </>
  );
}

function InspectorSkeleton() {
  return (
    <div className="inspector-skeleton" aria-busy="true" aria-label="加载中">
      <div className="inspector-skeleton-line w-[72%]" />
      <div className="inspector-skeleton-line w-[54%]" />
      <div className="inspector-skeleton-line w-[86%]" />
      <div className="inspector-skeleton-line w-[40%]" />
    </div>
  );
}
