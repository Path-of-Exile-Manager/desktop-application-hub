import { useEffect, type ReactNode } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { PRICE_MODES, PriceDisplayProvider, PriceModeSelect, type PriceMode } from "@/design-system";
import { usePrices } from "./prices";
import { inTauri } from "./window";

// Валюта показа цен (shared/docs/price-currency.md). Выбор общий для главного окна и оверлея:
// хранится в localStorage (у окон он общий), а о смене окна узнают событием Tauri — сам zustand
// чужую запись в хранилище не подхватывает.

const STORAGE_KEY = "poe-manager.price-mode";
const EVENT = "price-mode-changed";

export const usePriceMode = create<{ mode: PriceMode; setMode: (mode: PriceMode) => void }>()(
  persist(
    (set) => ({
      mode: "auto",
      setMode: (mode) => {
        set({ mode });
        if (inTauri) void emit(EVENT, mode);
      },
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      partialize: (s) => ({ mode: s.mode }),
      // Неизвестный режим из старого или испорченного сохранения — по умолчанию.
      merge: (persisted, current) => {
        const mode = (persisted as { mode?: string } | undefined)?.mode;
        return mode && mode in PRICE_MODES ? { ...current, mode: mode as PriceMode } : current;
      },
    },
  ),
);

/** Смена режима в другом окне. Ставится один раз в корне каждого окна. */
export function usePriceModeSync() {
  useEffect(() => {
    // Запасной путь для браузера без Tauri (две вкладки `pnpm dev`).
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) void usePriceMode.persist.rehydrate();
    };
    window.addEventListener("storage", onStorage);
    let unlisten: (() => void) | undefined;
    let disposed = false;
    if (inTauri) {
      listen<PriceMode>(EVENT, (e) => {
        if (e.payload in PRICE_MODES && e.payload !== usePriceMode.getState().mode) usePriceMode.setState({ mode: e.payload });
      }).then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });
    }
    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener("storage", onStorage);
    };
  }, []);
}

/** Режим и курс divine текущей лиги для всех цен окна. */
export function PriceDisplay({ children }: { children: ReactNode }) {
  const mode = usePriceMode((s) => s.mode);
  const divineChaos = usePrices((p) => p.status?.divineChaos ?? null);
  return (
    <PriceDisplayProvider mode={mode} divineChaos={divineChaos}>
      {children}
    </PriceDisplayProvider>
  );
}

/** Выбор валюты в шапке. */
export function PriceModePicker() {
  const mode = usePriceMode((s) => s.mode);
  const setMode = usePriceMode((s) => s.setMode);
  const divineChaos = usePrices((p) => p.status?.divineChaos ?? null);
  return <PriceModeSelect value={mode} onValueChange={setMode} divineChaos={divineChaos} />;
}
