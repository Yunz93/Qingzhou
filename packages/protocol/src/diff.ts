export type DiffLine = {
  type: "equal" | "add" | "remove";
  text: string;
  hunk?: { oldStart: number; newStart: number };
};

function at(grid: number[][], row: number, col: number): number {
  return grid[row]?.[col] ?? 0;
}

export function unifiedDiff(oldText: string, newText: string): DiffLine[] {
  return diffLines(oldText === "" ? [] : oldText.split("\n"), newText === "" ? [] : newText.split("\n"));
}

function diffLines(oldLines: string[], newLines: string[]): DiffLine[] {
  if (oldLines.length === newLines.length && oldLines.every((line, index) => line === newLines[index])) return oldLines.map((text) => ({ type: "equal", text }));
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++;
  let suffix = 0;
  while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]) suffix++;
  if (prefix || suffix) return [
    ...oldLines.slice(0, prefix).map((text): DiffLine => ({ type: "equal", text })),
    ...diffLines(oldLines.slice(prefix, oldLines.length - suffix), newLines.slice(prefix, newLines.length - suffix)),
    ...oldLines.slice(oldLines.length - suffix).map((text): DiffLine => ({ type: "equal", text })),
  ];
  const n = oldLines.length;
  const m = newLines.length;
  // Keep all text while bounding synchronous memory use for large documents.
  if ((n + 1) * (m + 1) > 1_000_000) return [
    ...oldLines.map((text): DiffLine => ({ type: "remove", text })),
    ...newLines.map((text): DiffLine => ({ type: "add", text })),
  ];
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
  oldPath?: string;
  newPath?: string;
  changeType?: "added" | "deleted" | "renamed" | "modified";
  oldMode?: string;
  newMode?: string;
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
    const hunk = line.hunk;
    if (hunk) {
      const nextOld = hunk.oldStart;
      const nextNew = hunk.newStart;
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
  const trimmed = decodeGitPath(value.trim());
  if (trimmed === "/dev/null") return trimmed;
  return trimmed.replace(/^[ab]\//u, "");
}

function decodeGitPath(value: string): string {
  if (!value.startsWith('"')) return value;
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  for (const [token] of value.slice(1, -1).matchAll(/\\(?:[0-7]{1,3}|.)|[^\\]+/gs)) {
    if (/^\\[0-7]/.test(token)) bytes.push(parseInt(token.slice(1), 8));
    else {
      const escapes: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13 };
      const escaped = token.startsWith("\\") ? token.slice(1) : null;
      if (escaped && escapes[escaped] !== undefined) bytes.push(escapes[escaped]!);
      else bytes.push(...encoder.encode(escaped ?? token));
    }
  }
  return new TextDecoder().decode(Uint8Array.from(bytes));
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
      const paths = line.slice(11).match(/"(?:\\.|[^"\\])*"|\S+/g);
      current = { path: pathFromDiffGitHeader(line), lines: [], changeType: "modified" };
      if (paths?.length === 2) {
        current.oldPath = stripGitPathPrefix(paths[0]!);
        current.newPath = stripGitPathPrefix(paths[1]!);
        current.path = current.newPath;
      }
      inHeader = true;
      continue;
    }
    if (!current) continue;
    if (inHeader && /^(?:new file mode|deleted file mode|old mode|new mode) /.test(line)) {
      const mode = line.split(" ").at(-1)!;
      if (line.startsWith("new file")) { current.changeType = "added"; current.oldPath = "/dev/null"; current.newMode = mode; }
      else if (line.startsWith("deleted file")) { current.changeType = "deleted"; current.newPath = "/dev/null"; current.oldMode = mode; }
      else if (line.startsWith("old mode")) current.oldMode = mode;
      else current.newMode = mode;
      continue;
    }
    if (inHeader && /^rename (?:from|to) /.test(line)) {
      current.changeType = "renamed";
      if (line.startsWith("rename from ")) current.oldPath = decodeGitPath(line.slice(12));
      else { current.newPath = decodeGitPath(line.slice(10)); current.path = current.newPath; }
      continue;
    }
    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      current.binary = true;
      inHeader = false;
      continue;
    }
    if (inHeader && line.startsWith("+++ ")) {
      const next = stripGitPathPrefix(line.slice(4));
      current.newPath = next;
      if (next === "/dev/null") current.changeType = "deleted";
      if (next && next !== "/dev/null") current.path = next;
      continue;
    }
    if (inHeader && line.startsWith("--- ")) {
      current.oldPath = stripGitPathPrefix(line.slice(4));
      if (current.oldPath === "/dev/null") current.changeType = "added";
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
    const hunk = line.match(HUNK_HEADER);
    if (hunk) {
      inHeader = false;
      current.lines.push({ type: "equal", text: line, hunk: { oldStart: Number(hunk[1]), newStart: Number(hunk[2]) } });
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
