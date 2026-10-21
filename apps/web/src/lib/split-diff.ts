import type { DiffLine } from "@qingzhou/protocol";

export type DiffCell = { text: string; line: number; changed: boolean };
export type SplitDiffRow = { kind: "line"; before: DiffCell | null; after: DiffCell | null } | { kind: "hunk"; text: string };

/** Pair replacement blocks while keeping independent old/new hunk offsets. */
export function splitDiffRows(lines: DiffLine[], parseHunks = true): SplitDiffRow[] {
  const rows: SplitDiffRow[] = [];
  let oldLine = 1;
  let newLine = 1;
  let removed: DiffCell[] = [];
  let added: DiffCell[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(removed.length, added.length); i++) rows.push({ kind: "line", before: removed[i] ?? null, after: added[i] ?? null });
    removed = []; added = [];
  };
  for (const entry of lines) {
    const hunk = parseHunks ? entry.hunk : undefined;
    if (hunk) {
      flush(); oldLine = hunk.oldStart; newLine = hunk.newStart;
      rows.push({ kind: "hunk", text: entry.text });
    } else if (entry.type === "remove") removed.push({ text: entry.text, line: oldLine++, changed: true });
    else if (entry.type === "add") added.push({ text: entry.text, line: newLine++, changed: true });
    else {
      flush();
      rows.push({ kind: "line", before: { text: entry.text, line: oldLine++, changed: false }, after: { text: entry.text, line: newLine++, changed: false } });
    }
  }
  flush();
  return rows;
}
