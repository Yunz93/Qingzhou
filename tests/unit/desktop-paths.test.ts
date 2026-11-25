import { describe, expect, it } from "vitest";
import { installedAppPath, windowsInstallWaiterScript } from "../../apps/server/src/setup/qingzhou-update.ts";

describe("legacy updater paths", () => {
  it("relaunches the Windows executable that invoked the update", () => {
    const executable = "C:\\Users\\me\\AppData\\Local\\Programs\\Qingzhou\\Qingzhou.exe";
    const target = installedAppPath({ QINGZHOU_APP_PATH: executable }, "win32");
    expect(windowsInstallWaiterScript(9, "C:\\Temp\\setup.exe", target)).toContain(
      `Start-Process -FilePath '${executable}'`,
    );
  });
});
