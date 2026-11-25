import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { BrowserRouter } from "react-router-dom";
import { AppRouter } from "./router";
import { socketClient } from "../transport/socket-client";
import { SetupWizard, type SetupStatus, setupStorePayload } from "../components/setup/SetupWizard";
import { DesktopMenuBridge } from "../components/desktop/DesktopMenuBridge";
import { useAgentStore } from "../stores/agent-store";
import { applyTheme, readTheme } from "../lib/theme";
import { readDesktopUiError, retryDesktopUiState, subscribeDesktopUiError } from "../lib/desktop-ui-state";

export function App() {
  const storageError = useSyncExternalStore(subscribeDesktopUiError, readDesktopUiError);
  const needsSetup = useAgentStore((state) => state.needsSetup);
  const [checked, setChecked] = useState(false);
  const [showWizard, setShowWizard] = useState(false);

  useLayoutEffect(() => {
    applyTheme(readTheme());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/setup", { credentials: "same-origin" });
        if (response.ok) {
          const setup = (await response.json()) as SetupStatus;
          if (!cancelled) {
            useAgentStore.getState().setSetupState(setupStorePayload(setup));
            setShowWizard(setup.needsSetup);
          }
        }
      } catch {
        // Socket connect will surface connection issues.
      } finally {
        if (!cancelled) setChecked(true);
      }
      await socketClient.connect();
    })();
    return () => {
      cancelled = true;
      socketClient.disconnect();
    };
  }, []);

  return (
    <BrowserRouter>
      <DesktopMenuBridge />
      {storageError ? <div role="alert" className="fixed bottom-3 left-3 right-3 z-50 flex max-w-lg items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm text-danger">{storageError}<button className="btn btn-secondary shrink-0" onClick={retryDesktopUiState}>重试保存</button></div> : null}
      <AppRouter />
      {checked && (showWizard || needsSetup) ? (
        <SetupWizard
          onFinished={(status) => {
            useAgentStore.getState().setSetupState(setupStorePayload(status));
            setShowWizard(false);
            void socketClient.send("snapshot.request");
          }}
        />
      ) : null}
    </BrowserRouter>
  );
}
