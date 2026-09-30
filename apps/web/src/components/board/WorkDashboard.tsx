import {
  AlertCircle,
  Archive,
  Bot,
  Check,
  CheckCircle2,
  CircleDot,
  Clock3,
  MessageSquareText,
  Pause,
  Play,
  Plus,
  ShieldAlert,
  UserRound,
} from "lucide-react";
import {
  deriveWorkItemViewState,
  type ApprovalRequest,
  type InteractionRequest,
  type TaskRecord,
  type WorkItemSummary,
  type WorkItemViewState,
} from "@qingzhou/protocol";

type Props = {
  items: WorkItemSummary[];
  tasks: TaskRecord[];
  pendingApprovals: ApprovalRequest[];
  pendingInteractions: InteractionRequest[];
  filter: WorkFilter;
  query: string;
  onQuery: (value: string) => void;
  onCreate?: () => void;
  onFilter: (filter: WorkFilter) => void;
  onSelect: (item: WorkItemSummary) => void;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onAccept: (id: string) => void;
  onReopen: (id: string) => void;
  onArchive: (id: string) => void;
  onOpenConversation: (item: WorkItemSummary) => void;
};

export type WorkFilter = "all" | "attention" | "working" | "ready" | "completed" | "archived";

type PresentedItem = {
  item: WorkItemSummary;
  task?: TaskRecord;
  viewState: WorkItemViewState;
};

const ATTENTION_STATES = new Set<WorkItemViewState>([
  "needs_approval",
  "needs_input",
  "needs_review",
  "failed",
  "paused",
]);

const WORKING_STATES = new Set<WorkItemViewState>(["queued", "working"]);

const VIEW_COPY: Record<WorkItemViewState, { label: string; detail: string }> = {
  ready: { label: "准备开始", detail: "" },
  queued: { label: "排队中", detail: "" },
  working: { label: "进行中", detail: "" },
  needs_approval: { label: "等待批准", detail: "" },
  needs_input: { label: "等待回答", detail: "" },
  needs_review: { label: "待验收", detail: "" },
  failed: { label: "失败", detail: "" },
  paused: { label: "已暂停", detail: "" },
  completed: { label: "已完成", detail: "" },
  archived: { label: "已归档", detail: "" },
};

const FILTERS: Array<{ id: WorkFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "attention", label: "需要你处理" },
  { id: "working", label: "进行中" },
  { id: "ready", label: "准备开始" },
  { id: "completed", label: "已完成" },
  { id: "archived", label: "归档" },
];

export function WorkDashboard({
  items,
  tasks,
  pendingApprovals,
  pendingInteractions,
  filter,
  query,
  onQuery,
  onCreate,
  onFilter,
  onSelect,
  onStart,
  onStop,
  onAccept,
  onReopen,
  onArchive,
  onOpenConversation,
}: Props) {
  const presented = items
    .slice()
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .filter((item) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return item.title.toLowerCase().includes(q) || item.description.toLowerCase().includes(q);
    })
    .map((item): PresentedItem => {
      const task = item.taskId ? tasks.find((entry) => entry.id === item.taskId) : undefined;
      return {
        item,
        task,
        viewState: deriveWorkItemViewState({
          item,
          taskStatus: task?.status,
          needsApproval: Boolean(item.taskId && pendingApprovals.some((entry) => entry.taskId === item.taskId)),
          needsInput: Boolean(item.taskId && pendingInteractions.some((entry) => entry.taskId === item.taskId)),
        }),
      };
    });

  const visible = presented.filter((entry) => entry.viewState !== "archived");
  const attention = visible.filter((entry) => ATTENTION_STATES.has(entry.viewState));
  const working = visible.filter((entry) => WORKING_STATES.has(entry.viewState));
  const ready = visible.filter((entry) => entry.viewState === "ready");
  const completed = visible.filter((entry) => entry.viewState === "completed");
  const archived = presented.filter((entry) => entry.viewState === "archived");
  const counts: Record<WorkFilter, number> = {
    all: visible.length,
    attention: attention.length,
    working: working.length,
    ready: ready.length,
    completed: completed.length,
    archived: archived.length,
  };

  const sections = [
    { id: "attention" as const, title: "需要你处理", items: attention },
    { id: "working" as const, title: "进行中", items: working },
    { id: "ready" as const, title: "准备开始", items: ready },
    { id: "completed" as const, title: "最近完成", items: completed.slice(0, 8) },
    { id: "archived" as const, title: "归档", items: archived },
  ].filter((section) => {
    if (filter === "all") return section.id !== "archived" && section.items.length > 0;
    return section.id === filter;
  });

  return (
    <div className="work-dashboard">
      <div className="work-toolbar">
        <label className="search-field work-search">
          <span className="sr-only">搜索任务</span>
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="搜索任务"
            aria-label="搜索任务"
            className="h-7 w-full bg-transparent text-[13px] text-ink placeholder:text-mute"
          />
        </label>
        {onCreate ? (
          <button type="button" className="pressable btn btn-primary h-7 shrink-0" onClick={onCreate}>
            <Plus size={14} />
            新建任务
          </button>
        ) : null}
      </div>
      <div className="work-filter-strip" aria-label="工作筛选">
        {FILTERS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`pressable work-filter ${filter === entry.id ? "work-filter-active" : ""}`}
            aria-pressed={filter === entry.id}
            onClick={() => onFilter(entry.id)}
          >
            <span>{entry.label}</span>
            <span className="tabular work-filter-count">{counts[entry.id]}</span>
          </button>
        ))}
      </div>

      <div className="work-sections">
        {query.trim() && sections.every((section) => section.items.length === 0) ? <div className="work-search-empty"><p>没有匹配的任务</p><button type="button" className="pressable btn btn-ghost text-accent" onClick={() => onQuery("")}>清空搜索</button></div> : sections.length === 0 ? <p className="work-section-empty">当前筛选下没有任务。</p> : null}
        {sections.map((section) => (
          <section key={section.id} aria-labelledby={`work-section-${section.id}`} className="work-section">
            <header className="work-section-head">
              <h2 id={`work-section-${section.id}`}>{section.title}</h2>
              <span className="tabular work-section-count">{section.items.length}</span>
            </header>
            {section.items.length > 0 ? (
              <ul className="work-objective-list">
                {section.items.map((entry) => (
                  <li key={entry.item.id}>
                    <WorkObjectiveRow
                      entry={entry}
                      onSelect={onSelect}
                      onStart={onStart}
                      onStop={onStop}
                      onAccept={onAccept}
                      onReopen={onReopen}
                      onArchive={onArchive}
                      onOpenConversation={onOpenConversation}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="work-section-empty">这里暂时没有任务。</p>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function WorkObjectiveRow({
  entry,
  onSelect,
  onStart,
  onStop,
  onAccept,
  onReopen,
  onArchive,
  onOpenConversation,
}: {
  entry: PresentedItem;
  onSelect: (item: WorkItemSummary) => void;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onAccept: (id: string) => void;
  onReopen: (id: string) => void;
  onArchive: (id: string) => void;
  onOpenConversation: (item: WorkItemSummary) => void;
}) {
  const { item, viewState } = entry;
  const copy = VIEW_COPY[viewState];
  const Icon = viewIcon(viewState);
  const result = item.latestRun?.resultSummary || item.latestRun?.errorMessage;

  return (
    <article className={`work-objective work-objective-${viewState}`}>
      <button type="button" className="pressable work-objective-main" onClick={() => onSelect(item)}>
        <span className="work-state-icon" aria-hidden="true">
          <Icon size={15} />
        </span>
        <span className="work-objective-copy">
          <span className="work-objective-title">{item.title}</span>
          <span className="work-objective-meta">
            <strong>{copy.label}</strong>
          </span>
          {result ? <span className="work-objective-result">{result}</span> : null}
        </span>
      </button>
      <div className="work-objective-actions">
        {viewState === "ready" ? (
          <button type="button" className="pressable btn btn-primary" onClick={() => onStart(item.id)}>
            <Play size={13} />
            开始执行
          </button>
        ) : null}
        {viewState === "queued" || viewState === "working" ? (
          <button type="button" className="pressable btn btn-secondary" onClick={() => onOpenConversation(item)}>
            查看执行
          </button>
        ) : null}
        {viewState === "needs_approval" || viewState === "needs_input" ? (
          <button type="button" className="pressable btn btn-primary" onClick={() => onOpenConversation(item)}>
            {viewState === "needs_approval" ? "查看并批准" : "回答并继续"}
          </button>
        ) : null}
        {viewState === "needs_review" ? (
          <button type="button" className="pressable btn btn-primary" onClick={() => onAccept(item.id)}>
            <Check size={13} />
            接受并完成
          </button>
        ) : null}
        {viewState === "failed" || viewState === "paused" ? (
          <button type="button" className="pressable btn btn-primary" onClick={() => onSelect(item)}>
            补充说明并继续
          </button>
        ) : null}
        {viewState === "completed" ? (
          <button type="button" className="pressable btn btn-secondary" onClick={() => onReopen(item.id)}>
            重新打开
          </button>
        ) : null}
        {viewState === "archived" ? (
          <button type="button" className="pressable btn btn-secondary" onClick={() => onReopen(item.id)}>
            重新打开
          </button>
        ) : null}
        <div className="work-objective-more">
          {viewState === "queued" || viewState === "working" ? (
            <button type="button" className="pressable btn btn-ghost" onClick={() => onStop(item.id)}>
              停止
            </button>
          ) : null}
          {viewState === "needs_review" ? (
            <button type="button" className="pressable btn btn-ghost" onClick={() => onSelect(item)}>
              补充要求
            </button>
          ) : null}
          {viewState === "completed" ? (
            <button
              type="button"
              className="pressable icon-btn"
              aria-label={`归档 ${item.title}`}
              onClick={() => onArchive(item.id)}
            >
              <Archive size={14} />
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function viewIcon(state: WorkItemViewState) {
  if (state === "needs_approval") return ShieldAlert;
  if (state === "needs_input") return MessageSquareText;
  if (state === "needs_review") return UserRound;
  if (state === "failed") return AlertCircle;
  if (state === "paused") return Pause;
  if (state === "queued") return Clock3;
  if (state === "working") return Bot;
  if (state === "completed") return CheckCircle2;
  if (state === "archived") return Archive;
  return CircleDot;
}
