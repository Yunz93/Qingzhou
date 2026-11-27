import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const script = path.resolve("scripts/install-macos.sh");

describe("install-macos.sh", () => {
  it("has valid bash syntax", () => {
    execFileSync("bash", ["-n", script]);
  });

  it("prints help without requiring macOS", () => {
    const out = execFileSync("bash", [script, "--help"], { encoding: "utf8" });
    expect(out).toContain("一键安装");
    expect(out).toContain("--trust-only");
    expect(out).toContain("releases/latest/download");
    expect(out).not.toContain("--nightly");
    expect(out).toContain("GitHub Release");
    expect(out).toContain("Yunz93/Qingzhou");
  });

  it("does not expand an empty auth header array", () => {
    const src = readFileSync(script, "utf8");
    expect(src).not.toMatch(/"\$\{auth_header\[@\]\}"/);
    expect(src).toContain("curl_github");
  });

  it("passes a nounset self-test without GitHub tokens", () => {
    const out = execFileSync("bash", [script], {
      encoding: "utf8",
      env: { ...process.env, QINGZHOU_SELF_TEST: "1", GITHUB_TOKEN: "", GH_TOKEN: "" },
    });
    expect(out).toContain("self-test passed");
  });

  it.skipIf(process.platform === "win32").each([
    "same-app", "same-via-link", "copy-failure", "sign-failure", "verify-failure",
    "backup-failure", "replace-failure", "rollback-failure", "another-install", "non-strict-signature", "trust-only",
    ...(process.getuid?.() === 0 ? [] : ["permissions-failure"]),
  ])("preserves a usable installation during %s", (scenario) => {
    const root = mkdtempSync(path.join(os.tmpdir(), "mowen install "));
    const home = path.join(root, "home");
    const applications = path.join(home, "Applications");
    try {
      const installed = path.join(applications, "Qingzhou.app");
      const legacy = path.join(applications, "ohMyPi.app");
      const stage = path.join(applications, ".mowen-install");
      const candidate = path.join(root, "New.app");
      const bin = path.join(root, "bin");
      for (const [app, version] of [[installed, "previous"], [legacy, "legacy"], [candidate, "new"]]) {
        mkdirSync(app, { recursive: true });
        writeFileSync(path.join(app, "version"), version);
      }
      mkdirSync(bin);
      for (const [name, commands] of Object.entries({
        uname: 'echo Darwin',
        sudo: "exit 1",
        xattr: "exit 0",
        spctl: "exit 0",
        open: 'printf "%s" "$1" > "$HOME/opened"',
        cp: `
          if [ "$SCENARIO" = copy-failure ]; then
            for dest do :; done
            mkdir -p "$dest"
            echo partial > "$dest/version"
            exit 1
          fi
          exec /bin/cp "$@"
        `,
        codesign: `
          for app do :; done
          [ -f "$app/version" ] || exit 2
          if [ "$1" = --force ]; then
            echo "$app" > "$HOME/signed"
            if [ "$SCENARIO" = sign-failure ]; then echo damaged > "$app/version"; exit 1; fi
          elif [ "$SCENARIO" = verify-failure ]; then
            exit 1
          elif [ "$SCENARIO" = non-strict-signature ] && [ "$3" = --strict ]; then
            exit 1
          fi
        `,
        mv: `
          if [ "$SCENARIO" = backup-failure ] && [ "$1" = "$INSTALLED" ]; then exit 1; fi
          if [ "$2" = "$INSTALLED" ]; then
            if [ "$SCENARIO" = rollback-failure ]; then exit 1; fi
            if [ "$SCENARIO" = replace-failure ] && [ "$(cat "$1/version")" = new ]; then exit 1; fi
          fi
          exec /bin/mv "$@"
        `,
      })) writeFileSync(path.join(bin, name), `#!/bin/sh\n${commands}\n`, { mode: 0o755 });
      let source = candidate;
      if (scenario === "same-app" || scenario === "trust-only") source = installed;
      if (scenario === "same-via-link") {
        source = path.join(root, "Alias.app");
        symlinkSync(installed, source);
      }
      if (scenario === "another-install") {
        mkdirSync(stage);
        writeFileSync(path.join(stage, "marker"), "active install");
      }
      if (scenario === "permissions-failure") chmodSync(applications, 0o555);
      const args = [script, "--user"];
      if (scenario === "trust-only") args.push("--trust-only");
      const result = spawnSync("bash", [...args, source], {
        encoding: "utf8",
        env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home, CFFIXED_USER_HOME: home, TMPDIR: root, SCENARIO: scenario, INSTALLED: installed },
      });
      if (scenario === "rollback-failure") {
        expect(result.status, result.stderr).not.toBe(0);
        expect(result.stderr).toContain(path.join(stage, "previous"));
        expect(readFileSync(path.join(stage, "previous", "version"), "utf8")).toBe("previous");
        expect(readFileSync(path.join(legacy, "version"), "utf8")).toBe("legacy");
      } else if (scenario === "another-install") {
        expect(result.status, result.stderr).not.toBe(0);
        expect(readFileSync(path.join(stage, "marker"), "utf8")).toBe("active install");
        expect(readFileSync(path.join(installed, "version"), "utf8")).toBe("previous");
      } else if (scenario.endsWith("failure")) {
        expect(result.status, result.stderr).not.toBe(0);
        expect(readFileSync(path.join(installed, "version"), "utf8")).toBe("previous");
        expect(readFileSync(path.join(legacy, "version"), "utf8")).toBe("legacy");
        expect(readdirSync(home)).not.toContain("opened");
        expect(readdirSync(applications).sort()).toEqual(["Qingzhou.app", "ohMyPi.app"]);
      } else {
        expect(result.status, result.stderr).toBe(0);
        expect(result.stderr).toContain(`已完成 macOS 信任处理: ${installed}`);
        if (scenario === "trust-only") {
          expect(readFileSync(path.join(home, "signed"), "utf8").trim()).toBe(installed);
          expect(readdirSync(home)).not.toContain("opened");
        } else {
          expect(readFileSync(path.join(home, "signed"), "utf8").trim()).toBe(path.join(stage, "Qingzhou.app"));
          expect(readFileSync(path.join(home, "opened"), "utf8")).toBe(installed);
          expect(readdirSync(applications)).toEqual(["Qingzhou.app"]);
        }
        expect(readFileSync(path.join(installed, "version"), "utf8")).toBe(scenario === "non-strict-signature" ? "new" : "previous");
      }
    } finally {
      if (scenario === "permissions-failure") chmodSync(applications, 0o755);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("prefers zip over dmg and parses volume paths that contain spaces", () => {
    const src = readFileSync(script, "utf8");
    const zipIndex = src.indexOf('"Qingzhou-mac-${arch}.zip"');
    const dmgIndex = src.indexOf('"Qingzhou-mac-${arch}.dmg"');
    expect(zipIndex).toBeGreaterThan(0);
    expect(dmgIndex).toBeGreaterThan(zipIndex);
    expect(src.indexOf('"Mowen-mac-${arch}.zip"')).toBeGreaterThan(dmgIndex);
    expect(src.indexOf('"ohMyPi-mac-${arch}.zip"')).toBeGreaterThan(src.indexOf('"Mowen-mac-${arch}.dmg"'));
    expect(src).toContain("parse_hdiutil_mount");
    expect(src).not.toMatch(/awk '\/\\\/Volumes/);
    expect(src).toContain("SHA256SUMS.txt");
    expect(src).toContain("verify_release_file");
    expect(src).toContain("checksum_for_name");
    expect(src).toContain("Intel 需要 x64");
    expect(src).not.toMatch(/\$name[，。]/);
    expect(src).toContain("${name}，跳过");
  });

  it.skipIf(process.platform !== "darwin").each(["zip", "dmg", "local", "release", "bad-release", "legacy-zip"])(
    "cleans temporary resources after a %s installation attempt",
    (source) => {
      const root = mkdtempSync(path.join(os.tmpdir(), "qingzhou-install-test-"));
      const home = path.join(root, "home");
      const temp = path.join(root, "temp");
      const bin = path.join(root, "bin");
      const app = path.join(root, "Qingzhou.app");
      const archive = path.join(root, "Qingzhou.zip");
      const dmg = path.join(root, "Qingzhou.dmg");
      const detachLog = path.join(root, "detach.log");
      try {
        for (const dir of [home, temp, bin, app]) mkdirSync(dir);
        writeFileSync(path.join(app, "fixture.txt"), "isolated install\n");
        writeFileSync(dmg, "fake image\n");
        execFileSync("zip", ["-q", "-r", archive, "Qingzhou.app"], { cwd: root });
        for (const [name, commands] of Object.entries({
          sudo: "exit 1",
          xattr: "exit 0",
          codesign: "exit 0",
          spctl: "exit 0",
          hdiutil: String.raw`
            case "$1" in
              attach) cp -R "$FIXTURE_APP" "$7/Mowen.app" ;;
              detach) printf '%s\n' "$2" >> "$FIXTURE_DETACH_LOG" ;;
              *) exit 1 ;;
            esac
          `,
          curl: String.raw`
            while [ "$1" != -o ]; do shift; done
            case "$3" in
              */SHA256SUMS.txt)
                asset_file="Qingzhou-mac-$(uname -m | sed 's/x86_64/x64/').zip"
                digest="$(shasum -a 256 "$FIXTURE_ZIP" | cut -d ' ' -f 1)"
                if [ "$FIXTURE_SOURCE" = bad-release ]; then
                  digest=0000000000000000000000000000000000000000000000000000000000000000
                fi
                printf '%s  dist/%s\n' "$digest" "$asset_file" > "$2"
                ;;
              */Qingzhou-mac-*.zip) cp "$FIXTURE_ZIP" "$2" ;;
              *) exit 22 ;;
            esac
          `,
        })) writeFileSync(path.join(bin, name), `#!/bin/sh\n${commands}\n`, { mode: 0o755 });
        const args = [script, "--user", "--no-open"];
        if (source === "zip" || source === "legacy-zip") args.push(archive);
        if (source === "legacy-zip") {
          const previous = path.join(home, "Applications", "Qingzhou.app");
          mkdirSync(previous, { recursive: true });
          writeFileSync(path.join(previous, "fixture.txt"), "previous version\n");
        }
        if (source === "dmg") args.push(dmg);
        if (source === "local") {
          const scripts = path.join(root, "scripts");
          const release = path.join(root, "apps", "desktop", "release");
          const intel = execFileSync("/bin/bash", ["-c", "uname -m"], { encoding: "utf8" }).trim() === "x86_64";
          mkdirSync(scripts);
          mkdirSync(release, { recursive: true });
          args[0] = path.join(scripts, "install-macos.sh");
          copyFileSync(script, args[0]);
          copyFileSync(archive, path.join(release, `Qingzhou-mac-${intel ? "x64" : "arm64"}.zip`));
          copyFileSync(dmg, path.join(release, `Qingzhou-mac-${intel ? "arm64" : "x64"}.dmg`));
          args.push("--local");
        }
        const result = spawnSync("/bin/bash", args, {
          encoding: "utf8",
          env: {
            ...process.env,
            HOME: home,
            TMPDIR: temp,
            PATH: `${bin}:${process.env.PATH}`,
            GITHUB_TOKEN: "",
            GH_TOKEN: "",
            QINGZHOU_VERSION: "latest",
            QINGZHOU_UPDATE_PARENT_PID: "",
            FIXTURE_APP: app,
            FIXTURE_ZIP: archive,
            FIXTURE_SOURCE: source,
            FIXTURE_DETACH_LOG: detachLog,
          },
        });
        const installedBundle = source === "legacy-zip" ? "Qingzhou.app" : "Mowen.app";
        const installed = path.join(home, "Applications", installedBundle, "fixture.txt");
        if (source === "bad-release") {
          expect(result.status, result.stderr).not.toBe(0);
          expect(result.stderr).toContain("校验和不匹配");
          expect(readdirSync(home)).toEqual([]);
        } else {
          expect(result.status, result.stderr).toBe(0);
          expect(readFileSync(installed, "utf8")).toBe("isolated install\n");
          expect(readdirSync(path.join(home, "Applications"))).toEqual([installedBundle]);
        }
        if (source === "dmg") expect(readFileSync(detachLog, "utf8").trim()).toMatch(/\/volume$/);
        if (source === "local") expect(readdirSync(root)).not.toContain("detach.log");
        expect(readdirSync(temp)).toEqual([]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    20_000,
  );
});


it.each([{ args: ["--nightly"] }, { args: ["--version", "nightly"] }, { args: ["--version", "main"] }])("rejects unsupported release selection %j before installing", ({ args }) => {
  const result = spawnSync("bash", [script, ...args], { encoding: "utf8", env: { ...process.env, QINGZHOU_SELF_TEST: "1" } });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(/未知选项|正式版本号/);
});
