import { describe, expect, it } from "vitest";
import {
  diffFromApproval,
  gitDiffBlocks,
  gitPatchForPath,
  parseGitPatch,
  patchLineCounts,
  unifiedDiff,
} from "../../packages/protocol/src/diff.ts";

describe("unifiedDiff", () => {
  it("marks added and removed lines", () => {
    const lines = unifiedDiff("alpha\nbeta", "alpha\ngamma");
    expect(lines).toEqual([
      { type: "equal", text: "alpha" },
      { type: "remove", text: "beta" },
      { type: "add", text: "gamma" },
    ]);
  });

  it("builds a write preview from content only", () => {
    const lines = diffFromApproval({ content: "hello" });
    expect(lines?.some((line) => line.type === "add" && line.text === "hello")).toBe(true);
  });
});

describe("parseGitPatch", () => {
  it("keeps content that resembles file headers inside hunks", () => {
    const files = parseGitPatch(`diff --git a/note.txt b/note.txt
--- a/note.txt
+++ b/note.txt
@@ -1,2 +1,2 @@
---- old divider
++++ new divider
`);
    expect(files[0]?.path).toBe("note.txt");
    expect(files[0]?.lines).toContainEqual({ type: "remove", text: "--- old divider" });
    expect(files[0]?.lines).toContainEqual({ type: "add", text: "+++ new divider" });
    expect(patchLineCounts(files[0]?.lines ?? [])).toEqual({ added: 1, removed: 1 });
  });

  it("splits unified git output into per-file add/remove lines", () => {
    const files = parseGitPatch(`diff --git a/note.txt b/note.txt
index 111..222 100644
--- a/note.txt
+++ b/note.txt
@@ -1,2 +1,2 @@
 hello
-world
+there
diff --git a/logo.png b/logo.png
index 333..444 100644
Binary files a/logo.png and b/logo.png differ
`);
    expect(files).toHaveLength(2);
    expect(files[0]?.path).toBe("note.txt");
    expect(files[0]?.lines).toEqual([
      { type: "equal", text: "@@ -1,2 +1,2 @@" },
      { type: "equal", text: "hello" },
      { type: "remove", text: "world" },
      { type: "add", text: "there" },
    ]);
    expect(files[1]?.path).toBe("logo.png");
    expect(files[1]?.binary).toBe(true);
    expect(gitPatchForPath(files, "note.txt")?.path).toBe("note.txt");
  });
});

describe("gitDiffBlocks", () => {
  it("numbers replacement lines the same and inserts skip bars between hunks", () => {
    const files = parseGitPatch(`diff --git a/note.txt b/note.txt
--- a/note.txt
+++ b/note.txt
@@ -1,2 +1,2 @@
 hello
-world
+there
@@ -10,1 +10,1 @@
-old
+new
`);
    const blocks = gitDiffBlocks(files[0]?.lines ?? []);
    expect(patchLineCounts(files[0]?.lines ?? [])).toEqual({ added: 2, removed: 2 });
    expect(blocks).toEqual([
      { kind: "line", type: "equal", text: "hello", lineNo: 1 },
      { kind: "line", type: "remove", text: "world", lineNo: 2 },
      { kind: "line", type: "add", text: "there", lineNo: 2 },
      { kind: "skip", count: 7 },
      { kind: "line", type: "remove", text: "old", lineNo: 10 },
      { kind: "line", type: "add", text: "new", lineNo: 10 },
    ]);
  });
});
