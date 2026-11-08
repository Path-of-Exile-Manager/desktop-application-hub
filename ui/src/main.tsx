import React from "react";
import ReactDOM from "react-dom/client";
import "./design-system/styles.css";
import App from "./App";
import { useShell } from "./app/store";

// Только для разработки: открыть нужное состояние по адресу, например
// http://localhost:1420/?module=craft&collapsed=1&panel=hidden&demo=problems
// или http://localhost:1420/?dev=1&module=developer
// (удобно для скриншотов и сверки с макетами — scripts/screenshots.ps1).
if (import.meta.env.DEV) {
  const q = new URLSearchParams(location.search);
  const s = useShell.getState();
  // dev=1 — включить режим разработчика (иначе «Режим разработки» и «Витрина» скрыты).
  if (q.has("dev")) s.setDeveloperMode(q.get("dev") === "1");
  const module = q.get("module");
  if (module) s.openModule(module);
  if (q.has("collapsed")) s.setSidebarCollapsed(q.get("collapsed") === "1");
  if (q.has("panel")) s.setPanelHidden(q.get("panel") === "hidden");
  if (q.get("demo") === "problems") s.setSim("game", "off");
  if (q.get("palette") === "1") s.setPaletteOpen(true);
  // demo=ancient — заменить учёт Ancient Orb демо-данными (затирает свои!).
  if (q.get("demo") === "ancient") {
    const [{ useAncientOrb }, { ancientDemoData }] = await Promise.all([
      import("./modules/ancient-orb/store"),
      import("./modules/ancient-orb/demo"),
    ]);
    useAncientOrb.getState().restore(ancientDemoData());
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
