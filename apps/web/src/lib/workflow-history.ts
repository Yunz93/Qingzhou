/** Keep the default replay small; a file is selected before its patch is displayed. */
export function splitWorkflowPatch(patch: string): Array<{ path: string; patch: string }> {
  return patch.split(/(?=^diff --git )/m).filter((part) => part.startsWith("diff --git ")).map((part) => ({
    path: part.split("\n", 1)[0]?.match(/ b\/(.+)$/)?.[1] ?? "文件差异", patch: part,
  }));
}
