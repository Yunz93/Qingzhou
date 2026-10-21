import { expect, it } from "vitest";
import type { Verification } from "../../packages/protocol/src/workflow";
import { changedTests, testCounts } from "../../apps/web/src/lib/test-evidence";
const check = (output: string, options: Partial<Verification["checks"][number]> = {}): Verification["checks"][number] => ({ id: "unit", name: "unit", command: "test", required: true, cwd: "/tmp", startedAt: "2026-10-20T00:00:00Z", finishedAt: "2026-10-20T00:01:00Z", exitCode: 0, status: "passed", output, truncated: false, ...options });
it("recognizes test file changes, including a renamed test, without classifying source as tests", () => {
  const patch = ['tests/a.ts', 'src/a.test.tsx', 'test_a.py', 'src/source.ts'].map((file) => `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-old\n+new\n`).join('');
  expect(changedTests(patch).map((f) => f.path)).toEqual(['tests/a.ts', 'src/a.test.tsx', 'test_a.py']);
});
it("reads explicit test counts without counting suites, progress, or exit status as cases", () => {
  expect(testCounts(check('Test Files  3 passed (3)\n Tests  9 passed | 2 failed | 1 skipped (12)'))).toEqual({ passed: 9, failed: 2, skipped: 1 });
  expect(testCounts(check('# pass 8\n# fail 0\n# skipped 1'))).toEqual({ passed: 8, failed: 0, skipped: 1 });
  expect(testCounts(check('command passed'))).toBeNull();
  expect(testCounts(check('Tests 3 passed (3)\nTests 5 passed (5)'))).toBeNull();
  expect(testCounts(check('# pass 1\n# fail 0\n# cancelled 1'))).toBeNull();
  expect(testCounts(check('Tests 5 passed (5)', { truncated: true }))).toBeNull();
  expect(testCounts(check('Tests 5 passed (5)', { finishedAt: null, status: 'running' }))).toBeNull();
});

it("reads individual flat TAP results without guessing from a passing command or nested suite", async () => {
  const { testCaseResults } = await import("../../apps/web/src/lib/test-evidence");
  expect(testCaseResults(check('TAP version 13\nok 1 - empty name\nnot ok 2 - null name\nok 3 - optional # SKIP unavailable\n# pass 1\n# fail 1\n# skipped 1'))).toEqual([
    { name: 'empty name', status: 'passed' }, { name: 'null name', status: 'failed' }, { name: 'optional', status: 'skipped' },
  ]);
  expect(testCaseResults(check('command passed'))).toEqual([]);
  expect(testCaseResults(check('ok 1 - suite\n    ok 1 - nested\n# pass 1\n# fail 0'))).toEqual([]);
  expect(testCaseResults(check('ok 1 - case\n# pass 1\n# fail 0', { truncated: true }))).toEqual([]);
});
it("extracts only static declarations from changed tests and retains file-only changes", async () => {
  const { changedTestCases } = await import("../../apps/web/src/lib/test-evidence");
  const patch = 'diff --git a/tests/name.test.js b/tests/name.test.js\n--- a/tests/name.test.js\n+++ b/tests/name.test.js\n@@ -8 +8,2 @@\n-test("same", () => {});\n+test("same", () => { assert(true); });\n+it("new", () => {});\n';
  expect(changedTestCases(patch)).toEqual([
    { file: 'tests/name.test.js', name: 'same', change: '修改', line: 8 },
    { file: 'tests/name.test.js', name: 'new', change: '新增', line: 9 },
  ]);
  expect(changedTestCases('diff --git a/tests/a.js b/tests/a.js\n--- a/tests/a.js\n+++ b/tests/a.js\n@@ -3 +3 @@\n-assert(false);\n+assert(true);\n')).toEqual([{ file: 'tests/a.js', name: 'tests/a.js', change: '修改' }]);
});
