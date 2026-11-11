import React from "react";
import ReactDOM from "react-dom/client";
import "./design-system/styles.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { useShell } from "./app/store";
import { inTauri } from "./app/window";
import { OverlayApp } from "./overlay/OverlayApp";

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
  // demo=clusters — «Выгодные кластеры» с демо-целями (ядра в браузере нет).
  if (q.get("demo") === "clusters") {
    const [{ useClustersData }, { clustersDemo }] = await Promise.all([import("./modules/clusters/useClusters"), import("./modules/clusters/demo")]);
    useClustersData.setState(clustersDemo());
  }
}

// Тот же фронтенд и для оверлея поверх игры (src-tauri/src/overlay.rs): какое окно — по его метке.
const isOverlay = inTauri && getCurrentWindow().label === "overlay";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isOverlay ? <OverlayApp /> : <App />}</React.StrictMode>,
);
