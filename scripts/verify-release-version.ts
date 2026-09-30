import { readFileSync } from "node:fs";

const tag = process.argv[2] ?? "";
if (!/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(tag)) {
  throw new Error("发布必须使用 vX.Y.Z 正式版本标签；分支只可运行 verify_only 检查。");
}
for (const file of ["package.json", "apps/desktop/package.json", "apps/server/package.json", "apps/web/package.json", "packages/protocol/package.json"]) {
  const { version } = JSON.parse(readFileSync(file, "utf8")) as { version?: string };
  if (`v${version}` !== tag) throw new Error(`${file} 的版本 ${version} 与发布标签 ${tag} 不一致。`);
}
console.log(`发布版本校验通过：${tag}`);
