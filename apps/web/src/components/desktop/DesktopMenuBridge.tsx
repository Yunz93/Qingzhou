import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getDesktop } from "../../desktop-bridge";
import { useUpdateStore } from "../../stores/update-store";

export function DesktopMenuBridge() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;
    let idleId: number | undefined;
    let timerId: number | undefined;

    void useUpdateStore.getState().hydrate().then(() => {
      if (cancelled) return;
      if (!useUpdateStore.getState().autoCheckForUpdates) return;
      const run = () => {
        if (!cancelled) void useUpdateStore.getState().check();
      };
      if (typeof window.requestIdleCallback === "function") {
        idleId = window.requestIdleCallback(run, { timeout: 2500 });
      } else {
        timerId = globalThis.setTimeout(run, 1200);
      }
    });

    return () => {
      cancelled = true;
      if (idleId != null) window.cancelIdleCallback(idleId);
      if (timerId != null) window.clearTimeout(timerId);
    };
  }, []);

  useEffect(() => {
    const desktop = getDesktop();
    if (!desktop) return;
    const stopSetup = desktop.onOpenSetup?.(() => {
      navigate("/settings", { state: { from: location.pathname + location.search } });
    });
    const stopUpdate = desktop.onCheckUpdate?.(() => {
      void useUpdateStore.getState().check(true);
    });
    return () => {
      stopSetup?.();
      stopUpdate?.();
    };
  }, [navigate, location.pathname, location.search]);

  return null;
}
