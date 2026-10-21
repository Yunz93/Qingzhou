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
      { type: "equal", text: "@@ -1,2 +1,2 @@", hunk: { oldStart: 1, newStart: 1 } },
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

it("preserves rename paths, mode changes and octal-quoted UTF-8 paths", () => {
  const renamed = parseGitPatch('diff --git a/old.txt b/new.txt\nsimilarity index 100%\nrename from old.txt\nrename to new.txt\n')[0];
  expect(renamed).toMatchObject({ oldPath: "old.txt", newPath: "new.txt", changeType: "renamed", lines: [] });
  expect(parseGitPatch('diff --git a/run b/run\nold mode 100644\nnew mode 100755\n')[0]).toMatchObject({ oldMode: "100644", newMode: "100755" });
  const quoted = '"a/\\350\\256\\276\\350\\256\\241.md"';
  const target = '"b/\\350\\256\\276\\350\\256\\241.md"';
  expect(parseGitPatch(`diff --git ${quoted} ${target}\n--- ${quoted}\n+++ ${target}\n@@ -1 +1 @@\n-a\n+b\n`)[0]?.path).toBe("设计.md");
});

it("distinguishes escaped backslashes from octal UTF-8 in quoted Git paths", () => {
  const patch = String.raw`diff --git "a/literal\\350.txt" "b/literal\\350.txt"
--- "a/literal\\350.txt"
+++ "b/literal\\350.txt"
@@ -1 +1 @@
-old
+new
`;
  expect(parseGitPatch(patch)[0]?.path).toBe(String.raw`literal\350.txt`);
});

it("bounds the line matrix while preserving all text in a large replacement", () => {
  const old = Array.from({ length: 1100 }, (_, index) => index === 500 ? "shared middle" : `old ${index}`).join("\n");
  const next = Array.from({ length: 1100 }, (_, index) => index === 500 ? "shared middle" : `new ${index}`).join("\n");
  const lines = unifiedDiff(old, next);
  expect(lines.filter((line) => line.type === "equal")).toHaveLength(0);
  expect(lines.filter((line) => line.type !== "add").map((line) => line.text).join("\n")).toBe(old);
  expect(lines.filter((line) => line.type !== "remove").map((line) => line.text).join("\n")).toBe(next);
  expect(unifiedDiff("x\n".repeat(6000), "x\n".repeat(6000))).toHaveLength(6001);
});
