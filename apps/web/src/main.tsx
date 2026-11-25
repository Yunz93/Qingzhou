import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { flushDesktopUiState, hydrateDesktopUiState } from "./lib/desktop-ui-state";
import { getDesktop } from "./desktop-bridge";
import "./styles/app.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element missing");
}

if (getDesktop()?.kind === "tauri") {
  Object.assign(window, { __qingzhouFlushDrafts: flushDesktopUiState });
}

void hydrateDesktopUiState().then(() => createRoot(root).render(
  <StrictMode><App /></StrictMode>,
));
