import { useEffect, useRef } from "react";

/** Совпадает ли событие с сочетанием вида `"Ctrl+K"`, `"Esc"`, `"Ctrl+Shift+P"`. */
export function matchesHotkey(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.split("+").map((p) => p.trim().toLowerCase());
  const key = parts.pop() ?? "";
  const want = { ctrl: parts.includes("ctrl"), alt: parts.includes("alt"), shift: parts.includes("shift") };
  if (e.ctrlKey !== want.ctrl || e.altKey !== want.alt || e.shiftKey !== want.shift) return false;
  const pressed = e.key.toLowerCase();
  const aliases: Record<string, string> = { esc: "escape", enter: "enter", space: " " };
  return pressed === (aliases[key] ?? key) || e.code.toLowerCase() === `key${key}`;
}

/**
 * Горячая клавиша внутри окна приложения (не глобальная — глобальные ловит Rust-ядро).
 * `useHotkey("Ctrl+K", () => setPaletteOpen(true))`
 */
export function useHotkey(combo: string, handler: (e: KeyboardEvent) => void, enabled = true) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (matchesHotkey(e, combo)) {
        e.preventDefault();
        handlerRef.current(e);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [combo, enabled]);
}
