import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import type { MarketStatus } from "@/generated/MarketStatus";
import { inTauri } from "./window";
import { useShell } from "./store";

// Помощь в оценке билдов (shared/docs/build-price-tracking.md, T6): состояние искателя ядра и
// отправка настроек «Помогать» и бюджета.

export const useMarket = create<{ status: MarketStatus | null }>(() => ({ status: null }));

/** Подписка на `market-status` и отправка настроек. Ставится один раз в корне приложения. */
export function useMarketSync() {
  useEffect(() => {
    if (!inTauri) return;
    const unlisten: Array<() => void> = [];
    let disposed = false;
    listen<MarketStatus>("market-status", (e) => useMarket.setState({ status: e.payload })).then((fn) => (disposed ? fn() : unlisten.push(fn)));
    invoke<MarketStatus>("market_status").then((status) => useMarket.setState({ status }));
    return () => {
      disposed = true;
      unlisten.forEach((fn) => fn());
    };
  }, []);

  const enabled = useShell((s) => s.marketHelp);
  const budgetPerHour = useShell((s) => s.marketBudget);
  useEffect(() => {
    if (inTauri) invoke("market_configure", { settings: { enabled, budgetPerHour } }).catch(() => undefined);
  }, [enabled, budgetPerHour]);
}

/** У вошедшего есть право `builds.track` (по последней проверке искателя). */
export const useCanTrackBuilds = () => useMarket((m) => m.status?.allowed === true);