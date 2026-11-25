import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { changelogNotesForVersion, githubReleaseDownloadUrl, isValidReleaseTag } from "../apps/server/src/setup/qingzhou-update.ts";

const [tag = "", repo = "", directory = "dist"] = process.argv.slice(2);
if (!isValidReleaseTag(tag) || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("缺少正式标签或发布仓库。");

const targets = {
  "darwin-aarch64": "Qingzhou-mac-arm64.app.tar.gz",
  "darwin-x86_64": "Qingzhou-mac-x64.app.tar.gz",
  "windows-x86_64": "Qingzhou-win-x64-setup.exe",
};
const platforms = Object.fromEntries(Object.entries(targets).map(([target, artifact]) => {
  if (!statSync(path.join(directory, artifact)).size) throw new Error(`安装资产为空：${artifact}`);
  const signature = readFileSync(path.join(directory, `${artifact}.sig`), "utf8").trim();
  if (!signature) throw new Error(`更新签名为空：${artifact}`);
  return [target, { signature, url: githubReleaseDownloadUrl(repo, tag, artifact) }];
}));

const notes = changelogNotesForVersion(readFileSync("CHANGELOG.md", "utf8"), tag);
const file = path.join(directory, "tauri-update.json");
writeFileSync(file, `${JSON.stringify({ version: tag.slice(1), notes, pub_date: new Date().toISOString(), platforms }, null, 2)}\n`);
console.log(`生成 ${file}（${tag}）`);
