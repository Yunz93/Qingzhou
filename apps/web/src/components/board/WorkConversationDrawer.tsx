import { useConversationDraft } from "../../lib/conversation-draft";
import { useViewPreference } from "../../hooks/useViewPreference";
import { useDialogLayer } from "../../hooks/useDialogLayer";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, X } from "lucide-react";
import type { ApprovalPolicy, InteractionMode, ThinkingLevel, TimelineMessage, ToolExecution, WorkItemSummary } from "@qingzhou/protocol";
import { workItemIsClosed, workRunIsActive } from "@qingzhou/protocol";
import { ConversationTimeline } from "../timeline/ConversationTimeline";
import { PromptComposer, type ComposerImage } from "../composer/PromptComposer";
import { useAgentStore } from "../../stores/agent-store";
import { socketClient } from "../../transport/socket-client";
import { clientErrorMessage, reportRequestError } from "../../lib/client-error";

type Props = {
  embedded?: boolean;
  discussionRequest?: number;
  item: WorkItemSummary;
  onClose: () => void;
  onOpenFull: () => void;
};

const EMPTY_MESSAGES: TimelineMessage[] = [];
const EMPTY_TOOLS: ToolExecution[] = [];

/** Activate a work conversation; cold boot publishes its restored transcript when ready. */
export async function ensureWorkConversationTranscript(taskId: string): Promise<void> {
  await socketClient.send("task.activate", {}, taskId);
  if (useAgentStore.getState().messagesByTask[taskId] !== undefined) return;
  await socketClient.send("snapshot.request", { taskId }, taskId);
}

function DrawerConversation({ taskId }: { taskId: string }) {
  const messages = useAgentStore((state) => state.messagesByTask[taskId] ?? EMPTY_MESSAGES);
  const tools = useAgentStore((state) => state.toolsByTask[taskId] ?? EMPTY_TOOLS);
  return <ConversationTimeline contained taskId={taskId} messages={messages} tools={tools} />;
}

export function WorkConversationDrawer({ item, onClose, onOpenFull, embedded = false, discussionRequest = 0 }: Props) {
  const panelRef = useRef<HTMLElement>(null);
  useDialogLayer(panelRef, onClose, !embedded);
  const tasks = useAgentStore((state) => state.tasks);
  const messages = useAgentStore((state) => (item.taskId ? (state.messagesByTask[item.taskId] ?? EMPTY_MESSAGES) : EMPTY_MESSAGES));
  const models = useAgentStore((state) => state.models);
  const thinkingLevels = useAgentStore((state) => state.thinkingLevels);
  const defaultModel = useAgentStore((state) => state.defaultModel);
  const files = useAgentStore((state) =>
    item.taskId ? (state.fileEntriesByTask[item.taskId] ?? state.fileEntries) : state.fileEntries,
  );
  const commands = useAgentStore((state) =>
    item.taskId ? (state.commandsByTask[item.taskId] ?? state.commands) : state.commands,
  );
  const connection = useAgentStore((state) => state.connection);
  const pendingInteractions = useAgentStore((state) => state.pendingInteractions);
  const runtime = useAgentStore((state) =>
    item.taskId ? (state.runtimeByTask[item.taskId] ?? state.runtime) : state.runtime,
  );
  const requestError = useAgentStore((state) => state.requestError);
  const serverError = useAgentStore((state) => state.serverError);
  const draftEditor = useConversationDraft(item.taskId, item.id);
  const draft = draftEditor.text;
  const setDraft = draftEditor.setText;
  const { images, setImages } = draftEditor;
  const [intent, setIntent] = useViewPreference(`qingzhou:intent:${item.id}`, item.latestRun?.kind === "discussion" || !item.taskId ? "discussion" : "execute");
  useEffect(() => { if (discussionRequest) setIntent("discussion"); }, [discussionRequest, setIntent]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const sendingRef = useRef(false);
  const [sendPending, setSendPending] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const task = useMemo(() => tasks.find((entry) => entry.id === item.taskId), [item.taskId, tasks]);
  const runtimeStatus = task?.status ?? "stopped";
  const status = ["idle", "stopped"].includes(runtimeStatus) && item.latestRun && workRunIsActive(item.latestRun.status) ? "queued" : runtimeStatus;
  const hasTurns = messages.some((message) => message.role === "user");
  const blockingInteraction = pendingInteractions.some((entry) => entry.taskId === task?.id);
  const itemClosed = workItemIsClosed(item.state);
  const runId = item.latestRun?.id;
  const runKind = item.latestRun?.kind;
  useEffect(() => { if (runId) setIntent(runKind === "discussion" ? "discussion" : "execute"); }, [runId, runKind, setIntent]);

  useEffect(() => {
    const taskId = item.taskId;
    if (!taskId || connection !== "open") return;
    // A bootstrap snapshot may contain an empty transcript for a released runtime.
    // Always activate on entry so Pi can restore the persisted session and models.
    void ensureWorkConversationTranscript(taskId).catch(() => undefined);
  }, [connection, item.taskId]);

  async function uploadImages(filesToUpload: FileList | File[]) {
    const next: ComposerImage[] = [];
    try {
      for (const file of [...filesToUpload]) {
        const body = new FormData();
        body.append("file", file);
        const response = await fetch("/uploads", { method: "POST", credentials: "same-origin", body });
        if (!response.ok) {
          setUploadError(response.status === 413 ? "图片太大，换一张再试。" : "图片上传失败，请再试一次。");
          continue;
        }
        const json = (await response.json()) as { id: string };
        next.push({ id: json.id, previewUrl: URL.createObjectURL(file), name: file.name || "图片" });
      }
    } catch (error) {
      setUploadError(clientErrorMessage(error, "图片上传失败，请再试一次。"));
      return;
    }
    if (next.length === 0) return;
    setUploadError(null);
    setImages((current) => [...current, ...next]);
  }

  async function send(type: "prompt.send" | "prompt.steer" | "prompt.followUp") {
    if (sendingRef.current || status === "queued" || status === "booting" || (!task && intent !== "discussion")) return;
    if (type === "prompt.send" && itemClosed) {
      reportRequestError(new Error("这个目标已经结束，请先重新打开。"));
      return;
    }
    const text = draft;
    const attached = images;
    sendingRef.current = true;
    setSendPending(true);
    useAgentStore.getState().clearRequestError();
    try {
      if (!task || !["running", "waiting_approval", "aborting"].includes(status)) {
        await socketClient.send(intent === "discussion" ? "workItem.discuss" : "workItem.feedback", { id: item.id, text: text || "请结合附图讨论当前需求。", imageIds: attached.map((image) => image.id) }, task?.id);
      } else {
        await socketClient.send(type, { message: text, imageIds: attached.map((image) => image.id) }, task!.id);
      }
      draftEditor.clear(text, attached);
    } catch (error) {
      if (!draftRef.current) setDraft(text);
      setImages((current) => (current.length > 0 ? current : attached));
      reportRequestError(error);
    } finally {
      sendingRef.current = false;
      setSendPending(false);
    }
  }

  if (!item.taskId || !task) {
    const discussionContent = <section className="workflow-draft-discussion" aria-label="需求连续对话"><div className="workflow-empty"><h3>与 Agent 讨论需求与方案</h3></div>
      <label className="sr-only" htmlFor={`discussion-${item.id}`}>输入消息</label><textarea id={`discussion-${item.id}`} className="field w-full" rows={4} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="描述想法，或让助手帮你完善验收标准…" />
      {images.map((image) => <span key={image.id}>{image.name}<button className="btn btn-ghost" aria-label={`移除 ${image.name}`} onClick={() => setImages((current) => { URL.revokeObjectURL(image.previewUrl); return current.filter((entry) => entry.id !== image.id); })}>移除</button></span>)}
      <div className="flex flex-wrap gap-2 mt-3"><label className="btn btn-secondary">添加图片<input className="sr-only" type="file" accept="image/*" multiple onChange={(event) => { if (event.target.files) void uploadImages(event.target.files); event.target.value = ""; }} /></label><button className="btn btn-primary" disabled={sendPending || connection !== "open" || (!draft.trim() && !images.length)} onClick={() => void send("prompt.send")}>{sendPending ? "正在发送…" : "讨论这个需求"}</button></div>
      {requestError || uploadError ? <p className="text-danger mt-2" role="alert">{requestError || uploadError}</p> : null}
    </section>;
    if (embedded) return discussionContent;
    return (
      <div className="work-panel-layer" role="presentation">
        <button type="button" className="work-panel-scrim" aria-label="关闭对话" onClick={onClose} />
        <aside ref={panelRef} tabIndex={-1} className="work-panel work-conversation-panel" role="dialog" aria-modal="true" aria-label="任务对话">
          <header className="work-panel-head app-drag">
            <h2>{item.title}</h2>
            <button type="button" className="pressable app-no-drag icon-btn" aria-label="关闭" onClick={onClose}>
              <X size={16} />
            </button>
          </header>
          {discussionContent}
        </aside>
      </div>
    );
  }

  const content = <>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <DrawerConversation taskId={task.id} />
        </div>
        {uploadError ? (
          <p className="px-4 pb-1 text-[12px] text-danger" role="alert">
            {uploadError}
          </p>
        ) : null}
        {requestError || serverError || task.errorMessage ? (
          <p className="px-4 pb-1 text-[12px] text-danger" role="alert">
            {requestError || serverError || task.errorMessage}
          </p>
        ) : null}
        {itemClosed ? (
          <p className="px-4 pb-2 text-[12px] text-mute">这个目标已经结束，请先重新打开。</p>
        ) : null}
        <div className="workflow-conversation-intent"><label>本轮目的 <select aria-label="本轮目的" className="field" value={intent} disabled={!["idle", "stopped", "error"].includes(status) || sendPending} onChange={(event) => setIntent(event.target.value)}><option value="discussion">讨论与规划 · 只读</option><option value="execute">继续实施 · 记入执行记录</option></select></label></div>
        <PromptComposer
          recorded
          sending={sendPending}
          status={status}
          disabled={connection !== "open" || blockingInteraction || itemClosed}
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
          onSend={() => void send("prompt.send")}
          onSteer={() => void send("prompt.steer")}
          onFollowUp={() => void send("prompt.followUp")}
          onAbort={() =>
            void socketClient.send("agent.abort", {}, task.id).catch((error: unknown) => {
              reportRequestError(error, "停止失败");
            })
          }
          onModel={(provider, modelId) => void socketClient.send("model.set", { provider, modelId }, task.id)}
          onDefaultModel={(provider, modelId) =>
            void socketClient.send("model.default.set", { provider, modelId }, task.id)
          }
          onThinking={(level: ThinkingLevel) => void socketClient.send("thinking.set", { level }, task.id)}
          onPolicy={(mode: InteractionMode, approvalPolicy: ApprovalPolicy) => { setIntent(mode === "agent" ? "execute" : "discussion"); void socketClient.send("task.policy.set", { mode, approvalPolicy }, task.id).catch((error) => reportRequestError(error)); }}
          onImages={(picked) => void uploadImages(picked)}
          onRemoveImage={(id) =>
            setImages((current) => {
              const gone = current.find((image) => image.id === id);
              if (gone) URL.revokeObjectURL(gone.previewUrl);
              return current.filter((image) => image.id !== id);
            })
          }
          onNeedFiles={() => void socketClient.send("files.tree", {}, task.id)}
          images={images}
          fastModeEnabled={runtime.fastModeEnabled}
          fastModeActive={runtime.fastModeActive}
          queuedSteering={runtime.steering}
          queuedFollowUp={runtime.followUp}
          onFastMode={(enabled) => void socketClient.send("runtime.set", { fastMode: enabled }, task.id)}
        />
  </>;
  if (embedded) return <section className="workflow-conversation" aria-label="需求连续对话">{content}</section>;
  return <div className="work-panel-layer" role="presentation">
    <button type="button" className="work-panel-scrim" aria-label="关闭对话" onClick={onClose} />
    <aside ref={panelRef} tabIndex={-1} className="work-panel work-conversation-panel" role="dialog" aria-modal="true" aria-labelledby="work-conversation-title">
        <header className="work-panel-head app-drag">
          <div className="min-w-0">
            <p className="work-panel-kicker">任务对话</p>
            <h2 id="work-conversation-title">{item.title}</h2>
          </div>
          <div className="app-no-drag flex shrink-0 items-center gap-1">
            <button type="button" className="pressable btn btn-ghost h-7" onClick={onOpenFull}>
              对话模式
              <ArrowUpRight size={13} />
            </button>
            <button type="button" className="pressable icon-btn" aria-label="关闭" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </header>
        {content}
    </aside>
  </div>;
}
