import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CheckpointStore, checkpointSnapshotPath } from "../../apps/server/src/tasks/checkpoints.ts";

describe("checkpoints", () => {
  it.each([
    { label: "POSIX absolute legacy path", api: path.posix, root: "/data/checkpoints/task/id", file: "/project/src/note.ts", expected: "/data/checkpoints/task/id/project/src/note.ts" },
    { label: "Windows drive path", api: path.win32, root: "C:\\data\\checkpoints\\task\\id", file: "D:\\project\\src\\note.ts", expected: "C:\\data\\checkpoints\\task\\id\\project\\src\\note.ts" },
    { label: "Windows UNC legacy path", api: path.win32, root: "C:\\data\\checkpoints\\task\\id", file: "\\\\server\\share\\src\\note.ts", expected: "C:\\data\\checkpoints\\task\\id\\server\\share\\src\\note.ts" },
    { label: "Windows relative path", api: path.win32, root: "C:\\data\\checkpoints\\task\\id", file: "src\\note.ts", expected: "C:\\data\\checkpoints\\task\\id\\src\\note.ts" },
  ])("stores $label under the checkpoint directory", ({ api, root, file, expected }) => {
    expect(checkpointSnapshotPath(root, file, api)).toBe(expected);
  });

  it("saves a file and restores it", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qingzhou-check-"));
    const project = path.join(root, "project");
    const data = path.join(root, "data");
    await mkdir(project, { recursive: true });
    const file = path.join(project, "note.txt");
    await writeFile(file, "before");
    const store = new CheckpointStore(data);
    const saved = await store.save("task-1", project, "note.txt", "edit");
    expect(saved?.path).toBe("note.txt");
    await writeFile(file, "after");
    await store.restore("task-1", saved!.id, project);
    expect(await readFile(file, "utf8")).toBe("before");
  });

  it("restores the latest checkpoint for a path", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qingzhou-check-path-"));
    const project = path.join(root, "project");
    const data = path.join(root, "data");
    await mkdir(project, { recursive: true });
    const file = path.join(project, "note.txt");
    await writeFile(file, "one");
    const store = new CheckpointStore(data);
    await store.save("task-1", project, "note.txt", "edit");
    await writeFile(file, "two");
    await store.save("task-1", project, "note.txt", "edit");
    await writeFile(file, "three");
    await store.restoreLatestByPath("task-1", "note.txt", project);
    expect(await readFile(file, "utf8")).toBe("two");
  });

  it("restores only the exact file when a newer checkpoint shares its basename", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qingzhou-check-exact-"));
    const project = path.join(root, "project");
    await mkdir(path.join(project, "src"), { recursive: true });
    const rootFile = path.join(project, "note.ts");
    const nestedFile = path.join(project, "src", "note.ts");
    const store = new CheckpointStore(path.join(root, "data"));
    await writeFile(rootFile, "root-before");
    await writeFile(nestedFile, "nested-before");
    // Cover legacy absolute paths as well as relative paths in the same index.
    await store.save("task-1", project, rootFile, "edit");
    await store.save("task-1", project, "src/note.ts", "edit");
    await writeFile(rootFile, "root-after");
    await writeFile(nestedFile, "nested-after");

    const restored = await store.restoreLatestByPath("task-1", "./note.ts", project);
    expect(restored.path).toBe(rootFile);
    expect(await readFile(rootFile, "utf8")).toBe("root-before");
    expect(await readFile(nestedFile, "utf8")).toBe("nested-after");
    await store.restoreLatestByPath("task-1", nestedFile, project);
    expect(await readFile(nestedFile, "utf8")).toBe("nested-before");
    await expect(store.restoreLatestByPath("task-1", "other/note.ts", project)).rejects.toThrow(/找不到/);
  });
});
