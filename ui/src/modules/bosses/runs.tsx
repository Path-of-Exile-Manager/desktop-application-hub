import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { toast } from "@/design-system";
import { useShell } from "@/app/store";
import { inTauri } from "@/app/window";
import type { BossRunFinished } from "@/generated/BossRunFinished";
import type { FarmLogSettings } from "@/generated/FarmLogSettings";
import type { FarmLogStatus } from "@/generated/FarmLogStatus";
import type { FarmRunState } from "@/generated/FarmRunState";
import type { FarmRunUpdate } from "@/generated/FarmRunUpdate";
import { clock, markNotKilled } from "./journal";
import { openKillDialog } from "./KillDialog";
import { nameIn } from "./model";
import { useBossesView } from "./store";

// Лог игры (src-tauri/src/farm_log.rs) в интерфейсе: настройки из «Настроек» → ядру, состояние чтения,
// открытый заход (индикатор «Идёт бой» во вкладке) и тост после захода — «Записать дроп?». Ставится
// один раз в корне приложения, поэтому тост приходит на любой вкладке.

export type { BossRunFinished, FarmLogStatus, FarmRunState };

export const useFarmLog = create<{ status: FarmLogStatus | null; run: FarmRunState | null }>(() => ({ status: null, run: null }));

/** Сколько висит тост «Записать дроп?»: без ответа запись остаётся без дропа. */
const TOAST_MS = 60_000;

/** Тост после захода: длительность, смерти и что сделать с записью. */
export function showRunToast(e: BossRunFinished) {
  const name = nameIn(e.bossName, useBossesView.getState().language);
  const deaths = e.run.deaths > 0 ? ` · смертей ${e.run.deaths}` : "";
  if (!e.killId) {
    toast({ status: "warning", title: `${name} — ${clock(e.run.durationSec)}`, description: `Заход не записан в журнал: ${e.error ?? "неизвестная ошибка"}` });
    return;
  }
  const killId = e.killId;
  toast({
    status: "info",
    title: `${name} — ${clock(e.run.durationSec)}${deaths}`,
    description: e.drops > 0 ? `Записан в журнал, в дропе уже ${e.drops} шт. Дополнить?` : "Записан в журнал. Записать дроп?",
    duration: TOAST_MS,
    actions: [
      { label: "Дроп…", primary: true, onClick: () => openKillDialog({ mode: "edit", killId }) },
      {
        label: "Не убил",
        onClick: () => {
          markNotKilled(killId).then(
            () => toast({ status: "success", title: `${name}: заход без убийства`, description: "Вход учтён, дропа нет." }),
            (err: unknown) => toast({ status: "warning", title: "Запись не изменена", description: String(err) }),
          );
        },
      },
      { label: "Скрыть", onClick: () => undefined },
    ],
  });
}

/** Настройки лога → ядру, состояние и заходы ← ядро. */
export function useFarmLogSync() {
  const farmLog = useShell((s) => s.farmLog);

  useEffect(() => {
    if (!inTauri) return;
    const unlisteners = [
      listen<FarmLogStatus>("farm-log-status", (e) => useFarmLog.setState({ status: e.payload, run: e.payload.run })),
      listen<FarmRunUpdate>("farm-run", (e) => useFarmLog.setState({ run: e.payload.run })),
      listen<BossRunFinished>("boss-run-finished", (e) => showRunToast(e.payload)),
    ];
    invoke<FarmLogStatus>("farm_log_status").then((status) => useFarmLog.setState({ status, run: status.run }));
    return () => unlisteners.forEach((p) => void p.then((fn) => fn()));
  }, []);

  useEffect(() => {
    if (!inTauri) return;
    const settings: FarmLogSettings = { enabled: farmLog.enabled, path: farmLog.path?.trim() || null, character: farmLog.character.trim() || null };
    invoke("farm_log_configure", { settings }).catch(() => undefined);
  }, [farmLog]);
}

/** Выбрать `Client.txt` в окне Windows; `null` — отменили. */
export function pickLogFile(current: string | null): Promise<string | null> {
  if (!inTauri) return Promise.resolve(null);
  return invoke<string | null>("farm_log_pick_file", { current });
}
