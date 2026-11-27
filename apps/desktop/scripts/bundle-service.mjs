import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const licenseDir = fileURLToPath(new URL("./licenses/", import.meta.url));
const licenseName = /^(?:(?:[A-Za-z0-9]+[-_. ])?licen[cs]e(?:s)?|copying)(?:[-_. ].*)?$/i;
const noticeName = /^(?:notices?|copyright|third[-_. ]?party[-_. ](?:notices?|licen[cs]es?))(?:[-_. ].*)?$/i;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function readmeLicense(readme) {
  const heading = /^(#{1,6})[ \t]+licen[cs]es?[ \t]*#*[ \t]*\r?$/im.exec(readme);
  if (!heading) return;
  const rest = readme.slice(heading.index + heading[0].length);
  const next = new RegExp(`^#{1,${heading[1].length}}[ \\t]+`, "m").exec(rest);
  return heading[0] + rest.slice(0, next?.index);
}

function sourceNotices(source) {
  const comments = source.matchAll(/^[ \t]*(\/\*[\s\S]*?\*\/|\/\/[^\r\n]*(?:\r?\n[ \t]*\/\/[^\r\n]*)*)/gm);
  return Array.from(comments, ([, comment]) => comment).filter((comment) =>
    /\bcopyright[ \t]+(?:\(c\)|©|[a-z\d])|\bSPDX-License-Identifier:|\bpermission is hereby granted\b|@license\b/i.test(comment));
}

async function packageNotices(packageDir, files) {
  const manifest = JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf8"));
  const title = `${manifest.name}@${manifest.version}`;
  const directories = new Set([packageDir]);
  const documents = new Set();
  const sections = [];
  let rootLicense = false;
  const declaredFile = /^SEE LICEN[CS]E IN (.+)$/i.exec(manifest.license)?.[1];
  if (declaredFile) {
    const absolute = path.resolve(packageDir, declaredFile);
    if (!absolute.startsWith(packageDir + path.sep)) throw new Error(`许可路径超出依赖目录：${title}`);
    documents.add(absolute);
    rootLicense = true;
  }

  for (const file of files) {
    for (let dir = path.dirname(file); !directories.has(dir); dir = path.dirname(dir)) directories.add(dir);
  }
  for (const dir of directories) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !(licenseName.test(entry.name) || noticeName.test(entry.name))) continue;
      documents.add(path.join(dir, entry.name));
      if (dir === packageDir && licenseName.test(entry.name)) rootLicense = true;
    }
  }
  for (const file of [...documents].sort(compare)) {
    const relative = path.relative(packageDir, file).split(path.sep).join("/");
    sections.push(`--- ${relative} ---\n${await readFile(file, "utf8")}`);
  }

  if (!rootLicense) {
    const readme = (await readdir(packageDir)).sort(compare).find((name) => /^readme(?:\.(?:md|txt|rst))?$/i.test(name));
    const excerpt = readme && readmeLicense(await readFile(path.join(packageDir, readme), "utf8"));
    if (!excerpt) throw new Error(`依赖缺少许可原文：${title}`);
    sections.push(`--- ${readme} ---\n${excerpt}`);
    // A license name or link alone omits the grant. Ship a versioned copy from the upstream author.
    if (!/\b(?:permission is hereby granted|redistribution and use|licensed under the apache license|free software foundation)\b/i.test(excerpt)) {
      const supplement = `${manifest.name.replaceAll("/", "+")}-${manifest.version}.txt`;
      sections.push(`--- ${supplement} ---\n${await readFile(path.join(licenseDir, supplement), "utf8")}`);
    }
  }

  const seenComments = new Set();
  for (const file of [...files].sort(compare)) {
    if (!/\.[cm]?[jt]sx?$/i.test(file)) continue;
    for (const comment of sourceNotices(await readFile(file, "utf8"))) {
      if (seenComments.has(comment)) continue;
      seenComments.add(comment);
      const relative = path.relative(packageDir, file).split(path.sep).join("/");
      sections.push(`--- ${relative} ---\n${comment}`);
    }
  }
  return `===== ${title} =====\n\n${sections.join("\n\n")}`;
}

export async function serviceLicenseNotices(root, metafile) {
  const packages = new Map();
  for (const output of Object.values(metafile.outputs)) {
    for (const [input, { bytesInOutput }] of Object.entries(output.inputs)) {
      if (!bytesInOutput) continue;
      const file = path.resolve(root, input);
      const parts = file.split(path.sep);
      const modules = parts.lastIndexOf("node_modules");
      if (modules < 0) continue;
      const end = modules + (parts[modules + 1].startsWith("@") ? 3 : 2);
      const dir = parts.slice(0, end).join(path.sep);
      if (!packages.has(dir)) packages.set(dir, new Set());
      packages.get(dir).add(file);
    }
  }
  const sections = [];
  for (const [dir, files] of packages) sections.push(await packageNotices(dir, files));
  return "Third-party licenses and notices for service.mjs\n\n" + sections.sort(compare).join("\n\n") + "\n";
}

export async function bundleService(root, runtime) {
  const { metafile } = await build({
    absWorkingDir: root,
    entryPoints: [path.join(root, "apps/server/dist/desktop-main.js")],
    outfile: path.resolve(runtime, "service.mjs"),
    platform: "node",
    format: "esm",
    target: "node22",
    bundle: true,
    metafile: true,
    external: ["node-pty"],
    // glob's default entry embeds six libraries without their license files or package metadata.
    // Its public raw entry exposes the same API and lets esbuild trace their installed sources.
    plugins: [{
      name: "trace-glob-dependencies",
      setup(build) {
        build.onResolve({ filter: /^glob$/ }, ({ kind, resolveDir }) => build.resolve("glob/raw", { kind, resolveDir }));
      },
    }],
    banner: { js: "import { createRequire as bundleRequire } from 'node:module'; import { fileURLToPath as bundlePath } from 'node:url'; const require = bundleRequire(import.meta.url); const __dirname = bundlePath(new URL('.', import.meta.url));" },
  });
  await writeFile(path.join(runtime, "SERVICE-THIRD-PARTY-LICENSES.txt"), await serviceLicenseNotices(root, metafile));
}
