import React from "react";
import ReactDOM from "react-dom/client";
import "./design-system/styles.css";
import App from "./App";
import { useShell } from "./app/store";

// Только для разработки: открыть нужное состояние по адресу, например
// http://localhost:1420/?module=craft&collapsed=1&panel=hidden&demo=problems
// (удобно для скриншотов и сверки с макетами — scripts/screenshots.ps1).
if (import.meta.env.DEV) {
  const q = new URLSearchParams(location.search);
  const s = useShell.getState();
  const module = q.get("module");
  if (module) s.openModule(module);
  if (q.has("collapsed")) s.setSidebarCollapsed(q.get("collapsed") === "1");
  if (q.has("panel")) s.setPanelHidden(q.get("panel") === "hidden");
  if (q.has("demo")) s.setDemoProblems(q.get("demo") === "problems");
  if (q.get("palette") === "1") s.setPaletteOpen(true);
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
