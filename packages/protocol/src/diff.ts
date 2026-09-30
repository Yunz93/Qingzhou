export type DiffLine = {
  type: "equal" | "add" | "remove";
  text: string;
};

function at(grid: number[][], row: number, col: number): number {
  return grid[row]?.[col] ?? 0;
}

export function unifiedDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const n = oldLines.length;
  const m = newLines.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      const row = dp[i];
      if (!row) continue;
      row[j] = oldLines[i] === newLines[j] ? at(dp, i + 1, j + 1) + 1 : Math.max(at(dp, i + 1, j), at(dp, i, j + 1));
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      lines.push({ type: "equal", text: oldLines[i] ?? "" });
      i += 1;
      j += 1;
    } else if (at(dp, i + 1, j) >= at(dp, i, j + 1)) {
      lines.push({ type: "remove", text: oldLines[i] ?? "" });
      i += 1;
    } else {
      lines.push({ type: "add", text: newLines[j] ?? "" });
      j += 1;
    }
  }
  while (i < n) {
    lines.push({ type: "remove", text: oldLines[i] ?? "" });
    i += 1;
  }
  while (j < m) {
    lines.push({ type: "add", text: newLines[j] ?? "" });
    j += 1;
  }
  return lines;
}

export function diffFromApproval(input: {
  oldText?: string;
  newText?: string;
  content?: string;
}): DiffLine[] | null {
  if (typeof input.oldText === "string" && typeof input.newText === "string") {
    return unifiedDiff(input.oldText, input.newText);
  }
  if (typeof input.content === "string") {
    return unifiedDiff("", input.content);
  }
  return null;
}

export type GitPatchFile = {
  path: string;
  lines: DiffLine[];
  binary?: boolean;
};

export type GitDiffBlock =
  | { kind: "skip"; count: number }
  | { kind: "line"; type: DiffLine["type"]; text: string; lineNo: number | null };

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function patchLineCounts(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.type === "add") added += 1;
    if (line.type === "remove") removed += 1;
  }
  return { added, removed };
}

/** Turn parsed patch lines into Cursor-style rows: skip bars between hunks, numbered add/remove/context. */
export function gitDiffBlocks(lines: DiffLine[]): GitDiffBlock[] {
  const blocks: GitDiffBlock[] = [];
  let newLine = 0;
  let oldLine = 0;
  let seenHunk = false;
  for (const line of lines) {
    const hunk = line.type === "equal" ? line.text.match(HUNK_HEADER) : null;
    if (hunk) {
      const nextOld = Number(hunk[1]);
      const nextNew = Number(hunk[2]);
      if (seenHunk && nextNew > newLine + 1) {
        blocks.push({ kind: "skip", count: nextNew - newLine - 1 });
      } else if (!seenHunk && nextNew > 1) {
        blocks.push({ kind: "skip", count: nextNew - 1 });
      }
      oldLine = nextOld - 1;
      newLine = nextNew - 1;
      seenHunk = true;
      continue;
    }
    if (line.type === "remove") {
      oldLine += 1;
      blocks.push({ kind: "line", type: "remove", text: line.text, lineNo: oldLine });
      continue;
    }
    if (line.type === "add") {
      newLine += 1;
      blocks.push({ kind: "line", type: "add", text: line.text, lineNo: newLine });
      continue;
    }
    oldLine += 1;
    newLine += 1;
    blocks.push({ kind: "line", type: "equal", text: line.text, lineNo: newLine });
  }
  return blocks;
}

function stripGitPathPrefix(value: string): string {
  const trimmed = value.trim().replace(/^"(.*)"$/u, "$1");
  if (trimmed === "/dev/null") return trimmed;
  return trimmed.replace(/^[ab]\//u, "");
}

function pathFromDiffGitHeader(header: string): string {
  const quoted = [...header.matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? "");
  if (quoted.length >= 2) return stripGitPathPrefix(quoted[quoted.length - 1] ?? "");
  const match = header.match(/^diff --git a\/(.+) b\/(.+)$/u);
  return stripGitPathPrefix(match?.[2] ?? header.slice("diff --git ".length));
}

/** Turn `git diff` / `git diff HEAD` output into per-file line groups. */
export function parseGitPatch(diff: string): GitPatchFile[] {
  const files: GitPatchFile[] = [];
  let current: GitPatchFile | null = null;
  // 只有在 `diff --git` 之后的文件头区域才认 ---/+++，否则内容行 "++ x" 会被当成 +++ 头丢掉。
  let inHeader = false;
  const raw = diff.replace(/\r\n/g, "\n").split("\n");
  for (const line of raw) {
    if (line.startsWith("diff --git ")) {
      if (current) files.push(current);
      current = { path: pathFromDiffGitHeader(line), lines: [] };
      inHeader = true;
      continue;
    }
    if (!current) continue;
    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      current.binary = true;
      inHeader = false;
      continue;
    }
    if (inHeader && line.startsWith("+++ ")) {
      const next = stripGitPathPrefix(line.slice(4));
      if (next && next !== "/dev/null") current.path = next;
      continue;
    }
    if (
      inHeader &&
      (line.startsWith("--- ") ||
        line.startsWith("index ") ||
        line.startsWith("new file") ||
        line.startsWith("deleted file") ||
        line.startsWith("old mode") ||
        line.startsWith("new mode") ||
        line.startsWith("similarity ") ||
        line.startsWith("rename ") ||
        line.startsWith("copy "))
    ) {
      continue;
    }
    if (line.startsWith("@@")) {
      inHeader = false;
      current.lines.push({ type: "equal", text: line });
      continue;
    }
    inHeader = false;
    if (line.startsWith("+")) {
      current.lines.push({ type: "add", text: line.slice(1) });
      continue;
    }
    if (line.startsWith("-")) {
      current.lines.push({ type: "remove", text: line.slice(1) });
      continue;
    }
    if (line.startsWith("\\") || line.length === 0) continue;
    if (line.startsWith(" ")) {
      current.lines.push({ type: "equal", text: line.slice(1) });
    }
  }
  if (current) files.push(current);
  return files;
}

export function gitPatchForPath(files: GitPatchFile[], entryPath: string): GitPatchFile | undefined {
  const cleaned = entryPath.replace(/^"(.*)"$/u, "$1").split(" -> ").pop()?.trim() ?? entryPath;
  return (
    files.find((file) => file.path === cleaned) ??
    files.find((file) => file.path.endsWith(cleaned) || cleaned.endsWith(file.path))
  );
}
