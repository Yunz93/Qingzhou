export const TASK_STATUS: Record<string, string> = {
  queued: "排队中",
  booting: "正在启动",
  idle: "就绪",
  running: "正在回复",
  waiting_approval: "等待你确认",
  aborting: "正在停止",
  error: "出错了",
  stopped: "已结束",
};

export const TOOL_STATUS: Record<string, string> = {
  pending: "准备中",
  waiting_approval: "等待确认",
  running: "进行中",
  succeeded: "完成",
  failed: "失败",
  blocked: "已拒绝",
  aborted: "已停止",
};

export const TOOL_NAME: Record<string, string> = {
  write: "写入文件",
  edit: "修改文件",
  bash: "运行命令",
  read: "读取文件",
  grep: "搜索代码",
  find: "查找文件",
  ls: "列出文件",
};

export function taskStatusLabel(status: string): string {
  return TASK_STATUS[status] ?? status;
}

export function toolStatusLabel(status: string): string {
  return TOOL_STATUS[status] ?? status.replaceAll("_", " ");
}

export function toolNameLabel(name: string): string {
  return TOOL_NAME[name] ?? name;
}

const BRANCH_ROLE: Record<string, string> = {
  user: "你",
  assistant: "AI",
  toolResult: "工具",
  system: "系统",
  model_change: "模型",
  thinking_level: "思考",
  compaction: "压缩",
};

const HIDDEN_BRANCH_ROLES = new Set(["model_change", "thinking_level"]);

export function branchRoleLabel(role: string): string {
  return BRANCH_ROLE[role] ?? "其他";
}

export function isVisibleBranchNode(node: { role: string; text: string }): boolean {
  if (HIDDEN_BRANCH_ROLES.has(node.role)) return false;
  if (node.role === "user") return true;
  return Boolean(node.text.trim());
}

export function visibleBranchNodes<T extends { role: string; text: string; leaf?: boolean }>(nodes: T[]): T[] {
  const visible = nodes.filter(isVisibleBranchNode);
  if (visible.some((node) => node.leaf) || !nodes.some((node) => node.leaf)) return visible;
  return visible.map((node, index) => (index === visible.length - 1 ? { ...node, leaf: true } : node));
}

export function folderName(cwd: string): string {
  const parts = cwd.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

export function nextHint(status: string, hasTask: boolean): string {
  if (!hasTask) return "";
  if (status === "waiting_approval") return "等待确认";
  if (status === "running") return taskStatusLabel("running");
  if (status === "error") return "出错了";
  if (status === "queued") return "排队中";
  if (status === "booting") return "正在启动";
  if (status === "aborting") return "正在停止";
  return "";
}

/** Header subtitle: folder only. Keyboard hints live in the composer; live progress is the status bar. */
export function headerSubtitle(cwd: string | undefined, hasTask: boolean): string {
  if (!hasTask || !cwd) return "";
  return folderName(cwd);
}

/** Composer placeholder: steer/queue hints only while busy — do not repeat RunStatusBar progress copy. */
export function composerPlaceholder(busy: boolean, sendMode: "steer" | "followUp" = "steer"): string {
  if (!busy) return "输入消息";
  if (sendMode === "followUp") return "回车排队，Shift+Enter 补充";
  return "回车补充，Shift+Enter 排队";
}

export const STARTER_PROMPTS = [
  { id: "explore", label: "看看这个仓库的结构", prompt: "看看这个仓库的结构，用几句话说明主要目录和入口。" },
  { id: "tests", label: "帮我写测试", prompt: "帮我为当前改动补测试，先说明计划再动手。" },
  { id: "explain", label: "解释这个项目", prompt: "解释这个项目是做什么的，以及我该从哪里读起。" },
] as const;
