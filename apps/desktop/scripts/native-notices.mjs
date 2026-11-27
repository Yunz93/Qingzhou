import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const supplementsDir = fileURLToPath(new URL("./licenses/native/", import.meta.url));
const noticeName = /^(?:(?:third[-_ ]party|additional)[-_. ])?(?:licen[cs]es?|copying|copyrights?|notices?)(?:$|[-_. ])/i;
const mainNotice = /^(?:licen[cs]es?|copying|copyrights?)(?:$|[-_. ])/i;
const sourceCode = /\.(?:rs|[ch](?:pp)?|java|[cm]?[jt]s|sh|py)$/i;

async function runtimePackages(manifestPath, target) {
  const manifest = path.resolve(manifestPath);
  const common = ["--locked", "--manifest-path", manifest, "--features", "tauri/custom-protocol"];
  const options = { cwd: path.dirname(manifest), env: { ...process.env, CARGO_TERM_COLOR: "never" }, maxBuffer: 64 * 1024 * 1024 };

  // Cargo tree resolves normal features per target without host-only build or proc-macro dependencies.
  const { stdout: tree } = await execute("cargo", [
    "tree", ...common, "--target", target, "--edges", "normal,no-proc-macro", "--prefix", "none", "--format", "{p}",
  ], options);
  const { stdout } = await execute("cargo", [
    "metadata", ...common, "--filter-platform", target, "--format-version", "1",
  ], options);
  const metadata = JSON.parse(stdout);
  const packages = new Map();
  for (const line of new Set(tree.trim().split(/\r?\n/))) {
    const match = /^(\S+) v(\S+)(?:\s|$)/.exec(line);
    if (!match) throw new Error(`无法识别 Cargo 依赖条目：${line}`);
    const candidates = metadata.packages.filter((p) => p.name === match[1] && p.version === match[2]);
    if (candidates.length !== 1) throw new Error(`无法唯一识别原生依赖：${line}`);
    const [pkg] = candidates;
    if (pkg.id !== metadata.resolve.root) packages.set(pkg.id, pkg);
  }
  return [...packages.values()].sort((a, b) => a.id.localeCompare(b.id, "en"));
}

async function collectNotices(root, directory = "", insideNoticeDirectory = false) {
  const files = [];
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const relative = path.posix.join(directory, entry.name);
    const named = noticeName.test(entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectNotices(root, relative, insideNoticeDirectory || named));
    } else if (entry.isFile() && (named || insideNoticeDirectory) && !sourceCode.test(entry.name)) {
      files.push(relative);
    }
  }
  return files;
}

async function packageNotices(pkg, supplements, target) {
  const root = path.dirname(pkg.manifest_path);
  const local = new Set(await collectNotices(root));
  if (pkg.license_file) {
    local.add(path.relative(root, path.resolve(root, pkg.license_file)).split(path.sep).join("/"));
  }
  const notices = await Promise.all([...local].sort().map(async (name) => ({
    source: name, bytes: await readFile(path.resolve(root, name)),
  })));
  // A vendored subdirectory can carry a license different from the crate's own.
  if (pkg.license_file || [...local].some((name) => mainNotice.test(name.split("/")[0]))) return notices;
  const packageId = `${pkg.name}@${pkg.version}`;
  const supplement = supplements.find((entry) => entry.packages.includes(packageId));
  if (!supplement) throw new Error(`原生依赖缺少许可证声明：${packageId}`);
  const revision = JSON.parse(await readFile(path.join(root, ".cargo_vcs_info.json"), "utf8")).git.sha1;
  if (pkg.repository !== supplement.repository || revision !== supplement.commit) {
    throw new Error(`补充声明的上游版本不匹配：${packageId}`);
  }
  const upstreamNotices = await Promise.all(Object.entries(supplement.files).map(async ([upstream, copy]) => ({
    source: `${supplement.repository}/blob/${revision}/${upstream}`,
    bytes: await readFile(path.join(supplementsDir, copy)),
  })));
  const library = supplement.linkedLibrary;
  if (library?.target === target) {
    const binary = await readFile(path.join(root, library.file));
    if (createHash("sha256").update(binary).digest("hex") !== library.sha256) {
      throw new Error(`原生依赖的随包库与补充声明不匹配：${packageId}/${library.file}`);
    }
    for (const [name, copy] of Object.entries(library.files)) {
      upstreamNotices.push({
        source: `${library.archive}#${name}`,
        bytes: await readFile(path.join(supplementsDir, copy)),
      });
    }
  }
  return [...notices, ...upstreamNotices];
}

export async function stageNativeNotices({ manifestPath, target, runtime }) {
  const packages = await runtimePackages(manifestPath, target);
  const supplements = JSON.parse(await readFile(path.join(supplementsDir, "sources.json"), "utf8"));
  const texts = new Map();
  const entries = [];
  for (const pkg of packages) {
    const notices = await packageNotices(pkg, supplements, target);
    const declared = pkg.license ?? pkg.license_file ?? "";
    const source = pkg.source?.startsWith("registry+https://github.com/rust-lang/crates.io-index")
      ? `https://crates.io/crates/${pkg.name}/${pkg.version}` : pkg.source ?? pkg.repository ?? pkg.name;
    entries.push("", `${pkg.name} ${pkg.version}  ${declared}`, source);
    for (const { source: origin, bytes } of notices) {
      if (!bytes.length || bytes.includes(0)) throw new Error(`原生声明为空或为非文本：${pkg.name}/${origin}`);
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (!texts.has(digest)) texts.set(digest, bytes.toString("utf8"));
      entries.push(`  ${origin}  sha256:${digest}`);
    }
  }
  const header = [`墨问原生桌面第三方声明 · ${target}`, `依赖数：${packages.length}`];
  const sections = [...texts].map(([digest, text]) => `\n-------------------- sha256:${digest} --------------------\n${text}`);
  const destination = path.resolve(runtime, "NATIVE-THIRD-PARTY-LICENSES.txt");
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, [...header, ...entries, ...sections, ""].join("\n"));
  return destination;
}
