import { afterEach, describe, expect, it, vi } from "vitest";

const desktop = vi.hoisted(() => ({ isPackaged: true, executable: "" }));
vi.mock("../../apps/desktop/node_modules/electron", () => ({
  app: {
    get isPackaged() { return desktop.isPackaged; },
    getPath: () => desktop.executable,
  },
}));

import { packagedAppPath } from "../../apps/desktop/src/main/paths.ts";
import { installedAppPath, windowsInstallWaiterScript } from "../../apps/server/src/setup/qingzhou-update.ts";

afterEach(() => { desktop.isPackaged = true; });

describe("packaged updater paths", () => {
  it("relaunches the Windows executable rather than its installation folder", () => {
    desktop.executable = "C:\\Users\\me\\AppData\\Local\\Programs\\Qingzhou\\Qingzhou.exe";
    const appPath = packagedAppPath("win32");
    expect(appPath).toBe(desktop.executable);
    const target = installedAppPath({ QINGZHOU_APP_PATH: appPath! }, "win32");
    expect(windowsInstallWaiterScript(9, "C:\\Temp\\setup.exe", target)).toContain(
      `Start-Process -FilePath '${desktop.executable}'`,
    );
  });

  it("retains the macOS bundle path and does not update development executables", () => {
    desktop.executable = "/Applications/Qingzhou.app/Contents/MacOS/Qingzhou";
    expect(packagedAppPath("darwin")).toBe("/Applications/Qingzhou.app");
    desktop.isPackaged = false;
    expect(packagedAppPath("win32")).toBeNull();
  });
});
