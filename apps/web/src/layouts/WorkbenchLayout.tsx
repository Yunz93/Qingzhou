import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MessageSquare, PanelRight, Pencil, Plus, Settings } from "lucide-react";
import { TaskSidebar } from "../components/tasks/TaskSidebar";
import { ConversationTimeline } from "../components/timeline/ConversationTimeline";
import { PromptComposer, type ComposerImage } from "../components/composer/PromptComposer";
import { InspectorPanel } from "../components/inspector/InspectorPanel";
import { ApprovalSheet } from "../components/approval/ApprovalSheet";
import { InteractionSheet } from "../components/interaction/InteractionSheet";
import { PiStatusRing } from "../components/status/PiStatusRing";
import { ThemeToggle } from "../components/status/ThemeToggle";
import { ContextMeter } from "../components/status/ContextMeter";
import { RunStatusBar } from "../components/status/RunStatusBar";
import { useAgentStore } from "../stores/agent-store";
import { socketClient } from "../transport/socket-client";
import { ModeSwitcher } from "../components/app/ModeSwitcher";
import { UpdateBanner } from "../components/app/UpdateBanner";
import { CommandPalette } from "../components/command-palette/CommandPalette";
import { NewTaskDialog } from "../components/tasks/NewTaskDialog";
import type { ApprovalPolicy, InteractionMode, ThinkingLevel } from "@qingzhou/protocol";
import { stripModePrefix, workItemIsClosed } from "@qingzhou/protocol";
import { headerSubtitle, STARTER_PROMPTS } from "../copy";
import { tasksInSidebarOrder } from "../lib/task-list";
import { OPEN_CONVERSATION_SEARCH_EVENT } from "../lib/conversation-search";
import { showOsNotification } from "../lib/notify";
import { isEditableTarget } from "../lib/hotkeys";
import { readComposerDraft, writeComposerDraft } from "../lib/composer-drafts";
import { clientErrorMessage, reportRequestError } from "../lib/client-error";
import { getDesktop } from "../desktop-bridge";
import { useMediaQuery } from "../hooks/useMediaQuery";
import {
  INSPECTOR_OPEN_KEY,
  INSPECTOR_WIDTH_DEFAULT,
  INSPECTOR_WIDTH_KEY,
  LEFT_PINNED_KEY,
  RIGHT_PINNED_KEY,
  clampInspectorWidth,
  readUiFlag,
  readUiNumber,
  writeUiFlag,
  writeUiNumber,
} from "../lib/ui-prefs";

function WorkbenchConversation({
  canRewrite,
  error,
  onRetry,
  onClone,
  onOpenFile,
  onUndoFile,
  onStarter,
}: {
  canRewrite: boolean;
  error: string | null;
  onRetry: (messageId: string, text: string) => void;
  onClone: () => void;
  onOpenFile: (filePath: string) => void;
  onUndoFile: (filePath: string) => void;
  onStarter: (prompt: string) => void;
}) {
  const messages = useAgentStore((state) => state.messages);
  const tools = useAgentStore((state) => state.tools);
  return (
    <ConversationTimeline
      messages={messages}
      tools={tools}
      canRewrite={canRewrite}
      error={error}
      onRetry={onRetry}
      onClone={onClone}
      onOpenFile={onOpenFile}
      onUndoFile={onUndoFile}
      onStarter={onStarter}
    />
  );
}

export function WorkbenchLayout() {
  const tasks = useAgentStore((state) => state.tasks);
  const activeTaskId = useAgentStore((state) => state.activeTaskId);
  const hasTurns = useAgentStore((state) => state.messages.some((item) => item.role === "user"));
  const messageCount = useAgentStore((state) => state.messages.length);
  const tools = useAgentStore((state) => state.tools);
  const approval = useAgentStore((state) => state.approval);
  const pendingApprovals = useAgentStore((state) => state.pendingApprovals);
  const models = useAgentStore((state) => state.models);
  const thinkingLevels = useAgentStore((state) => state.thinkingLevels);
  const defaultModel = useAgentStore((state) => state.defaultModel);
  const stats = useAgentStore((state) => state.stats);
  const files = useAgentStore((state) => state.fileEntries);
  const preview = useAgentStore((state) => state.filePreview);
  const commands = useAgentStore((state) => state.commands);
  const git = useAgentStore((state) => state.git);
  const gitDiff = useAgentStore((state) => state.gitDiff);
  const runtime = useAgentStore((state) => state.runtime);
  const resources = useAgentStore((state) => state.resources);
  const piSessions = useAgentStore((state) => state.piSessions);
  const piError = useAgentStore((state) => state.piError);
  const piAvailable = useAgentStore((state) => state.piAvailable);
  const authHint = useAgentStore((state) => state.authHint);
  const serverError = useAgentStore((state) => state.serverError);
  const requestError = useAgentStore((state) => state.requestError);
  const connection = useAgentStore((state) => state.connection);
  const allowedRoots = useAgentStore((state) => state.allowedRoots);
  const workspaceRoot = useAgentStore((state) => state.workspaceRoot);
  const pendingInteractions = useAgentStore((state) => state.pendingInteractions);
  const workItems = useAgentStore((state) => state.workItems);
  const toast = useAgentStore((state) => state.toast);
  const devSelfWorkspace = useAgentStore((state) => state.devSelfWorkspace);

  const [draft, setDraft] = useState("");
  const draftTaskRef = useRef<string | null>(null);
  const [query, setQuery] = useState("");
  const [cwd, setCwd] = useState(workspaceRoot ?? allowedRoots[0] ?? "");
  const [creating, setCreating] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [composerImages, setComposerImages] = useState<ComposerImage[]>([]);
  const [taskOpen, setTaskOpen] = useState(false);
  const [leftPinned, setLeftPinned] = useState(() => readUiFlag(LEFT_PINNED_KEY, true));
  const [rightPinned, setRightPinned] = useState(() => readUiFlag(RIGHT_PINNED_KEY, false));
  const [inspectorOpen, setInspectorOpen] = useState(
    () => readUiFlag(RIGHT_PINNED_KEY, false) && readUiFlag(INSPECTOR_OPEN_KEY, false),
  );
  const isMd = useMediaQuery("(min-width: 768px)");
  const isXl = useMediaQuery("(min-width: 1100px)");
  const dockLeft = leftPinned && isMd;
  const dockRight = rightPinned && inspectorOpen && isXl;
  const [inspectorWidth, setInspectorWidth] = useState(() =>
    clampInspectorWidth(readUiNumber(INSPECTOR_WIDTH_KEY, INSPECTOR_WIDTH_DEFAULT)),
  );
  const overlayLeft = taskOpen && !dockLeft;
  const overlayRight = inspectorOpen && !dockRight;
  const [notice, setNotice] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const skipTitleCommitRef = useRef(false);
  const composerImagesRef = useRef(composerImages);
  composerImagesRef.current = composerImages;
  const [retryPrompt, setRetryPrompt] = useState<string | null>(null);
  const [pendingDraft, setPendingDraft] = useState<string | null>(null);
  const sendingRef = useRef(false);
  const navigate = useNavigate();

  useEffect(() => {
    return () => {
      for (const item of composerImagesRef.current) URL.revokeObjectURL(item.previewUrl);
    };
  }, []);

  useEffect(() => {
    const preferred = workspaceRoot ?? allowedRoots[0];
    if (preferred && !cwd) setCwd(preferred);
  }, [allowedRoots, workspaceRoot, cwd]);

  useEffect(() => {
    if (connection !== "open" || !activeTaskId) return;
    let cancelled = false;
    void (async () => {
      try {
        await socketClient.send("task.activate", {}, activeTaskId);
        if (cancelled) return;
        await socketClient.send("snapshot.request", { taskId: activeTaskId }, activeTaskId);
      } catch {
        // Boot errors surface via task status / server.error.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connection, activeTaskId]);

  useEffect(() => {
    if (creating && connection === "open") void socketClient.send("sessions.list", {});
  }, [creating, connection]);

  const task = useMemo(
    () => tasks.find((item) => item.id === activeTaskId),
    [tasks, activeTaskId],
  );
  const linkedWorkItem = useMemo(
    () => (task ? workItems.find((item) => item.taskId === task.id) : undefined),
    [task, workItems],
  );
  const workTaskIds = useMemo(
    () => new Set(workItems.map((item) => item.taskId).filter((id): id is string => Boolean(id))),
    [workItems],
  );
  const status = task?.status ?? "stopped";
  const otherApproval = pendingApprovals.find((item) => item.taskId !== activeTaskId);
  const interaction = pendingInteractions.find((item) => item.taskId === activeTaskId) ?? null;
  const sidebarTasks = useMemo(() => tasksInSidebarOrder(tasks), [tasks]);

  const abortRun = useCallback(() => {
    if (!task) return;
    const lastUser = [...useAgentStore.getState().messages].reverse().find((item) => item.role === "user");
    const text = lastUser ? stripModePrefix(lastUser.text).trim() : draft.trim();
    if (text) setRetryPrompt(text);
    void socketClient.send("agent.abort", {}, task.id).catch((error: unknown) => {
      reportRequestError(error, "停止失败");
    });
  }, [draft, task]);

  useEffect(() => {
    if (!toast?.message) return;
    void showOsNotification("轻舟", toast.message, toast.notifyType);
    const timer = window.setTimeout(() => {
      if (useAgentStore.getState().toast === toast) {
        useAgentStore.setState({ toast: null });
      }
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    writeUiFlag(LEFT_PINNED_KEY, leftPinned);
  }, [leftPinned]);

  useEffect(() => {
    writeUiFlag(RIGHT_PINNED_KEY, rightPinned);
  }, [rightPinned]);

  useEffect(() => {
    writeUiFlag(INSPECTOR_OPEN_KEY, inspectorOpen);
  }, [inspectorOpen]);

  useEffect(() => {
    writeUiNumber(INSPECTOR_WIDTH_KEY, inspectorWidth);
  }, [inspectorWidth]);

  useEffect(() => {
    const prev = draftTaskRef.current;
    if (prev && prev !== activeTaskId) {
      writeComposerDraft(prev, draft);
    }
    draftTaskRef.current = activeTaskId;
    if (pendingDraft) return;
    setDraft(readComposerDraft(activeTaskId));
    // Switching sessions should restore that session's draft, not keep the previous text.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draft is persisted before the id changes
  }, [activeTaskId]);

  useEffect(() => {
    if (!activeTaskId) return;
    const timer = window.setTimeout(() => writeComposerDraft(activeTaskId, draft), 200);
    return () => window.clearTimeout(timer);
  }, [activeTaskId, draft]);

  useEffect(() => {
    if (!pendingDraft || !task) return;
    setDraft(pendingDraft);
    writeComposerDraft(task.id, pendingDraft);
    setPendingDraft(null);
  }, [pendingDraft, task]);

  useEffect(() => {
    if (!approval) return;
    void showOsNotification("轻舟需要确认", approval.rawCommand ?? approval.target ?? "等待批准", "warning");
    // Notify once per request; the full approval object is read from the latest render.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- requestId is the identity
  }, [approval?.requestId]);

  function toggleLeftPinned() {
    setLeftPinned((pinned) => {
      const next = !pinned;
      if (next) setTaskOpen(false);
      return next;
    });
  }

  function toggleRightPinned() {
    setRightPinned((pinned) => {
      const next = !pinned;
      if (next) setInspectorOpen(true);
      return next;
    });
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (creating) {
          event.preventDefault();
          setCreating(false);
          return;
        }
        if (editingTitle) {
          event.preventDefault();
          skipTitleCommitRef.current = true;
          setEditingTitle(false);
          return;
        }
        if (paletteOpen) {
          event.preventDefault();
          setPaletteOpen(false);
          return;
        }
        if (taskOpen) {
          setTaskOpen(false);
          return;
        }
        if (inspectorOpen && !rightPinned) {
          setInspectorOpen(false);
          return;
        }
        if (approval) {
          event.preventDefault();
          void socketClient.send(
            "approval.respond",
            { requestId: approval.requestId, allow: false, remember: false },
            approval.taskId,
          );
          return;
        }
        if (interaction) {
          event.preventDefault();
          void socketClient.send(
            "interaction.respond",
            { requestId: interaction.requestId, cancelled: true },
            interaction.taskId,
          );
          return;
        }
        if (isEditableTarget(event.target)) return;
        event.preventDefault();
        if (task && (status === "running" || status === "waiting_approval" || status === "aborting" || status === "booting")) {
          void abortRun();
        }
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        setCreating(true);
      }
      if ((event.metaKey || event.ctrlKey) && event.key === ",") {
        event.preventDefault();
        navigate("/settings");
      }
      if ((event.metaKey || event.ctrlKey) && event.key === ".") {
        event.preventDefault();
        if (task) void socketClient.send("agent.abort", {}, task.id);
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "i") {
        event.preventDefault();
        setInspectorOpen((open) => !open);
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "b") {
        event.preventDefault();
        navigate("/board");
      }
      if ((event.metaKey || event.ctrlKey) && !isEditableTarget(event.target) && /^[1-9]$/.test(event.key)) {
        event.preventDefault();
        const next = sidebarTasks[Number(event.key) - 1];
        if (next) void selectTask(next.id);
      }
      if ((event.metaKey || event.ctrlKey) && (event.key === "[" || event.key === "]") && !isEditableTarget(event.target)) {
        event.preventDefault();
        const index = sidebarTasks.findIndex((entry) => entry.id === activeTaskId);
        const next =
          event.key === "["
            ? sidebarTasks[index <= 0 ? sidebarTasks.length - 1 : index - 1]
            : sidebarTasks[index >= sidebarTasks.length - 1 ? 0 : index + 1];
        if (next) void selectTask(next.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [abortRun, activeTaskId, approval, creating, editingTitle, inspectorOpen, interaction, navigate, paletteOpen, rightPinned, sidebarTasks, status, task, taskOpen, tasks]);

  async function renameTask(taskId: string, title: string) {
    const next = title.trim().slice(0, 200);
    const current = tasks.find((item) => item.id === taskId);
    if (!next || next === current?.title) return;
    await socketClient.send("task.rename", { title: next }, taskId);
  }

  async function selectTask(taskId: string) {
    useAgentStore.getState().setActiveTask(taskId);
    try {
      await socketClient.send("task.activate", {}, taskId);
      await socketClient.send("snapshot.request", { taskId }, taskId);
    } catch {
      // Activate/snapshot errors surface via task status / server.error.
    }
    setTaskOpen(false);
  }

  const submitPrompt = async (type: "prompt.send" | "prompt.steer" | "prompt.followUp") => {
    if (sendingRef.current || !task || (!draft.trim() && composerImages.length === 0)) return;
    if (type === "prompt.send" && linkedWorkItem && workItemIsClosed(linkedWorkItem.state)) {
      useAgentStore.setState({ requestError: "这个目标已经结束，请先重新打开。" });
      return;
    }
    const taskId = task.id;
    const text = draft;
    const images = composerImages;
    writeComposerDraft(taskId, text);
    sendingRef.current = true;
    setRetryPrompt(null);
    useAgentStore.getState().clearRequestError();
    try {
      if (type === "prompt.send" && linkedWorkItem) {
        await socketClient.send("workItem.feedback", { id: linkedWorkItem.id, text });
      } else {
        if (type === "prompt.send" && (task.status === "stopped" || task.status === "error")) {
          await socketClient.send("task.activate", {}, task.id);
        }
        await socketClient.send(type, { message: text, imageIds: images.map((item) => item.id) }, task.id);
      }
      const stillThisTask = useAgentStore.getState().activeTaskId === taskId;
      if (stillThisTask) {
        setDraft((current) => {
          if (current === text) writeComposerDraft(taskId, "");
          return current === text ? "" : current;
        });
        setComposerImages((current) => {
          const unchanged =
            current.length === images.length && current.every((item, index) => item.id === images[index]?.id);
          if (!unchanged) return current;
          for (const item of images) URL.revokeObjectURL(item.previewUrl);
          return [];
        });
      } else {
        writeComposerDraft(taskId, "");
        for (const item of images) URL.revokeObjectURL(item.previewUrl);
      }
    } catch (error) {
      writeComposerDraft(taskId, text);
      if (useAgentStore.getState().activeTaskId === taskId) {
        setDraft((current) => current || text);
        setComposerImages((current) => (current.length > 0 ? current : images));
      }
      reportRequestError(error);
    } finally {
      sendingRef.current = false;
    }
  };

  const sendPrompt = () => submitPrompt("prompt.send");
  const sendFollowUp = () => submitPrompt("prompt.followUp");

  async function retryLastPrompt() {
    if (sendingRef.current || !task || !retryPrompt) return;
    const text = retryPrompt;
    sendingRef.current = true;
    try {
      if (task.status === "stopped" || task.status === "error") {
        await socketClient.send("task.activate", {}, task.id);
      }
      await socketClient.send("prompt.send", { message: text }, task.id);
      setRetryPrompt(null);
    } catch (error) {
      setRetryPrompt(text);
      reportRequestError(error);
    } finally {
      sendingRef.current = false;
    }
  }

  async function openProjectFile(filePath: string) {
    if (!task) return;
    try {
      const result = await socketClient.send<{ path: string }>("files.open", { path: filePath }, task.id);
      setInspectorOpen(true);
      const desktop = getDesktop();
      if (desktop?.openPath && result.path) {
        const error = await desktop.openPath(result.path);
        if (error) setNotice(error);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法打开文件");
    }
  }

  async function undoProjectFile(filePath: string) {
    if (!task) return;
    try {
      await socketClient.send("checkpoint.restore", { path: filePath }, task.id);
      setNotice(`已撤回 ${filePath}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "撤回失败");
    }
  }

  async function uploadImages(files: FileList | File[]) {
    const next: ComposerImage[] = [];
    try {
      for (const file of [...files]) {
        const body = new FormData();
        body.append("file", file);
        const response = await fetch("/uploads", { method: "POST", credentials: "same-origin", body });
        if (!response.ok) {
          setNotice(response.status === 413 ? "图片太大，换一张再试。" : "图片上传失败，请再试一次。");
          continue;
        }
        const json = (await response.json()) as { id: string };
        next.push({ id: json.id, previewUrl: URL.createObjectURL(file), name: file.name || "图片" });
      }
    } catch (error) {
      setNotice(clientErrorMessage(error, "图片上传失败，请再试一次。"));
      return;
    }
    if (next.length === 0) return;
    setComposerImages((current) => [...current, ...next]);
  }

  function removeComposerImage(id: string) {
    setComposerImages((current) => {
      const gone = current.find((item) => item.id === id);
      if (gone) URL.revokeObjectURL(gone.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  }

  const requestFiles = useCallback(() => {
    if (task) void socketClient.send("files.tree", {}, task.id);
  }, [task]);

  const hasChanges = tools.some((tool) => tool.toolName === "write" || tool.toolName === "edit");

  function renderSidebar(onClose?: () => void) {
    return (
      <TaskSidebar
        tasks={tasks}
        activeTaskId={activeTaskId}
        query={query}
        onQuery={setQuery}
        onSelect={(id) => void selectTask(id)}
        onArchive={(id) => void socketClient.send("task.archive", {}, id)}
        onRename={(id, title) => void renameTask(id, title)}
        pinned={leftPinned}
        onPinToggle={toggleLeftPinned}
        workTaskIds={workTaskIds}
        onOpenBoard={() => navigate("/board")}
        onReorder={(cwd, taskIds) => void socketClient.send("task.reorder", { cwd, taskIds })}
        onNew={() => {
          setTaskOpen(false);
          setCreating(true);
        }}
        onClose={onClose}
      />
    );
  }

  function renderInspector(drawer: boolean) {
    return (
      <InspectorPanel
        drawer={drawer}
        pinned={rightPinned}
        onPinToggle={toggleRightPinned}
        taskId={task?.id ?? null}
        cwd={task?.cwd ?? null}
        files={files}
        preview={preview}
        git={git}
        gitDiff={gitDiff}
        resources={resources}
        onClose={() => setInspectorOpen(false)}
        onLoadTree={() => task && void socketClient.send("files.tree", {}, task.id)}
        onReadFile={(path) => task && void socketClient.send("files.read", { path }, task.id)}
        onLoadGit={() => {
          if (!task) return;
          void socketClient.send("git.status", {}, task.id);
        }}
        onGitDiff={() => task && void socketClient.send("git.diff", {}, task.id)}
        onGitCommit={async (message, push) => {
          if (!task) throw new Error("先打开一个对话。");
          await socketClient.send("git.commit", { message, push }, task.id);
          setNotice(push ? "已提交并推送" : "已提交");
        }}
        onGitRestore={(filePath) => {
          if (!task) return;
          void socketClient
            .send("git.restore", filePath ? { path: filePath } : {}, task.id)
            .then(() => setNotice(filePath ? `已撤销 ${filePath}` : "已撤销全部改动"))
            .catch((error: unknown) => {
              setNotice(error instanceof Error ? error.message : "撤销失败");
            });
        }}
        onGitInit={() => {
          if (!task) return;
          void socketClient
            .send("git.init", {}, task.id)
            .then(() => setNotice("已初始化 Git 仓库"))
            .catch((error: unknown) => {
              setNotice(error instanceof Error ? error.message : "git init 失败");
            });
        }}
        onLoadResources={() => task && void socketClient.send("resources.list", {}, task.id)}
        onReloadResources={() => task && void socketClient.send("resources.reload", {}, task.id)}
        onCreateAgents={() => {
          if (!task) return;
          void socketClient
            .send<{ path: string }>("resources.createAgents", {}, task.id)
            .then((result) => {
              setNotice(`已创建 ${result.path}`);
              setInspectorOpen(true);
            })
            .catch((error: unknown) => {
              setNotice(error instanceof Error ? error.message : "创建 AGENTS.md 失败");
            });
        }}
        onReadResource={(filePath) => {
          if (!task) return Promise.reject(new Error("没有对话"));
          return socketClient.send<{ path: string; content: string; truncated: boolean }>(
            "resources.read",
            { path: filePath },
            task.id,
          );
        }}
        onWriteResource={async (filePath, content) => {
          if (!task) throw new Error("没有对话");
          await socketClient.send("resources.write", { path: filePath, content }, task.id);
          setNotice("已保存约定");
        }}
        onToggleSkill={(filePath, enabled) => {
          if (!task) return;
          void socketClient
            .send("resources.skill.set", { path: filePath, enabled }, task.id)
            .catch((error: unknown) => {
              setNotice(error instanceof Error ? error.message : "技能开关失败");
            });
        }}
        onToggleExtension={(filePath, enabled) => {
          if (!task) return;
          void socketClient
            .send("resources.extension.set", { path: filePath, enabled }, task.id)
            .catch((error: unknown) => {
              setNotice(error instanceof Error ? error.message : "插件开关失败");
            });
        }}
        onInstallPresets={async (ids) => {
          if (!task) throw new Error("没有对话");
          await socketClient.send("resources.package.install", ids?.length ? { ids } : {}, task.id);
        }}
        onCheckSkillUpdates={async () => {
          if (!task?.id) throw new Error("没有对话");
          return socketClient.send("resources.skill.updates", {}, task.id);
        }}
        onUpdateSkills={async (paths) => {
          if (!task) throw new Error("没有对话");
          return socketClient.send("resources.skill.update", paths?.length ? { paths } : {}, task.id);
        }}
      />
    );
  }

  return (
      <div className="relative flex h-dvh overflow-hidden bg-canvas text-ink">
      <a className="skip-link" href="#main-content">
        跳到正文
      </a>
      {dockLeft ? <div className="flex h-full">{renderSidebar()}</div> : null}
      <div className="flex min-w-0 flex-1 flex-col bg-surface">
        <header
          className={`titlebar app-drag flex items-center gap-2 border-b border-line px-3 ${dockLeft ? "" : "traffic-inline"}`}
        >
          <button
            type="button"
            className={`pressable app-no-drag hover-fill inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-ink ${dockLeft ? "md:hidden" : ""}`}
            onClick={() => setTaskOpen(true)}
          >
            <MessageSquare size={14} />
            会话
          </button>
          <button
            type="button"
            className={`pressable app-no-drag icon-btn ${dockLeft ? "md:hidden" : ""}`}
            aria-label="新对话"
            onClick={() => setCreating(true)}
          >
            <Plus size={15} />
          </button>
          <ModeSwitcher />
          <PiStatusRing status={status} size={16} />
          <div className="app-no-drag min-w-0 flex-1">
            {editingTitle && task ? (
              <input
                autoFocus
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={() => {
                  const skip = skipTitleCommitRef.current;
                  skipTitleCommitRef.current = false;
                  setEditingTitle(false);
                  if (!skip) void renameTask(task.id, titleDraft);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    skipTitleCommitRef.current = false;
                    setEditingTitle(false);
                    void renameTask(task.id, titleDraft);
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    skipTitleCommitRef.current = true;
                    setEditingTitle(false);
                  }
                }}
                aria-label="会话标题"
                className="h-7 w-full max-w-[min(100%,360px)] rounded-md bg-fill-strong px-1.5 text-[12.5px] font-medium tracking-tight text-ink"
              />
            ) : (
              <div className="group/title flex min-w-0 items-center gap-1">
                <p
                  className="truncate text-[12.5px] font-medium tracking-tight text-ink"
                  title={task ? "双击重命名" : undefined}
                  onDoubleClick={() => {
                    if (!task) return;
                    setTitleDraft(task.title);
                    setEditingTitle(true);
                  }}
                >
                  {task?.title ?? "还没有对话"}
                </p>
                {task ? (
                  <button
                    type="button"
                    className="pressable icon-btn title-rename-btn"
                    aria-label="重命名"
                    onClick={() => {
                      setTitleDraft(task.title);
                      setEditingTitle(true);
                    }}
                  >
                    <Pencil size={12} />
                  </button>
                ) : null}
              </div>
            )}
            <p className="hidden truncate text-[11px] text-mute sm:block">
              {headerSubtitle(task?.cwd, Boolean(task), status)}
            </p>
          </div>
          {resources &&
          (resources.agentsFiles.length > 0 ||
            resources.skills.length > 0 ||
            (resources.extensions?.length ?? 0) > 0) ? (
            <p className="chip app-no-drag hidden max-w-[260px] truncate lg:inline-flex">
              {[
                resources.agentsFiles.some((item) => item.kind === "agents")
                  ? "已加载 AGENTS.md"
                  : resources.agentsFiles.length > 0
                    ? "已加载上下文文件"
                    : null,
                resources.skills.length ? `${resources.skills.length} 个技能` : null,
                resources.extensions?.length ? `${resources.extensions.length} 个插件` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
          {linkedWorkItem ? (
            <Link
              to={`/board?item=${linkedWorkItem.id}`}
              className="chip app-no-drag hidden max-w-[200px] truncate text-accent lg:inline-flex"
              title={linkedWorkItem.title}
            >
              任务 · {linkedWorkItem.title}
            </Link>
          ) : null}
          {task ? (
            <div className="app-no-drag hidden sm:block">
              <ContextMeter
                stats={stats}
                runtime={runtime}
                compact
                messageCount={messageCount}
                toolCount={tools.length}
                onRefresh={() => void socketClient.send("session.stats", {}, task.id)}
                onCompact={(customInstructions) =>
                  void socketClient.send("session.compact", { customInstructions }, task.id)
                }
                onRuntimeSet={(payload) => void socketClient.send("runtime.set", payload, task.id)}
              />
            </div>
          ) : null}
          <div className="app-no-drag flex items-center gap-0.5">
            <UpdateBanner />
            <ThemeToggle />
            <button
              type="button"
              className="pressable icon-btn"
              aria-label="详情"
              aria-pressed={inspectorOpen}
              onClick={() => setInspectorOpen((open) => !open)}
            >
              <PanelRight size={15} />
            </button>
            <Link to="/settings" aria-label="设置" className="pressable icon-btn">
              <Settings size={15} />
            </Link>
          </div>
        </header>
        <RunStatusBar
          status={status}
          tools={tools}
          hasChanges={hasChanges}
          runtime={runtime}
          errorMessage={task?.errorMessage ?? serverError ?? requestError}
        />
        {!piAvailable ? (
          <div className="banner-note text-danger" role="alert">
            {piError ?? "AI 引擎还没准备好。打开设置完成安装。"}
          </div>
        ) : null}
        {devSelfWorkspace ? (
          <div className="banner-note text-mute" role="status">
            当前工作区是轻舟源码目录，热重载会中断正在跑的任务。请换文件夹，或用{" "}
            <code className="text-ink">pnpm dev:stable</code>。
          </div>
        ) : null}
        {connection !== "open" ? (
          <div className="banner-note text-mute" role="status">
            {connection === "connecting" ? "正在重新连接…" : "已断开，正在尝试重连"}
          </div>
        ) : null}
        {serverError || requestError || task?.errorMessage ? (
          <div className="banner-note whitespace-pre-wrap text-danger" role="alert">
            <span className="min-w-0 flex-1">{requestError ?? serverError ?? task?.errorMessage}</span>
            <button
              type="button"
              className="pressable app-no-drag shrink-0 text-accent"
              onClick={() => useAgentStore.getState().dismissErrors()}
            >
              关闭
            </button>
          </div>
        ) : authHint ? (
          <div className="banner-note text-mute" role="status">
            还没有连接 AI。打开设置登录或粘贴密钥，凭证只会保存在这台电脑上。
          </div>
        ) : notice ? (
          <div className="banner-note text-mute" role="status">
            <span className="min-w-0 truncate">{notice}</span>
          </div>
        ) : null}
        {otherApproval ? (
          <div className="banner-note text-ink" role="status">
            另一个会话在等待确认。
            <button
              type="button"
              className="pressable app-no-drag text-accent"
              onClick={() => void selectTask(otherApproval.taskId)}
            >
              去处理
            </button>
          </div>
        ) : null}
        {retryPrompt && (status === "idle" || status === "error" || status === "stopped") ? (
          <div className="banner-note text-ink" role="status">
            已停止。
            <button type="button" className="pressable app-no-drag text-accent" onClick={() => void retryLastPrompt()}>
              重试上一条
            </button>
          </div>
        ) : null}
        {toast?.message && toast.message !== "回复完成" ? (
          <div
            className={`banner-note ${toast.notifyType === "error" ? "text-danger" : "text-mute"}`}
            role={toast.notifyType === "error" ? "alert" : "status"}
          >
            {toast.message}
          </div>
        ) : null}
        <main
          id="main-content"
          data-conversation-scroll
          className="relative min-h-0 min-w-[0] flex-1 overflow-y-auto overscroll-y-contain"
        >
          {task ? (
            <WorkbenchConversation
              canRewrite={!linkedWorkItem && (status === "idle" || status === "stopped" || status === "error")}
              error={null}
              onRetry={(messageId, text) =>
                void socketClient
                  .send("session.fork", { messageId, message: text }, task.id)
                  .catch((error: unknown) => {
                    setNotice(error instanceof Error ? error.message : "无法从这里重来");
                  })
              }
              onClone={() =>
                void socketClient
                  .send<{ task?: { id: string } }>("session.clone", {}, task.id)
                  .then((result) => {
                    if (result.task?.id) useAgentStore.getState().setActiveTask(result.task.id);
                  })
                  .catch((error: unknown) => {
                    setNotice(error instanceof Error ? error.message : "无法复制对话");
                  })
              }
              onOpenFile={(filePath) => void openProjectFile(filePath)}
              onUndoFile={(filePath) => void undoProjectFile(filePath)}
              onStarter={(prompt) => setDraft(prompt)}
            />
          ) : (
            <div className="mx-auto flex h-full max-w-[420px] flex-col items-center justify-center px-6 pb-16 text-center">
              <p className="text-[28px] font-semibold tracking-tight text-ink">你好，我是轻舟</p>
              <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  className="pressable btn btn-primary"
                  onClick={() => {
                    void socketClient
                      .send<{ task?: { id: string } }>("task.create", { title: "随便聊聊" })
                      .then((result) => {
                        if (result.task?.id) useAgentStore.getState().setActiveTask(result.task.id);
                      })
                      .catch((error: unknown) => reportRequestError(error, "创建对话失败"));
                  }}
                >
                  随便聊聊
                </button>
                <button type="button" className="pressable btn btn-secondary" onClick={() => setCreating(true)}>
                  选择文件夹
                </button>
                <Link to="/board" className="pressable btn btn-secondary">
                  去任务
                </Link>
              </div>
              <div className="mt-8 flex flex-col items-stretch gap-2">
                {STARTER_PROMPTS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="pressable starter-prompt"
                    onClick={() => {
                      setPendingDraft(item.prompt);
                      setCreating(true);
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </main>
        {approval ? (
          <div className="mx-auto w-full max-w-[720px] px-4 pb-2">
            <ApprovalSheet
              approval={approval}
              onRespond={(allow, remember) =>
                void socketClient.send(
                  "approval.respond",
                  { requestId: approval.requestId, allow, remember },
                  approval.taskId,
                )
              }
            />
          </div>
        ) : null}
        {interaction ? (
          <div className="dialog-scrim z-[60]" role="presentation">
            <InteractionSheet
              interaction={interaction}
              onRespond={(payload) =>
                void socketClient.send(
                  "interaction.respond",
                  { requestId: interaction.requestId, ...payload },
                  interaction.taskId,
                )
              }
            />
          </div>
        ) : null}
        {task ? (
          <PromptComposer
            status={status}
            disabled={
              connection !== "open" ||
              Boolean(interaction) ||
              Boolean(linkedWorkItem && workItemIsClosed(linkedWorkItem.state))
            }
            models={models}
            thinkingLevels={thinkingLevels}
            modelId={task.model ? `${task.model.provider}/${task.model.id}` : null}
            defaultModelId={defaultModel ? `${defaultModel.provider}/${defaultModel.id}` : null}
            thinkingLevel={task.thinkingLevel ?? "off"}
            mode={task.mode ?? "agent"}
            approvalPolicy={task.approvalPolicy ?? "auto"}
            files={files}
            commands={commands}
            hasTurns={hasTurns}
            value={draft}
            onChange={setDraft}
            onSend={() => void sendPrompt()}
            onSteer={() => void submitPrompt("prompt.steer")}
            onFollowUp={() => void sendFollowUp()}
            onAbort={abortRun}
            onModel={(provider, modelId) =>
              void socketClient.send("model.set", { provider, modelId }, task.id)
            }
            onDefaultModel={(provider, modelId) =>
              void socketClient.send("model.default.set", { provider, modelId }, task.id)
            }
            onThinking={(level: ThinkingLevel) =>
              void socketClient.send("thinking.set", { level }, task.id)
            }
            onPolicy={(nextMode: InteractionMode, nextPolicy: ApprovalPolicy) =>
              void socketClient.send("task.policy.set", { mode: nextMode, approvalPolicy: nextPolicy }, task.id)
            }
            onImages={(files) => void uploadImages(files)}
            onRemoveImage={removeComposerImage}
            onNeedFiles={requestFiles}
            images={composerImages}
            fastModeEnabled={runtime.fastModeEnabled}
            fastModeActive={runtime.fastModeActive}
            queuedSteering={runtime.steering}
            queuedFollowUp={runtime.followUp}
            onEditQueued={async (kind, index, previousMessage, message) => {
              try {
                await socketClient.send(
                  "prompt.queue.edit",
                  { kind, index, previousMessage, message },
                  task.id,
                );
              } catch (error) {
                reportRequestError(error, "修改队列消息失败");
                throw error;
              }
            }}
            onFastMode={(enabled) => void socketClient.send("runtime.set", { fastMode: enabled }, task.id)}
          />
        ) : null}
      </div>

      {dockRight ? (
        <div className="relative flex h-full shrink-0" style={{ width: inspectorWidth }}>
          <button
            type="button"
            className="inspector-resize"
            aria-label="调整详情宽度"
            onMouseDown={(event) => {
              event.preventDefault();
              const startX = event.clientX;
              const startWidth = inspectorWidth;
              const onMove = (move: MouseEvent) => {
                setInspectorWidth(clampInspectorWidth(startWidth + (startX - move.clientX)));
              };
              const onUp = () => {
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", onUp);
              };
              window.addEventListener("mousemove", onMove);
              window.addEventListener("mouseup", onUp);
            }}
          />
          {renderInspector(false)}
        </div>
      ) : null}

      {overlayLeft ? (
        <div className="fixed inset-0 z-30">
          <button
            type="button"
            className="absolute inset-0 bg-canvas/50 backdrop-blur-sm"
            aria-label="关闭会话列表"
            onClick={() => setTaskOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 z-40 shadow-dialog">{renderSidebar(() => setTaskOpen(false))}</div>
        </div>
      ) : null}

      {overlayRight ? (
        <div className="fixed inset-0 z-30">
          <button
            type="button"
            className="absolute inset-0 bg-canvas/40 backdrop-blur-[2px]"
            aria-label="关闭详情"
            onClick={() => setInspectorOpen(false)}
          />
          <div
            className="slide-in-right absolute inset-y-0 right-0 z-40 max-w-full"
            style={{ width: Math.min(inspectorWidth, typeof window === "undefined" ? inspectorWidth : window.innerWidth) }}
          >
            {renderInspector(true)}
          </div>
        </div>
      ) : null}

      {paletteOpen ? (
        <CommandPalette
          open
          onClose={() => setPaletteOpen(false)}
          onNewTask={() => setCreating(true)}
          onRenameSession={
            task
              ? () => {
                  setTitleDraft(task.title);
                  setEditingTitle(true);
                }
              : undefined
          }
          onFindInConversation={() => {
            window.dispatchEvent(new Event(OPEN_CONVERSATION_SEARCH_EVENT));
          }}
        />
      ) : null}
      {creating ? (
        <NewTaskDialog
          defaultCwd={cwd || workspaceRoot || allowedRoots[0] || ""}
          sessions={piSessions}
          onCancel={() => setCreating(false)}
          onCreate={async (directory, title) => {
            if (directory) setCwd(directory);
            const result = await socketClient.send<{ task?: { id: string } }>(
              "task.create",
              directory ? { cwd: directory, title } : { title: title || "随便聊聊" },
            );
            setCreating(false);
            if (result.task?.id) useAgentStore.getState().setActiveTask(result.task.id);
          }}
          onResume={async (session) => {
            const result = await socketClient.send<{ task?: { id: string } }>("session.resume", {
              sessionPath: session.path,
              cwd: session.cwd ?? (cwd || workspaceRoot || allowedRoots[0]),
              title: session.name || session.preview,
            });
            setCreating(false);
            if (result.task?.id) useAgentStore.getState().setActiveTask(result.task.id);
          }}
        />
      ) : null}
    </div>
  );
}
