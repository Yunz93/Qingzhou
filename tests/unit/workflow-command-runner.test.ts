import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkflowCommandRunner } from "../../apps/server/src/tasks/workflow-command-runner";

const roots: string[] = [];
const runners: WorkflowCommandRunner[] = [];
afterEach(async () => {
  for (const runner of runners.splice(0)) runner.dispose();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const quote = (value: string) => process.platform === "win32" ? `"${value.replaceAll('"', '""')}"` : `'${value.replaceAll("'", "'\\''")}'`;
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "qingzhou-command-")); roots.push(root);
  const runner = new WorkflowCommandRunner(root); runners.push(runner);
  let sequence = 0;
  const command = async (body: string) => {
    const file = path.join(root, `check-${++sequence}.cjs`);
    await writeFile(file, body);
    return `${quote(process.execPath)} ${quote(file)}`;
  };
  return { root, runner, command };
}

it("runs in the requested workspace with isolated verification environment and real exit codes", async () => {
  const f = await fixture();
  const command = await f.command('console.log(JSON.stringify({cwd:process.cwd(),id:process.env.QINGZHOU_VERIFICATION_ID,workspace:process.env.QINGZHOU_WORKSPACE,temp:process.env.TMPDIR}));');
  const result = await f.runner.run(command, f.root, 5000, "verification-a");
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.output)).toEqual({ cwd: await realpath(f.root), id: "verification-a", workspace: f.root, temp: path.join(f.root, "check-env", "verification-a") });
  const failed = await f.runner.run(await f.command('console.error("check failed");process.exit(7);'), f.root, 5000, "verification-b");
  expect(failed).toMatchObject({exitCode:7,truncated:false});
  expect(failed.output).toContain("check failed");
});

it("caps and redacts captured stdout and stderr before returning saved evidence", async () => {
  const f = await fixture();
  const result = await f.runner.run(await f.command('process.stdout.write("authorization: Bearer syntheticToken123456\\n"+"x".repeat(270000));'),f.root,5000,"large");
  expect(result.exitCode).toBe(0);
  expect(result.truncated).toBe(true);
  expect(result.output.length).toBeLessThanOrEqual(256000);
  expect(result.output).not.toContain("syntheticToken123456");
  expect(result.output).toContain("authorization: [已隐藏]");
});

it("terminates a timed out command and allows the next independent check", async () => {
  const f = await fixture();
  const timed = await f.runner.run(await f.command('setInterval(()=>{},1000);'),f.root,150,"slow");
  expect(timed.exitCode).toBeNull();
  expect(timed.output).toContain("检查超时");
  expect((await f.runner.run(await f.command('console.log("recovered");'),f.root,5000,"next")).output).toContain("recovered");
});

it("finishes a failed spawn without hanging", async () => {
  const f = await fixture();
  const result = await f.runner.run("node --version",path.join(f.root,"missing"),5000,"missing");
  expect(result.exitCode).not.toBe(0);
  expect(result.output).toContain("ENOENT");
});

it.skipIf(process.platform === "win32")("disposes the command process group, including descendants, and rejects later work", async () => {
  const f = await fixture();
  const marker = path.join(f.root,"descendant.json");
  const command = await f.command(`const child=require('node:child_process').spawn(process.execPath,['-e','console.log("ready");setInterval(()=>{},1000)']);child.stdout.once('data',()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:child.pid})));setInterval(()=>{},1000);`);
  const pending = f.runner.run(command,f.root,5000,"held");
  await vi.waitFor(async () => expect(JSON.parse(await readFile(marker,"utf8")).pid).toBeTypeOf("number"));
  const {pid} = JSON.parse(await readFile(marker,"utf8")) as {pid:number};
  const other = await f.runner.run(await f.command('console.log("independent");'),f.root,5000,"other");
  expect(other.output).toContain("independent");
  f.runner.dispose();
  expect((await pending).exitCode).toBeNull();
  await vi.waitFor(() => expect(() => process.kill(pid,0)).toThrow());
  expect(await f.runner.run(command,f.root,5000,"late")).toMatchObject({exitCode:null,output:"应用退出，验证中断。"});
});
