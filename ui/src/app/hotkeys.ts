import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { ChatCommand } from "@/generated/ChatCommand";
import type { HotkeyProblem } from "@/generated/HotkeyProblem";
import { useShell } from "./store";
import { inTauri } from "./window";

// Горячие клавиши в игре (как в Awakened PoE Trade): проверка предмета и команды чата. Ядро
// (src-tauri/src/hotkeys.rs, chat.rs) регистрирует их, пока игра в фокусе, и набирает команды.

export type { HotkeyProblem };

/** Что ядро не смогло назначить — показывается в Настройках у своей строки. */
export const useHotkeyProblems = create<{ problems: HotkeyProblem[] }>(() => ({ problems: [] }));

/** Клавиши из настроек — ядру при запуске и после каждой правки. Ставится один раз в корне приложения. */
export function useGameHotkeysSync() {
  const check = useShell((s) => s.hotkeys.check);
  const commands = useShell((s) => s.chatCommands);

  useEffect(() => {
    if (!inTauri) return;
    const payload: ChatCommand[] = commands.map((c) => ({ text: c.text, hotkey: c.hotkey, send: c.send }));
    invoke<HotkeyProblem[]>("hotkeys_set", { check, commands: payload }).then(
      (problems) => useHotkeyProblems.setState({ problems }),
      (e) => useHotkeyProblems.setState({ problems: [{ command: null, message: String(e) }] }),
    );
  }, [check, commands]);
}
