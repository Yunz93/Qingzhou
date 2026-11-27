import { ArchivedTasksDialog } from "../components/tasks/ArchivedTasksDialog";
import { hasDialogLayer } from "../hooks/useDialogLayer";
import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowUpRight, ClipboardList, CopyPlus, PanelBottom, PanelLeft, Pencil, Plus } from "lucide-react";
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
import { WorkspaceDrawer, WorkspaceRail, WorkspaceToolbar } from "../components/workspace/WorkspaceChrome";
import { WorkflowMenu } from "../components/board/WorkflowTabs";
import { UpdateBanner } from "../components/app/UpdateBanner";
import { CommandPalette } from "../components/command-palette/CommandPalette";
import { NewTaskDialog } from "../components/tasks/NewTaskDialog";
import { GoWorkDialog } from "../components/board/GoWorkDialog";
import { NewWorkProjectDialog } from "../components/board/NewWorkProjectDialog";
import type { ApprovalPolicy, InteractionMode, PiPackageCatalogResult, ThinkingLevel } from "@qingzhou/protocol";
import { stripModePrefix, workItemIsClosed, workRunIsActive } from "@qingzhou/protocol";
import { headerSubtitle } from "../copy";
import { abnormalStopNotice } from "../lib/run-status";
import { tasksInSidebarOrder } from "../lib/task-list";
import { OPEN_CONVERSATION_SEARCH_EVENT } from "../lib/conversation-search";
import { showOsNotification } from "../lib/notify";
import { isEditableTarget } from "../lib/hotkeys";
import { isImeKey } from "../lib/composer-input";
import { prepareComposerImageIds, useConversationDraft } from "../lib/conversation-draft";
import { ChatToRequirementDialog } from "../components/board/ChatToRequirementDialog";
import { useViewPreference } from "../hooks/useViewPreference";
import { clientErrorMessage, reportRequestError } from "../lib/client-error";
import { getDesktop } from "../desktop-bridge";
import { reconnectDesktopUiState } from "../lib/desktop-ui-state";
import { useMediaQuery } from "../hooks/useMediaQuery";
import {
  INSPECTOR_OPEN_KEY,
  LEFT_PINNED_KEY,
  RIGHT_PINNED_KEY,
  readUiFlag,
  writeUiFlag,
} from "../lib/ui-prefs";

const modelSettingsLink = {
  id: "conversation-model-action",
  to: "/settings#settings-auth",
  state: { from: "/", restoreModelAction: true },
};

type ConversationStartProps = { configured: boolean; onCreate: () => void };

class ConversationStartAction extends Component<ConversationStartProps, object, boolean> {
  override getSnapshotBeforeUpdate(previous: ConversationStartProps) {
    return previous.configured !== this.props.configured && document.activeElement?.id === modelSettingsLink.id;
  }

  override componentDidUpdate(_previous: ConversationStartProps, _state: object, wasFocused: boolean) {
    if (wasFocused) document.getElementById(modelSettingsLink.id)?.focus({ preventScroll: true });
  }

  override render() {
    if (!this.props.configured) {
      return <Link {...modelSettingsLink} className="pressable btn btn-primary">连接模型</Link>;
    }
    return (
      <button id={modelSettingsLink.id} type="button" className="pressable btn btn-primary" onClick={this.props.onCreate}>
        <Plus size={15} aria-hidden="true" />新建对话
      </button>
    );
  }
}

function WorkbenchConversation({
  canRewrite,
  error,
  onRetry,
  onOpenFile,
  onUndoFile,
  onStarter,
}: {
  canRewrite: boolean;
  error: string | null;
  onRetry: (messageId: string, text: string) => void;
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
  const authConfigured = useAgentStore((state) => state.authConfigured);
  const serverError = useAgentStore((state) => state.serverError);
  const requestError = useAgentStore((state) => state.requestError);
  const connection = useAgentStore((state) => state.connection);
  const allowedRoots = useAgentStore((state) => state.allowedRoots);
  const workspaceRoot = useAgentStore((state) => state.workspaceRoot);
  const pendingInteractions = useAgentStore((state) => state.pendingInteractions);
  const workItems = useAgentStore((state) => state.workItems);
  const workProjects = useAgentStore((state) => state.workProjects);
  const activeProjectId = useAgentStore((state) => state.activeProjectId);
  const toast = useAgentStore((state) => state.toast);
  const devSelfWorkspace = useAgentStore((state) => state.devSelfWorkspace);

  const [converting, setConverting] = useState(false);
  const [hiddenConversations, setHiddenConversations] = useViewPreference<string[]>("qingzhou:hidden-conversations", []);
  const [query, setQuery] = useState("");
  const defaultCwd = workspaceRoot ?? allowedRoots[0];
  const [creating, setCreating] = useState(false);
  const [goingWork, setGoingWork] = useState(false);
  const [creatingWorkProject, setCreatingWorkProject] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const [taskOpen, setTaskOpen] = useState(false);
  const [leftPinned, setLeftPinned] = useState(() => readUiFlag(LEFT_PINNED_KEY, true));
  const [rightPinned, setRightPinned] = useState(() => readUiFlag(RIGHT_PINNED_KEY, false));
  const [inspectorOpen, setInspectorOpen] = useState(
    () => readUiFlag(RIGHT_PINNED_KEY, false) && readUiFlag(INSPECTOR_OPEN_KEY, false),
  );
  const isMd = useMediaQuery("(min-width: 768px)");
  const compactHeader = useMediaQuery("(max-width: 639px)", false);
  const dockLeft = leftPinned && isMd;
  const overlayLeft = taskOpen && !dockLeft;
  const [notice, setNotice] = useState("");
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [archivedTask, setArchivedTask] = useState<{ id: string; title: string } | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const skipTitleCommitRef = useRef(false);

  const [retryPrompt, setRetryPrompt] = useState<{ taskId: string; text: string; images: ComposerImage[]; reason: "stopped" | "failed" } | null>(null);
  const [pendingDraft, setPendingDraft] = useState<string | null>(null);
  const [promptSending, setPromptSending] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const reconnectingRef = useRef(false);
  const sendingRef = useRef(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (connection !== "open" || !activeTaskId) return;
    // Activate pushes a snapshot on the WS reply path (including warm sessions).
    void socketClient.send("task.activate", {}, activeTaskId).catch(() => {
      // Boot errors surface via task status / server.error.
    });
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
  const sharedDraft = useConversationDraft(activeTaskId, linkedWorkItem?.id);
  const draft = sharedDraft.text;
  const setDraft = sharedDraft.setText;
  const composerImages = sharedDraft.images;
  const setComposerImages = sharedDraft.setImages;
  const workTaskIds = useMemo(
    () => new Set(workItems.map((item) => item.taskId).filter((id): id is string => Boolean(id))),
    [workItems],
  );
  const taskGroupNames = useMemo(() => {
    const names = new Map(workProjects.map((project) => [project.cwd, project.name]));
    const itemsByTask = new Map(workItems.map((item) => [item.taskId, item]));
    for (const entry of tasks) {
      const item = itemsByTask.get(entry.id);
      if (!item) continue;
      const project = workProjects.find((project) => project.id === item.projectId);
      if (project && entry.cwd !== project.cwd) names.set(entry.cwd, `${project.name} · ${item.title}`);
    }
    return names;
  }, [tasks, workItems, workProjects]);
  const runtimeStatus = task?.status ?? "stopped";
  const status = ["idle", "stopped"].includes(runtimeStatus) && linkedWorkItem?.latestRun && workRunIsActive(linkedWorkItem.latestRun.status) ? "queued" : runtimeStatus;
  const reconnect = async () => {
    if (reconnectingRef.current) return;
    reconnectingRef.current = true;
    setReconnecting(true);
    try {
      const ensureBackend = getDesktop()?.ensureBackend;
      if (ensureBackend && await reconnectDesktopUiState(ensureBackend)) return;
      if (useAgentStore.getState().connection !== "open") {
        // The connection effect activates the selected task after reconnect.
        await socketClient.reconnect();
      } else if (task) {
        await socketClient.send("task.activate", {}, task.id);
      }
    } catch (error) {
      reportRequestError(error, "重新连接失败，请重试。");
    } finally {
      reconnectingRef.current = false;
      setReconnecting(false);
    }
  };
  const otherApproval = pendingApprovals.find((item) => item.taskId !== activeTaskId && !workTaskIds.has(item.taskId));
  const interaction = pendingInteractions.find((item) => item.taskId === activeTaskId) ?? null;
  const sidebarTasks = useMemo(() => tasksInSidebarOrder(tasks.filter((entry) => !hiddenConversations.includes(entry.id))), [tasks, hiddenConversations]);

  const abortRun = useCallback(() => {
    if (!task) return;
    const lastUser = useAgentStore.getState().messages.findLast((message) => message.role === "user");
    void socketClient.send("agent.abort", {}, task.id).then(() => {
      // Requirement runs resume through their own recorded workflow.
      if (linkedWorkItem || !lastUser) return;
      const text = stripModePrefix(lastUser.text);
      const images = (lastUser.images ?? []).flatMap((image, index) =>
        image.dataUrl?.startsWith("data:image/") ? [{ id: "", name: image.name || `图片 ${index + 1}`, previewUrl: image.dataUrl }] : []);
      if (text.trim() || images.length) setRetryPrompt({ taskId: task.id, text, images, reason: "stopped" });
    }).catch((error: unknown) => {
      reportRequestError(error, "停止失败");
    });
  }, [linkedWorkItem, task]);

  useEffect(() => {
    if (!toast?.message) return;
    void showOsNotification("墨问", toast.message, toast.notifyType);
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
    if (!pendingDraft || !task) return;
    setDraft(pendingDraft);
    setPendingDraft(null);
  }, [pendingDraft, task, setDraft]);

  useEffect(() => {
    if (!approval) return;
    void showOsNotification("墨问需要确认", approval.rawCommand ?? approval.target ?? "等待批准", "warning");
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
      if (event.defaultPrevented || isImeKey(event) || hasDialogLayer()) return;
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
        navigate("/settings", { state: { from: "/" } });
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
    try {
      await socketClient.send("task.rename", { title: next }, taskId);
    } catch (error) {
      reportRequestError(error, "重命名失败，请重试。");
    }
  }

  function editTitle() {
    if (!task) return;
    skipTitleCommitRef.current = false;
    setTitleDraft(task.title);
    setEditingTitle(true);
  }

  async function cloneConversation() {
    if (!task) return;
    try {
      const result = await socketClient.send<{ task?: { id: string } }>("session.clone", {}, task.id);
      if (result.task?.id) useAgentStore.getState().setActiveTask(result.task.id);
    } catch (error) {
      reportRequestError(error, "无法复制对话");
    }
  }

  function convertConversation() {
    setConverting(true);
    void socketClient.send("workItem.list").catch(() => undefined);
  }

  async function selectTask(taskId: string) {
    useAgentStore.getState().setActiveTask(taskId);
    // Activation + snapshot are owned by the connection/activeTaskId effect —
    // avoiding a second serialized activate/snapshot pair on every click.
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
    const clientMessageId = crypto.randomUUID();
    const optimistic =
      type === "prompt.send" && !linkedWorkItem
        ? {
            id: clientMessageId,
            role: "user" as const,
            text,
            createdAt: new Date().toISOString(),
            images: images.map((item) => ({
              mimeType: "image/*",
              name: item.name,
              dataUrl: item.previewUrl,
            })),
          }
        : null;

    // Optimistic UI: show the user bubble and clear the composer on the next frame.
    if (optimistic) {
      useAgentStore.getState().appendOptimisticUserMessage(taskId, optimistic);
    }
    setDraft("");
    setComposerImages([]);
    sendingRef.current = true;
    setPromptSending(true);
    setRetryPrompt(null);
    useAgentStore.getState().clearRequestError();

    try {
      const imageIds = await prepareComposerImageIds(images);
      if (linkedWorkItem && !["running", "waiting_approval", "aborting"].includes(task.status)) {
        await socketClient.send(task.mode === "ask" || task.mode === "plan" || task.mode === "review" ? "workItem.discuss" : "workItem.feedback", { id: linkedWorkItem.id, text: text || "请根据附图继续当前需求。", imageIds });
      } else {
        if (type === "prompt.send" && (task.status === "stopped" || task.status === "error" || task.status === "booting")) {
          // activate is safe while booting — it awaits the shared boot Promise.
          if (task.status === "stopped" || task.status === "error") {
            await socketClient.send("task.activate", {}, task.id);
          }
        }
        await socketClient.send(
          type,
          {
            message: text,
            imageIds,
            ...(optimistic ? { clientMessageId } : {}),
          },
          task.id,
        );
      }
      if (optimistic && images.length > 0) {
        window.setTimeout(() => {
          for (const item of images) URL.revokeObjectURL(item.previewUrl);
        }, 4000);
      }
    } catch (error) {
      if (optimistic) {
        useAgentStore.getState().markMessageFailed(taskId, clientMessageId);
        setRetryPrompt({ taskId, text, images, reason: "failed" });
        setDraft((current) => current || text);
        setComposerImages((current) => current.length ? current : images);
      } else {
        if (useAgentStore.getState().activeTaskId === taskId) {
          setDraft((current) => current || text);
          setComposerImages((current) => (current.length > 0 ? current : images));
        }
      }
      reportRequestError(error);
    } finally {
      sendingRef.current = false;
      setPromptSending(false);
    }
  };

  const sendPrompt = () => submitPrompt("prompt.send");
  const sendFollowUp = () => submitPrompt("prompt.followUp");

  async function retryLastPrompt() {
    if (sendingRef.current || !task || !retryPrompt || retryPrompt.taskId !== task.id) return;
    const text = retryPrompt.text;
    const images = retryPrompt.images;
    const clientMessageId = crypto.randomUUID();
    // Drop previous failed optimistic bubble(s) with the same text before retrying.
    const failed = useAgentStore
      .getState()
      .messages.filter((item) => item.role === "user" && item.isError && item.text === text);
    for (const item of failed) {
      useAgentStore.getState().removeMessage(task.id, item.id);
    }
    useAgentStore.getState().appendOptimisticUserMessage(task.id, {
      id: clientMessageId,
      role: "user",
      text,
      images: images.map((image) => ({ mimeType: "image/*", name: image.name, dataUrl: image.previewUrl })),
      createdAt: new Date().toISOString(),
    });
    sendingRef.current = true;
    setPromptSending(true);
    try {
      const imageIds = await prepareComposerImageIds(images);
      if (task.status === "stopped" || task.status === "error") {
        await socketClient.send("task.activate", {}, task.id);
      }
      await socketClient.send("prompt.send", { message: text, imageIds, clientMessageId }, task.id);
      setRetryPrompt(null);
      setDraft((current) => current === text ? "" : current);
      setComposerImages((current) => current.filter((image) => !images.some((sent) => sent.id === image.id)));
      setTimeout(() => { for (const image of images) URL.revokeObjectURL(image.previewUrl); }, 4000);
    } catch (error) {
      useAgentStore.getState().markMessageFailed(task.id, clientMessageId);
      setRetryPrompt({ taskId: task.id, text, images, reason: "failed" });
      reportRequestError(error);
    } finally {
      sendingRef.current = false;
      setPromptSending(false);
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

  const hasChanges = tools.some((tool) => tool.status === "succeeded" && (tool.toolName === "write" || tool.toolName === "edit"));

  function renderSidebar(onClose?: () => void) {
    return (
      <WorkspaceRail section="conversation" onClose={onClose}><TaskSidebar
        tasks={tasks.filter((entry) => !hiddenConversations.includes(entry.id))}
        activeTaskId={activeTaskId}
        waitingInputTaskIds={new Set(pendingInteractions.map((entry) => entry.taskId))}
        groupNames={taskGroupNames}
        query={query}
        onQuery={setQuery}
        onSelect={(id) => void selectTask(id)}
        onArchive={(id) => {
          if (workTaskIds.has(id)) { setHiddenConversations([...hiddenConversations, id]); setNotice("已从最近对话隐藏，需求及执行记录保留。"); return; }
          const archived = tasks.find((entry) => entry.id === id);
          useAgentStore.getState().removeTaskOptimistic(id);
          void socketClient.send("task.archive", {}, id).then(() => {
            if (archived) setArchivedTask({ id, title: archived.title });
          }).catch((error: unknown) => {
            useAgentStore.getState().clearArchivingTask(id);
            setNotice(error instanceof Error ? error.message : "归档失败");
            void socketClient.send("snapshot.request", {}).catch(() => undefined);
          });
        }}
        onShowArchived={() => setArchivedOpen(true)}
        onShowHidden={hiddenConversations.length ? () => { setHiddenConversations([]); setNotice("已恢复隐藏的需求对话。"); } : undefined}
        onRename={(id, title) => void renameTask(id, title)}
        pinned={leftPinned}
        onPinToggle={isMd ? toggleLeftPinned : undefined}
        workTaskIds={workTaskIds}
        onReorder={(cwd, taskIds) => void socketClient.send("task.reorder", { cwd, taskIds }).catch((error: unknown) => setNotice(error instanceof Error ? error.message : "调整顺序失败"))}
        onNew={() => {
          setTaskOpen(false);
          setCreating(true);
        }}
      /></WorkspaceRail>
    );
  }

  function renderInspector() {
    return (
      <InspectorPanel
        drawer={false}
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
        onInstallPackages={async (sources) => {
          if (!task) throw new Error("没有对话");
          await socketClient.send("resources.package.install", { sources }, task.id);
        }}
        onLoadPackageCatalog={async () => {
          if (!task) throw new Error("没有对话");
          return socketClient.send<PiPackageCatalogResult>("resources.package.catalog", {}, task.id);
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
      <div className="flex min-w-0 flex-1 flex-col bg-canvas">
        <WorkspaceToolbar>
          {!dockLeft ? (
          <button
            type="button"
            className="pressable grid size-10 shrink-0 place-items-center rounded-md hover:bg-fill"
            aria-label="打开导航"
            onClick={() => setTaskOpen(true)}
          >
            <PanelLeft size={14} />
          </button>
          ) : null}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {task ? <PiStatusRing status={status} size={16} /> : null}
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
                  if (isImeKey(event)) return;
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
            ) : task ? (
              <div className="group/title flex min-w-0 flex-1 items-center gap-1.5">
                <h1
                  className="min-w-0 truncate text-[16px] font-semibold text-ink"
                  title={task.title}
                  onDoubleClick={editTitle}
                >
                  {task.title}
                </h1>
                {!compactHeader ? <button
                  type="button"
                  className="pressable icon-btn title-rename-btn"
                  aria-label="重命名"
                  title="重命名"
                  onClick={editTitle}
                >
                  <Pencil size={12} />
                </button> : null}
                {linkedWorkItem ? (
                    <Link
                      to={`/board?item=${linkedWorkItem.id}`}
                      state={{ focusRequirementId: linkedWorkItem.id }}
                      className="pressable titlebar-work-link"
                      title={linkedWorkItem.title}
                    >
                      <span>返回需求</span>
                      <ArrowUpRight size={12} aria-hidden="true" />
                    </Link>
                  ) : <span className="hidden min-w-0 truncate text-xs text-mute lg:block" title={task.cwd}>{headerSubtitle(task.cwd, true)}</span>}
              </div>
            ) : (
              <h1 className="text-sm font-semibold text-ink">对话</h1>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {task && compactHeader ? (
              <WorkflowMenu label="会话更多操作" actions={[
                { label: "重命名", run: editTitle },
                ...(!linkedWorkItem && messageCount > 0 ? [{ label: "克隆会话", run: () => void cloneConversation() }] : []),
                ...(!linkedWorkItem ? [{ label: "整理为需求", run: convertConversation }] : []),
              ]} />
            ) : null}
            {task && !compactHeader && !linkedWorkItem && messageCount > 0 ? (
              <button type="button" className="pressable icon-btn" aria-label="克隆会话" title="克隆会话" onClick={() => void cloneConversation()}><CopyPlus size={14} aria-hidden="true" /></button>
            ) : null}
            {task && !compactHeader && !linkedWorkItem ? <button className="conversation-convert icon-btn" aria-label="整理为需求" title="整理为需求" onClick={convertConversation}><ClipboardList className="conversation-convert-icon" size={14} aria-hidden="true" /></button> : null}
            {task ? (
              <div className="hidden sm:block">
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
            <UpdateBanner />
            <ThemeToggle />
            {task ? <button
              type="button"
              className="pressable icon-btn"
              aria-label="工作区工具"
              title="工作区工具"
              aria-pressed={inspectorOpen}
              onClick={() => setInspectorOpen((open) => !open)}
            >
              <PanelBottom size={15} />
            </button> : null}
          </div>
        </WorkspaceToolbar>
        <RunStatusBar
          status={status}
          tools={tools}
          hasChanges={hasChanges}
          runtime={runtime}
          errorMessage={task?.errorMessage || serverError || requestError}
          sending={promptSending}
          waitingForInput={Boolean(interaction)}
        />
        {!piAvailable ? (
          <div className="banner-note text-danger" role="alert">
            {piError ?? "AI 引擎还没准备好。打开设置完成安装。"}
          </div>
        ) : null}
        {devSelfWorkspace ? (
          <div className="banner-note text-mute" role="status">
            当前工作区是墨问源码目录，热重载会中断正在跑的任务。请换文件夹，或用{" "}
            <code className="text-ink">pnpm dev:stable</code>。
          </div>
        ) : null}
        {connection !== "open" || (task && (status === "stopped" || status === "error")) ? (
          <div className="banner-note text-mute" role="status">
            <span className="min-w-0 flex-1">
              {reconnecting ? "正在连接并启动 AI 引擎…" : connection !== "open"
                ? "连接已断开，正在自动重试。" : "AI 引擎未运行，可以重新连接。"}
            </span>
            <button
              type="button"
              className="pressable app-no-drag shrink-0 text-accent"
              disabled={reconnecting}
              onClick={() => void reconnect()}
            >
              {reconnecting ? "正在重连…" : "重新连接"}
            </button>
          </div>
        ) : null}
        {serverError || requestError || task?.errorMessage ? (
          <div className="banner-note whitespace-pre-wrap text-danger" role="alert">
            <span className="min-w-0 flex-1">{requestError || serverError || task?.errorMessage}</span>
            <button
              type="button"
              className="pressable app-no-drag shrink-0 text-accent"
              onClick={() => useAgentStore.getState().dismissErrors()}
            >
              关闭
            </button>
          </div>
        ) : task && (!authConfigured || authHint) ? (
          <div className="banner-note conversation-auth-note text-mute" role="status">
            <span>连接模型服务后即可发送消息。</span>
            <Link {...modelSettingsLink} className="pressable inline-flex shrink-0 items-center font-medium text-accent">连接模型</Link>
          </div>
        ) : notice ? (
          <div className="banner-note text-mute" role="status">
            <span className="min-w-0 truncate">{notice}</span>
          </div>
        ) : null}
        {archivedTask ? <div className="banner-note flex items-center justify-between gap-3" role="status"><span className="min-w-0 truncate">已归档「{archivedTask.title}」</span><div className="flex shrink-0 gap-3"><button type="button" className="pressable text-accent" onClick={() => {
          const id = archivedTask.id;
          void socketClient.send("task.restore", {}, id).then(() => setArchivedTask(null)).catch((error: unknown) => setNotice(error instanceof Error ? error.message : "恢复会话失败"));
        }}>撤销归档</button><button type="button" className="pressable text-mute" onClick={() => setArchivedTask(null)}>关闭</button></div></div> : null}
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
        {retryPrompt?.taskId === task?.id && retryPrompt && (status === "idle" || status === "error" || status === "stopped") ? (
          <div className="banner-note text-ink" role="status">
            {retryPrompt.reason === "stopped" ? "已停止回复。" : "发送失败。"}
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
          tabIndex={-1}
          data-conversation-scroll
          className="relative min-h-0 min-w-[0] flex-1 overflow-y-auto overscroll-y-contain"
        >
          {task ? (
            <WorkbenchConversation
              canRewrite={!linkedWorkItem && (status === "idle" || status === "stopped" || status === "error")}
              error={
                status === "error"
                  ? abnormalStopNotice(task?.errorMessage || serverError || requestError)
                  : null
              }
              onRetry={(messageId, text) =>
                void socketClient
                  .send("session.fork", { messageId, message: text }, task.id)
                  .catch((error: unknown) => {
                    setNotice(error instanceof Error ? error.message : "无法从这里重来");
                  })
              }
              onOpenFile={(filePath) => void openProjectFile(filePath)}
              onUndoFile={(filePath) => void undoProjectFile(filePath)}
              onStarter={(prompt) => setDraft(prompt)}
            />
          ) : (
            <section className="conversation-empty" aria-labelledby="conversation-empty-title">
              <h2 id="conversation-empty-title">
                {!authConfigured ? "先连接一个模型" : sidebarTasks.length ? "选择或新建对话" : "开始一段对话"}
              </h2>
              <p>{!authConfigured ? "使用 Gemini 等服务的 API Key，或登录已有订阅。" : "选好工作文件夹，就可以提问或描述任务。"}</p>
              <ConversationStartAction configured={authConfigured} onCreate={() => setCreating(true)} />
            </section>
          )}
        </main>
        {approval ? (
          <div className="mx-auto w-full max-w-[720px] px-4 pb-2">
            <ApprovalSheet
              context={linkedWorkItem ? `${workProjects.find((entry) => entry.id === linkedWorkItem.projectId)?.name ?? "项目"} / ${linkedWorkItem.title}` : task?.title}
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
              context={linkedWorkItem ? `${workProjects.find((entry) => entry.id === linkedWorkItem.projectId)?.name ?? "项目"} / ${linkedWorkItem.title}` : task?.title}
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
            recorded={Boolean(linkedWorkItem)}
            sending={promptSending}
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
              socketClient.send("task.policy.set", { mode: nextMode, approvalPolicy: nextPolicy }, task.id)
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
        {inspectorOpen ? <section aria-label="辅助工具" className="flex h-[min(38vh,360px)] min-h-36 shrink-0 border-t border-divider [&>aside]:w-full [&>aside]:border-0">{renderInspector()}</section> : null}
      </div>

      {overlayLeft ? (
        <WorkspaceDrawer onClose={() => setTaskOpen(false)}>{renderSidebar(() => setTaskOpen(false))}</WorkspaceDrawer>
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
      {archivedOpen ? <ArchivedTasksDialog onClose={() => setArchivedOpen(false)} onRestore={async (id) => {
        await socketClient.send("task.restore", {}, id);
        setArchivedTask((current) => current?.id === id ? null : current);
      }} /> : null}
      {creating ? (
        <NewTaskDialog
          defaultCwd={defaultCwd ?? ""}
          sessions={piSessions}
          onCancel={() => setCreating(false)}
          onCreate={async (directory, title) => {
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
              cwd: session.cwd ?? defaultCwd,
              title: session.name || session.preview,
            });
            setCreating(false);
            if (result.task?.id) useAgentStore.getState().setActiveTask(result.task.id);
          }}
        />
      ) : null}
      {converting && task && !linkedWorkItem ? <ChatToRequirementDialog task={task} messages={useAgentStore.getState().messages} projects={workProjects} onClose={() => setConverting(false)} onCreated={(id) => { setConverting(false); navigate(`/board?item=${id}`); }} /> : null}
      {goingWork && !creatingWorkProject ? (
        <GoWorkDialog
          projects={workProjects}
          activeProjectId={activeProjectId}
          onCancel={() => setGoingWork(false)}
          onSelect={async (id) => {
            try {
              await socketClient.send("workProject.select", { id });
              setGoingWork(false);
              navigate("/board");
            } catch (error: unknown) {
              reportRequestError(error, "切换项目失败");
            }
          }}
          onCreate={() => {
            setGoingWork(false);
            setCreatingWorkProject(true);
          }}
        />
      ) : null}
      {creatingWorkProject ? (
        <NewWorkProjectDialog
          defaultCwd={defaultCwd ?? ""}
          onCancel={() => setCreatingWorkProject(false)}
          onCreate={async (input) => {
            await socketClient.send("workProject.create", input);
            setCreatingWorkProject(false);
            navigate("/board");
          }}
        />
      ) : null}
    </div>
  );
}
