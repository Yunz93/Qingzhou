import { describe, expect, it } from "vitest";
import { parseGitPatch, unifiedDiff } from "../../packages/protocol/src/diff";
import { splitDiffRows } from "../../apps/web/src/lib/split-diff";

describe("split diff alignment", () => {
  it("pairs replacements and pads the shorter side without shifting context", () => {
    expect(splitDiffRows(unifiedDiff("same\nold\nend", "same\nnew\nextra\nend"))).toEqual([
      { kind: "line", before: { text: "same", line: 1, changed: false }, after: { text: "same", line: 1, changed: false } },
      { kind: "line", before: { text: "old", line: 2, changed: true }, after: { text: "new", line: 2, changed: true } },
      { kind: "line", before: null, after: { text: "extra", line: 3, changed: true } },
      { kind: "line", before: { text: "end", line: 3, changed: false }, after: { text: "end", line: 4, changed: false } },
    ]);
  });
  it("uses real offsets for multiple hunks, including insertions at zero", () => {
    const patch = 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -0,0 +1,1 @@\n+first\n@@ -10,1 +11,1 @@\n-old\n+new\n';
    const rows = splitDiffRows(parseGitPatch(patch)[0]!.lines);
    expect(rows[1]).toEqual({ kind: "line", before: null, after: { text: "first", line: 1, changed: true } });
    expect(rows[3]).toEqual({ kind: "line", before: { text: "old", line: 10, changed: true }, after: { text: "new", line: 11, changed: true } });
  });
  it("shows an empty side for new/deleted files without a phantom line", () => {
    expect(splitDiffRows(unifiedDiff("", "new"))).toEqual([{ kind: "line", before: null, after: { text: "new", line: 1, changed: true } }]);
    expect(splitDiffRows(unifiedDiff("old", ""))).toEqual([{ kind: "line", before: { text: "old", line: 1, changed: true }, after: null }]);
    expect(splitDiffRows(unifiedDiff("", ""))).toEqual([]);
  });
});

it("does not interpret literal hunk-like document content as Git metadata", () => {
  const rows = splitDiffRows(unifiedDiff("@@ -4 +7 @@\na", "@@ -4 +7 @@\nb"), false);
  expect(rows[0]).toEqual({ kind: "line", before: { text: "@@ -4 +7 @@", line: 1, changed: false }, after: { text: "@@ -4 +7 @@", line: 1, changed: false } });
});

it("keeps hunk-looking context as content after parsing a Git patch", () => {
  const patch = 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1,2 +1,2 @@\n @@ -40 +70 @@\n-old\n+new\n';
  const rows = splitDiffRows(parseGitPatch(patch)[0]!.lines);
  expect(rows[1]).toEqual({ kind: "line", before: { text: "@@ -40 +70 @@", line: 1, changed: false }, after: { text: "@@ -40 +70 @@", line: 1, changed: false } });
  expect(rows[2]).toEqual({ kind: "line", before: { text: "old", line: 2, changed: true }, after: { text: "new", line: 2, changed: true } });
});
