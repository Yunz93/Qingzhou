import { useLayoutEffect, useRef } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { WorkbenchPage } from "../pages/WorkbenchPage";
import { SettingsPage } from "../pages/SettingsPage";
import { BoardPage } from "../pages/BoardPage";
import { NotFoundPage } from "../pages/NotFoundPage";

export function AppRouter() {
  const location = useLocation();
  const restoreModelAction = useRef(false);
  useLayoutEffect(() => {
    if (location.pathname === "/settings") {
      if (location.state?.restoreModelAction) restoreModelAction.current = true;
      return;
    }
    if (restoreModelAction.current && location.pathname === "/") {
      const target = document.getElementById("conversation-model-action") ?? document.getElementById("main-content");
      target?.focus({ preventScroll: true });
    }
    restoreModelAction.current = false;
  }, [location]);

  return (
    <Routes>
      <Route path="/" element={<WorkbenchPage />} />
      <Route path="/board" element={<BoardPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/404" element={<NotFoundPage />} />
      <Route path="*" element={<Navigate to="/404" replace />} />
    </Routes>
  );
}
