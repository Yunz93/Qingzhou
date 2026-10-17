import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Settings } from "lucide-react";
import type { WorkItemDetails, WorkItemSummary } from "@qingzhou/protocol";
import { WorkDashboard, type WorkFilter } from "../components/board/WorkDashboard";
import { RequirementWorkroom } from "../components/board/RequirementWorkroom";
import { WorkObjectivePanel } from "../components/board/WorkObjectivePanel";
import { WorkConversationDrawer, ensureWorkConversationTranscript } from "../components/board/WorkConversationDrawer";
import { NewWorkItemDialog } from "../components/board/NewWorkItemDialog";
import { NewWorkProjectDialog } from "../components/board/NewWorkProjectDialog";
import { WorkProjectPicker } from "../components/board/WorkProjectPicker";
import { ProjectWorkflow, WorkflowDashboard, useProjectWorkflow } from "../components/board/ProjectWorkflow";
import { ModeSwitcher } from "../components/app/ModeSwitcher";
import { UpdateBanner } from "../components/app/UpdateBanner";
import { ThemeToggle } from "../components/status/ThemeToggle";
import { ApprovalSheet } from "../components/approval/ApprovalSheet";
import { InteractionSheet } from "../components/interaction/InteractionSheet";
import { useAgentStore } from "../stores/agent-store";
import { socketClient } from "../transport/socket-client";
import { clientErrorMessage } from "../lib/client-error";

export function BoardPage() {
  const connection = useAgentStore((state) => state.connection);
  const items = useAgentStore((state) => state.workItems);
  const projects = useAgentStore((state) => state.workProjects);
  const activeProjectId = useAgentStore((state) => state.activeProjectId);
  const tasks = useAgentStore((state) => state.tasks);
  const pendingApprovals = useAgentStore((state) => state.pendingApprovals);
  const pendingInteractions = useAgentStore((state) => state.pendingInteractions);
  const workspaceRoot = useAgentStore((state) => state.workspaceRoot);
  const allowedRoots = useAgentStore((state) => state.allowedRoots);
  const [creatingProject, setCreatingProject] = useState(false);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<{ text: string; kind: "error" | "ok" } | null>(null);
  const [details, setDetails] = useState<WorkItemDetails | null>(null);
  const [conversationItem, setConversationItem] = useState<WorkItemSummary | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const filterValue = searchParams.get("filter") ?? "all";
  const filter: WorkFilter = ["all", "attention", "working", "ready", "completed", "archived"].includes(filterValue) ? filterValue as WorkFilter : "all";
  const query = searchParams.get("q") ?? "";
  function setFilter(value: WorkFilter) { setSearchParams((previous) => { previous.set("filter", value); return previous; }, { replace: true }); }
  function setQuery(value: string) { setSearchParams((previous) => { if (value) previous.set("q", value); else previous.delete("q"); return previous; }, { replace: true }); }
  const focusItemId = searchParams.get("item");
  const defaultCwd = workspaceRoot ?? allowedRoots[0] ?? "";
  const project = useMemo(
    () => projects.find((entry) => entry.id === activeProjectId) ?? projects[0],
    [projects, activeProjectId],
  );
  const projectItems = useMemo(
    () => (project ? items.filter((item) => item.projectId === project.id) : []),
    [items, project],
  );
  const selectedSummary = focusItemId ? items.find((item) => item.id === focusItemId) : undefined;
  const activeRequestTaskId = selectedSummary?.taskId ?? conversationItem?.taskId;
  const approval = pendingApprovals.find((entry) => entry.taskId === activeRequestTaskId) ?? null;
  const interaction = pendingInteractions.find((entry) => entry.taskId === activeRequestTaskId) ?? null;
  const workflow = useProjectWorkflow(project?.id);
  const selectedProjectId = selectedSummary?.projectId;

  useEffect(() => {
    if (connection === "open") void socketClient.send("workItem.list").catch(() => undefined);
  }, [connection]);

  useEffect(() => {
    if (!focusItemId) {
      setDetails(null);
      return;
    }
    if (connection !== "open") return;
    let current = true;
    void socketClient
      .send<WorkItemDetails>("workItem.details", { id: focusItemId })
      .then((next) => {
        if (current) setDetails(next);
      })
      .catch((error: unknown) => {
        if (!current) return;
        setNotice({ text: clientErrorMessage(error, "读取任务详情失败"), kind: "error" });
        setDetails(null);
        setSearchParams((previous) => { previous.delete("item"); previous.delete("panel"); return previous; });
      });
    return () => {
      current = false;
    };
  }, [connection, focusItemId, selectedSummary?.updatedAt, selectedSummary?.runCount, selectedSummary?.feedbackCount, setSearchParams]);

  useEffect(() => {
    if (connection === "open" && selectedProjectId && selectedProjectId !== project?.id) {
      void socketClient.send("workProject.select", { id: selectedProjectId }).catch((error: unknown) => {
        setNotice({ text: clientErrorMessage(error, "读取需求所属项目失败"), kind: "error" });
      });
    }
  }, [connection, selectedProjectId, project?.id]);

  function showError(error: unknown, fallback: string) {
    useAgentStore.getState().clearRequestError();
    setNotice({ text: clientErrorMessage(error, fallback), kind: "error" });
  }

  function openDetails(item: WorkItemSummary, panel?: string) {
    setNotice(null);
    setSearchParams((previous) => { previous.set("item", item.id); if (panel) previous.set("panel", panel); else previous.delete("panel"); return previous; });
  }

  function closeDetails() {
    setSearchParams((previous) => { previous.delete("item"); previous.delete("panel"); return previous; });
  }

  function openConversation(item: WorkItemSummary) {
    if (workflow.state?.configs.length) { try { sessionStorage.setItem(`qingzhou:workroom-focus:${item.id}`, JSON.stringify("conversation")); } catch { /* Optional layout preference. */ } openDetails(item); return; }
    closeDetails();
    const taskId = item.taskId;
    if (taskId) {
      useAgentStore.getState().setActiveTask(taskId);
      // Warm activate skips transcript; board may not have it cached — fetch if missing.
      void ensureWorkConversationTranscript(taskId).catch(() => undefined);
    }
    setConversationItem(item);
  }

  function openConversationFull(item: WorkItemSummary) {
    const taskId = item.taskId;
    if (taskId) {
      // WorkbenchLayout's activeTaskId effect owns activate — avoid a duplicate pair.
      useAgentStore.getState().setActiveTask(taskId);
    }
    navigate("/");
  }

  function startItem(id: string) {
    setNotice(null);
    return socketClient.send("workItem.start", { id }).then(() => undefined).catch((error: unknown) => {
      const text = clientErrorMessage(error, "开始执行失败");
      if (text.includes("完善目标说明与验收标准")) setSearchParams((previous) => { previous.set("item", id); previous.set("panel", "scope"); return previous; });
      showError(error, "开始执行失败");
    });
  }

  function stopItem(id: string) {
    setNotice(null);
    return socketClient.send("workItem.stop", { id }).then(() => undefined).catch((error: unknown) => showError(error, "停止执行失败"));
  }

  function acceptItem(id: string) {
    setNotice(null);
    void socketClient.send("workItem.accept", { id }).catch((error: unknown) => showError(error, "验收失败"));
  }

  function reopenItem(id: string) {
    setNotice(null);
    return socketClient.send("workItem.reopen", { id }).then(() => undefined).catch((error: unknown) => showError(error, "重新打开失败"));
  }

  function archiveItem(id: string) {
    setNotice(null);
    if (focusItemId === id) closeDetails();
    void socketClient.send("workItem.archive", { id }).catch((error: unknown) => showError(error, "归档失败"));
  }

  function deleteItem(id: string) {
    setNotice(null);
    return socketClient
      .send("workItem.delete", { id })
      .then(() => {
        closeDetails();
      })
      .catch((error: unknown) => {
        showError(error, "删除失败");
        throw error;
      });
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas text-ink">
      <a className="skip-link" href="#main-content">
        跳到正文
      </a>
      <header className="titlebar app-drag traffic-inline work-page-head border-b border-line px-3">
        <div className="work-head-start">
          <ModeSwitcher />
        </div>
        <WorkProjectPicker
          projects={projects}
          project={project}
          onSelect={(id) => {
            closeDetails();
            void socketClient
              .send("workProject.select", { id })
              .catch((error: unknown) => showError(error, "切换项目失败"));
          }}
          onCreate={() => setCreatingProject(true)}
        />
        <div className="work-head-end app-no-drag">
          <UpdateBanner />
          <ThemeToggle />
          <Link to="/settings" state={{ from: location.pathname + location.search }} aria-label="设置" className="pressable app-no-drag icon-btn">
            <Settings size={15} />
          </Link>
        </div>
      </header>
      {notice && !(focusItemId && workflow.state?.configs.length) ? (
        <div
          className={`banner-note flex items-center justify-between gap-3 ${notice.kind === "error" ? "text-danger" : "text-ink"}`}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          <span>{notice.text}</span>
          <button type="button" className="pressable btn btn-ghost" onClick={() => setNotice(null)}>
            关闭
          </button>
        </div>
      ) : null}
      <main id="main-content" className="min-h-0 flex-1 overflow-y-auto">
        {project ? (
          <div className={`mx-auto w-full px-4 pb-12 pt-4 ${workflow.state?.configs.length ? "workflow-project-container" : "max-w-[1040px]"}`}>
            <h1 className="sr-only">{project.name}</h1>
            {workflow.error ? <p className="mb-3 text-sm text-danger" role="alert">{workflow.error}</p> : null}
            {workflow.state ? <ProjectWorkflow key={`overview:${project.id}`} projectId={project.id} state={workflow.state} items={projectItems} onRefresh={workflow.refresh} onSelect={openDetails}>
              <WorkflowDashboard key={`requirements:${project.id}`} state={workflow.state} items={projectItems} onSelect={openDetails} onCreate={() => setCreating(true)} onStart={startItem} onStop={stopItem} onConversation={openConversation} onArchive={archiveItem} onRefresh={workflow.refresh} />
            </ProjectWorkflow> : null}
            {!workflow.state?.configs.length ? <WorkDashboard
              items={projectItems}
              tasks={tasks}
              pendingApprovals={pendingApprovals}
              pendingInteractions={pendingInteractions}
              filter={filter}
              query={query}
              onQuery={setQuery}
              onCreate={project ? () => setCreating(true) : undefined}
              onFilter={setFilter}
              onSelect={openDetails}
              onStart={startItem}
              onStop={stopItem}
              onAccept={acceptItem}
              onReopen={reopenItem}
              onArchive={archiveItem}
              onOpenConversation={openConversation}
            /> : null}
          </div>
        ) : (
          <div className="mx-auto flex h-full max-w-[440px] flex-col items-center justify-center px-6 pb-16 text-center">
            <p className="text-[22px] font-semibold tracking-tight text-ink">启动一个项目</p>
            <button
              type="button"
              className="pressable btn btn-primary mt-7"
              onClick={() => setCreatingProject(true)}
            >
              启动项目
            </button>
          </div>
        )}
      </main>

      {creatingProject ? (
        <NewWorkProjectDialog
          defaultCwd={defaultCwd}
          onCancel={() => setCreatingProject(false)}
          onCreate={async (input) => {
            await socketClient.send("workProject.create", input);
            setCreatingProject(false);
          }}
        />
      ) : null}
      {creating && project ? (
        <NewWorkItemDialog
          projectName={project.name}
          requirementMode={!!workflow.state?.configs.length}
          onCancel={() => setCreating(false)}
          onCreate={async (input) => {
            const created = await socketClient.send<{ item: WorkItemDetails["item"] }>("workItem.create", { ...input, projectId: project.id });
            setCreating(false);
            setQuery("");
            if (input.start) {
              if (workflow.state?.configs.length) setSearchParams((previous) => { previous.set("item", created.item.id); return previous; });
              else setFilter("working");
              setNotice(null);
            } else {
              setFilter("ready");
              setNotice(workflow.state?.configs.length ? null : { text: "已保存到计划，可在「准备开始」里启动。", kind: "ok" });
            }
          }}
        />
      ) : null}
      {conversationItem ? (
        <WorkConversationDrawer
          item={conversationItem}
          onClose={() => setConversationItem(null)}
          onOpenFull={() => openConversationFull(conversationItem)}
        />
      ) : null}
      {focusItemId && details && workflow.state && details.item.id === focusItemId && details.item.projectId === project?.id ? workflow.state?.configs.length && project ? (
        <RequirementWorkroom key={details.item.id} details={details} state={workflow.state} items={projectItems} projectName={project.name}
          error={notice?.kind === "error" ? notice.text : undefined} onClose={closeDetails} onSelect={openDetails} onRefresh={workflow.refresh} onStart={startItem} onStop={stopItem} onReopen={reopenItem} onOpenFull={openConversationFull}
          onSave={(input) => socketClient.send("workItem.update", { id: details.item.id, ...input }).then(() => { setNotice(null); })} />
      ) : (
        <WorkObjectivePanel
          key={details.item.id}
          details={details}
          hideConversation={workflow.state?.workspaces.some((entry) => entry.itemId === details.item.id && !!entry.removedAt)}
          onClose={closeDetails}
          onSave={(input) => {
            return socketClient.send("workItem.update", { id: focusItemId, ...input }).then(() => undefined);
          }}
          onFeedback={async (text) => {
            try {
              await socketClient.send("workItem.feedback", { id: focusItemId, text });
              closeDetails();
            } catch (error: unknown) {
              showError(error, "继续执行失败");
              throw error;
            }
          }}
          onAccept={() => acceptItem(focusItemId)}
          onReopen={() => reopenItem(focusItemId)}
          onDelete={() => deleteItem(focusItemId)}
          onOpenConversation={() => {
            if (selectedSummary) openConversation(selectedSummary);
          }}
        />
      ) : null}
      {approval ? (
        <div className="dialog-scrim z-[60]" role="presentation">
          <ApprovalSheet
            context={`${project?.name ?? "项目"} / ${selectedSummary?.title ?? conversationItem?.title ?? "需求"}`}
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
            context={`${project?.name ?? "项目"} / ${selectedSummary?.title ?? conversationItem?.title ?? "需求"}`}
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
    </div>
  );
}
