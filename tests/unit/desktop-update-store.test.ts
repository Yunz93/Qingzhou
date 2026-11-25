import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDesktop, type QingzhouDesktopApi } from "../../apps/web/src/desktop-bridge.ts";
import { RELEASES_PAGE_URL, useUpdateStore } from "../../apps/web/src/stores/update-store.ts";

vi.mock("../../apps/web/src/desktop-bridge.ts", () => ({ getDesktop: vi.fn() }));

function mockWindowsRelease(canInstall: boolean) {
  const downloadSignedUpdate = vi.fn().mockResolvedValue(undefined);
  const installSignedUpdate = vi.fn().mockResolvedValue(undefined);
  const desktop: QingzhouDesktopApi = {
    isDesktop: true,
    kind: "tauri",
    platform: "win32",
    pickFolder: async () => null,
    checkSignedUpdate: async () => ({ version: "0.2.0", body: "测试更新", canInstall }),
    downloadSignedUpdate,
    installSignedUpdate,
  };
  vi.mocked(getDesktop).mockReturnValue(desktop);
  return { downloadSignedUpdate, installSignedUpdate };
}

describe("desktop update destination", () => {
  beforeEach(() => {
    useUpdateStore.setState(useUpdateStore.getInitialState(), true);
  });

  it("offers the ZIP when the running copy does not match the installer registration", async () => {
    const { downloadSignedUpdate, installSignedUpdate } = mockWindowsRelease(false);
    await useUpdateStore.getState().check(true);
    expect(useUpdateStore.getState()).toMatchObject({
      latest: "0.2.0",
      updateAvailable: true,
      canUpdate: false,
      url: `${RELEASES_PAGE_URL}/download/v0.2.0/Qingzhou-win-x64-portable.zip`,
    });
    await useUpdateStore.getState().install();
    expect(downloadSignedUpdate).not.toHaveBeenCalled();
    expect(installSignedUpdate).not.toHaveBeenCalled();
  });

  it("allows a registered installation to continue using signed updates", async () => {
    mockWindowsRelease(true);
    await useUpdateStore.getState().check(true);
    expect(useUpdateStore.getState()).toMatchObject({ updateAvailable: true, canUpdate: true, url: RELEASES_PAGE_URL });
  });
});
