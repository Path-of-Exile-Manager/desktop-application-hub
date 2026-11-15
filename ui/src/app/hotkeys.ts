import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { ChatCommand } from "@/generated/ChatCommand";
import type { HoldClickSettings } from "@/generated/HoldClickSettings";
import type { HotkeyProblem } from "@/generated/HotkeyProblem";
import { holdClickRangeError, useShell } from "./store";
import { inTauri } from "./window";

// Горячие клавиши в игре (как в Awakened PoE Trade): проверка предмета, команды чата и
// Hold-to-Click. Ядро (src-tauri/src/hotkeys.rs, chat.rs, clicker.rs) регистрирует их, пока игра
// в фокусе, набирает команды и кликает.

export type { HotkeyProblem };

/** Что ядро не смогло назначить — показывается в Настройках у своей строки. */
export const useHotkeyProblems = create<{ problems: HotkeyProblem[] }>(() => ({ problems: [] }));

/** Клавиши из настроек — ядру при запуске и после каждой правки. Ставится один раз в корне приложения. */
export function useGameHotkeysSync() {
  const check = useShell((s) => s.hotkeys.check);
  const commands = useShell((s) => s.chatCommands);
  const holdClick = useShell((s) => s.holdClick);

  useEffect(() => {
    if (!inTauri) return;
    const payload: ChatCommand[] = commands.map((c) => ({ text: c.text, hotkey: c.hotkey, send: c.send }));
    // Неверные диапазоны (ошибка видна в карточке) — Hold-to-Click выключен, пока их не поправят.
    const hold: HoldClickSettings | null = holdClickRangeError(holdClick) ? null : { ...holdClick };
    invoke<HotkeyProblem[]>("hotkeys_set", { check, commands: payload, holdClick: hold }).then(
      (problems) => useHotkeyProblems.setState({ problems }),
      (e) => useHotkeyProblems.setState({ problems: [{ target: "check", command: null, message: String(e) }] }),
    );
  }, [check, commands, holdClick]);
}

/**
 * Идёт запись сочетания в поле клавиши: ядро снимает игровые клавиши и не запускает Hold-to-Click,
 * пока запись не кончится.
 */
export function setHotkeyRecording(recording: boolean) {
  if (inTauri) invoke("hotkeys_recording", { recording }).catch(() => undefined);
}

/** Одинаковые сочетания: порядок модификаторов не важен. */
export function sameKeys(a: string[], b: string[]): boolean {
  return a.length > 0 && a.length === b.length && a.every((k) => b.includes(k));
}
