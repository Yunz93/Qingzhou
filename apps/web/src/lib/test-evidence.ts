import { parseGitPatch, type Verification } from "@qingzhou/protocol";

export function changedTests(patch: string) {
  return parseGitPatch(patch).filter((file) => [file.path, file.oldPath ?? ""].some((path) => /(?:^|\/)(?:tests?|__tests__|specs?)(?:\/|$)|(?:\.|_)(?:test|spec)\.[^/]+$|(?:^|\/)test_[^/]+\.[^/]+$/.test(path)));
}

/** Only completed, untruncated command output with an explicit summary is countable. */
export function testCounts(check: Verification["checks"][number]): { passed: number; failed: number; skipped: number } | null {
  if (!check.finishedAt || check.truncated || check.exitCode === null || !["passed", "failed"].includes(check.status)) return null;
  const output = check.output.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");
  const passes = [...output.matchAll(/^# pass (\d+)\s*$/gm)];
  const failures = [...output.matchAll(/^# fail (\d+)\s*$/gm)];
  if (passes.length > 1 || failures.length > 1 || /^# cancelled [1-9]\d*\s*$/m.test(output)) return null;
  const tapPassed = passes[0];
  const tapFailed = failures[0];
  if (tapPassed && tapFailed) return { passed: Number(tapPassed[1]), failed: Number(tapFailed[1]), skipped: Number([...output.matchAll(/^# skipped (\d+)\s*$/gm)].at(-1)?.[1] ?? 0) + Number([...output.matchAll(/^# todo (\d+)\s*$/gm)].at(-1)?.[1] ?? 0) };
  // Use a single final Tests line; never count Test Files or progress messages.
  const summaries = [...output.matchAll(/^[ \t]*Tests[: \t]+([^\n]+)$/gm)];
  if (summaries.length !== 1) return null;
  const summary = summaries[0]?.[1];
  if (!summary) return null;
  const count = (word: string) => Number(summary.match(new RegExp(`(\\d+)\\s+${word}\\b`))?.[1] ?? 0);
  if (!/\d+\s+(?:passed|failed|skipped|todo)\b/.test(summary)) return null;
  return { passed: count("passed"), failed: count("failed"), skipped: count("skipped") + count("todo") };
}

export type TestCaseResult = { name: string; status: "passed" | "failed" | "skipped" };
export function testCaseResults(check: Verification["checks"][number]): TestCaseResult[] {
  if (!testCounts(check)) return [];
  const output = check.output.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");
  // Flat TAP identifies individual cases. Nested suites require a structured reporter.
  if (/^\s+(?:not )?ok \d+/m.test(output) || /type:\s*['"]?suite/.test(output)) return [];
  return [...output.matchAll(/^(ok|not ok) \d+ - (.+?)(?:\s+#\s*(SKIP|TODO)\b.*)?\r?$/gm)].map((match) => ({
    name: match[2]!.trim(), status: match[3] ? "skipped" : match[1] === "ok" ? "passed" : "failed",
  }));
}

export type ChangedTestCase = { file: string; name: string; change: "新增" | "修改" | "删除"; line?: number };
const caseDeclaration = /(?:\b(?:it|test)(?:\.(?:only|skip|todo))?|require\(['"]node:test['"]\))\s*\(\s*(['"`])([^'"`]+)\1/;
export function changedTestCases(patch: string): ChangedTestCase[] {
  return changedTests(patch).flatMap((file) => {
    const added = new Map<string, number>();
    const removed = new Set<string>();
    let line = 1;
    for (const entry of file.lines) {
      const hunk = entry.hunk;
      if (hunk) { line = hunk.newStart; continue; }
      const name = entry.text.match(caseDeclaration)?.[2];
      if (name && !name.includes("${")) {
        if (entry.type === "add") added.set(name, line);
        if (entry.type === "remove") removed.add(name);
      }
      if (entry.type !== "remove") line++;
    }
    const rows: ChangedTestCase[] = [...added].map(([name, line]) => ({ file: file.path, name, line, change: removed.has(name) ? "修改" : "新增" }));
    for (const name of removed) if (!added.has(name)) rows.push({ file: file.path, name, change: "删除" });
    return rows.length ? rows : [{ file: file.path, name: file.path, change: file.changeType === "added" ? "新增" : file.changeType === "deleted" ? "删除" : "修改" }];
  });
}
