import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { bundleService, serviceLicenseNotices } from "../../apps/desktop/scripts/bundle-service.mjs";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "mowen-service-licenses-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function file(name: string, text: string) {
  const target = path.join(root, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, text);
}

it("preserves declared, nested and source notices for contributing package files", async () => {
  const pkg = "node_modules/.pnpm/@example+tool@1.0.0/node_modules/@example/tool";
  const license = "Copyright © 1993\r\nTerms and conditions\r\n";
  const sourceNotice = "/**\n * Copyright © Vendor\n * Permission is hereby granted to use this file.\n */";
  await file(`${pkg}/package.json`, JSON.stringify({ name: "@example/tool", version: "1.0.0", license: "SEE LICENSE IN legal/TERMS.txt" }));
  await file(`${pkg}/legal/TERMS.txt`, license);
  await file(`${pkg}/NOTICE`, "Original attribution.");
  await file(`${pkg}/vendor/License.md`, "Nested terms.");
  await file(`${pkg}/vendor/code.js`, "'use strict'\n" + sourceNotice + "\nexports.fn = 1;");
  await file(`${pkg}/unused/LICENSE`, "Unrelated component.");
  const inputs = {
    "apps/server/index.js": { bytesInOutput: 10 },
    [`${pkg}/vendor/code.js`]: { bytesInOutput: 12 },
    "node_modules/unused/index.js": { bytesInOutput: 0 },
  };
  const text = await serviceLicenseNotices(root, { outputs: { "service.mjs": { inputs } } });
  expect(text).toContain("===== @example/tool@1.0.0 =====");
  expect(text).toContain(license);
  expect(text).toContain("Original attribution.");
  expect(text).toContain("Nested terms.");
  expect(text).toContain(sourceNotice);
  expect(text).not.toContain("Unrelated");
  expect(text).not.toContain("unused");
  expect(text).not.toContain(root);
});

it("rejects an unverified link-only license on a new package version", async () => {
  const pkg = "node_modules/abstract-logging";
  await file(`${pkg}/package.json`, JSON.stringify({ name: "abstract-logging", version: "2.0.2", license: "MIT" }));
  await file(`${pkg}/Readme.md`, "## License\n\n[MIT License](http://jsumners.mit-license.org/)\n");
  await file(`${pkg}/index.js`, "exports.x = 1;");
  const inputs = { [`${pkg}/index.js`]: { bytesInOutput: 10 } };
  await expect(serviceLicenseNotices(root, { outputs: { "service.mjs": { inputs } } })).rejects.toThrow("abstract-logging-2.0.2");
});

it("bundles a working Fastify static route and the exact licenses of its installed dependencies", async () => {
  await symlink(path.resolve("apps/server/node_modules"), path.join(root, "node_modules"), "junction");
  await file("runtime/public/sample.txt", "static glob route works");
  await file("apps/server/dist/desktop-main.js", `
    import Fastify from "fastify";
    import serve from "@fastify/static";
    import lockfile from "proper-lockfile";
    import { fileURLToPath } from "node:url";
    if (typeof lockfile.lock !== "function") throw new Error("Missing lockfile");
    const app = Fastify();
    await app.register(serve, { root: fileURLToPath(new URL("./public", import.meta.url)), wildcard: false });
    const reply = await app.inject("/sample.txt");
    console.log(reply.statusCode, reply.payload);
    await app.close();
  `);
  const runtime = path.join(root, "runtime");
  await bundleService(root, runtime);
  expect(execFileSync(process.execPath, [path.join(runtime, "service.mjs")], { encoding: "utf8" }).trim()).toBe("200 static glob route works");

  const text = await readFile(path.join(runtime, "SERVICE-THIRD-PARTY-LICENSES.txt"), "utf8");
  for (const name of ["fastify", "proper-lockfile"]) {
    const installed = path.join(root, "node_modules", name);
    const manifest = JSON.parse(await readFile(path.join(installed, "package.json"), "utf8"));
    expect(text).toContain(`===== ${name}@${manifest.version} =====\n\n--- LICENSE ---\n${await readFile(path.join(installed, "LICENSE"), "utf8")}`);
  }
  expect(text).toMatch(/^===== minimatch@/m);
  expect(text).toMatch(/^===== balanced-match@/m);
  expect(text).not.toContain("===== node-pty@");
  expect(text).not.toContain("===== @qingzhou/server@");

  // The published abstract-logging@2.0.1 Readme.md links the author's current license.
  // The checked-in copy comes verbatim from https://jsumners.mit-license.org/license.txt on 2026-11-27.
  expect(text).toContain("[MIT License](http://jsumners.mit-license.org/)");
  const authorLicense = await readFile("apps/desktop/scripts/licenses/abstract-logging-2.0.1.txt", "utf8");
  expect(authorLicense).toContain("Copyright © 2026 James Sumners");
  expect(text).toContain(authorLicense);
});
