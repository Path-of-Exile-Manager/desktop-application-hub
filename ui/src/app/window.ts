import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** Работаем ли внутри Tauri (а не в обычном браузере на `pnpm dev`). */
export const inTauri = isTauri();

/**
 * Управление своим окном без системной рамки (tauri.conf.json: `decorations: false`).
 * Вне Tauri возвращает `null` — кнопки окна не рисуются.
 */
export function useWindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!inTauri) return;
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    win.isMaximized().then(setMaximized);
    win
      .onResized(() => win.isMaximized().then(setMaximized))
      .then((fn) => (unlisten = fn));
    return () => unlisten?.();
  }, []);

  if (!inTauri) return null;
  const win = getCurrentWindow();
  return {
    maximized,
    onMinimize: () => void win.minimize(),
    onToggleMaximize: () => void win.toggleMaximize(),
    onClose: () => void win.close(),
  };
}
