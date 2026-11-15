import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ClusterBaseCheck } from "@/generated/ClusterBaseCheck";
import type { ClusterDetail } from "@/generated/ClusterDetail";
import type { ClusterRow } from "@/generated/ClusterRow";
import type { ClustersStatus } from "@/generated/ClustersStatus";
import type { CraftCurrency } from "@/generated/CraftCurrency";
import type { CraftPlan } from "@/generated/CraftPlan";
import { inTauri } from "@/app/window";
import { DEFAULT_SORT, firstDirectionDesc, NO_FILTERS, type Band, type Filters, type NameLanguage, type Sort, type SortKey } from "./model";

// Цели и планы считает ядро (src-tauri/src/clusters.rs) для лиги цен; вкладка только показывает.

export type { ClusterBaseCheck, ClusterDetail, ClusterRow, ClustersStatus, CraftCurrency, CraftPlan };

const NO_ROWS: ClusterRow[] = [];

export const useClustersData = create<{
  status: ClustersStatus | null;
  rows: ClusterRow[];
  /** Только `?demo=clusters`: карточки и валюта без ядра. */
  demo?: { details: Record<string, ClusterDetail>; currency: CraftCurrency[] };
}>(() => ({ status: null, rows: NO_ROWS }));

/** Вид вкладки: группа, фильтры, сортировка, убыточные. Хранится локально. */
export const useClustersView = create<{
  band: Band | null;
  filters: Filters;
  sort: Sort;
  showLosses: boolean;
  /** Язык названий notable, валюты и энчантов. */
  language: NameLanguage;
  set: (patch: Partial<{ band: Band | null; filters: Filters; sort: Sort; showLosses: boolean; language: NameLanguage }>) => void;
}>()(
  persist(
    (set) => ({
      band: null,
      filters: NO_FILTERS,
      sort: DEFAULT_SORT,
      showLosses: false,
      language: "ru",
      set: (patch) => set(patch),
    }),
    {
      name: "poe-manager.clusters-view",
      version: 1,
      // До версии 1 сортировка была строкой («roi», «cost»…) из списка над таблицей.
      migrate: (persisted) => {
        const p = (persisted ?? {}) as { sort?: unknown };
        const sort = typeof p.sort === "string" ? { key: p.sort as SortKey, desc: firstDirectionDesc(p.sort as SortKey) } : DEFAULT_SORT;
        return { ...(persisted as object), sort } as never;
      },
      partialize: ({ band, filters, sort, showLosses, language }) => ({ band, filters, sort, showLosses, language }),
    },
  ),
);

/** Свои цены валюты крафта (id предмета → chaos). Хранятся здесь, ядру присылаются при каждой правке. */
export const useOwnPrices = create<{ prices: Record<string, number>; set: (itemId: string, chaos: number | null) => void; reset: () => void }>()(
  persist(
    (set) => ({
      prices: {},
      set: (itemId, chaos) =>
        set((s) => {
          const prices = { ...s.prices };
          if (chaos === null || !(chaos > 0)) delete prices[itemId];
          else prices[itemId] = chaos;
          return { prices };
        }),
      reset: () => set({ prices: {} }),
    }),
    { name: "poe-manager.clusters-prices", partialize: ({ prices }) => ({ prices }) },
  ),
);

/** Подписка на состояние ядра; список перечитывается, когда ядро его пересчитало. Свои цены — ядру. */
export function useClustersSync() {
  const ownPrices = useOwnPrices((s) => s.prices);

  useEffect(() => {
    if (inTauri) void invoke("clusters_set_own_prices", { prices: ownPrices });
  }, [ownPrices]);

  useEffect(() => {
    if (!inTauri) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    let loaded = false;

    const apply = (status: ClustersStatus) => {
      const previous = useClustersData.getState().status;
      useClustersData.setState({ status });
      if (!loaded || status.computedAt !== previous?.computedAt || status.league !== previous?.league) {
        loaded = true;
        invoke<ClusterRow[]>("clusters_list").then((rows) => !disposed && useClustersData.setState({ rows }));
      }
    };

    listen<ClustersStatus>("clusters-status", (e) => apply(e.payload)).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    invoke<ClustersStatus>("clusters_status").then(apply);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}

export function refreshClusters() {
  if (inTauri) void invoke("clusters_refresh");
}

export function clusterDetail(key: string): Promise<ClusterDetail | null> {
  if (inTauri) return invoke<ClusterDetail | null>("cluster_detail", { key });
  return Promise.resolve(useClustersData.getState().demo?.details[key] ?? null);
}

/** Проверка базы на сайте торговли: сколько живёт результат, прежде чем открытие карточки проверит снова. */
const BASE_CHECK_TTL_MS = 10 * 60 * 1000;

export type BaseCheckState = { status: "idle" | "loading" | "done" | "error"; result?: ClusterBaseCheck; error?: string };

/** Проверки баз по ключу цели (до перезапуска): карточку можно закрывать и открывать без новых поисков. */
export const useBaseChecks = create<{ byKey: Record<string, BaseCheckState> }>(() => ({ byKey: {} }));

/**
 * Есть ли база лучшего плана на сайте торговли: ищет её в диапазоне уровней плана, нет — в
 * ближайшем выше; найденная пересчитывает шанс, вложения и прибыль (ядро: `cluster_base_check`).
 */
export function checkBase(key: string, force = false) {
  if (!inTauri) return;
  const current = useBaseChecks.getState().byKey[key];
  if (!force && current && (current.status === "loading" || (current.result && Date.now() - Number(current.result.checkedAt) < BASE_CHECK_TTL_MS))) return;
  const set = (state: BaseCheckState) => useBaseChecks.setState((s) => ({ byKey: { ...s.byKey, [key]: state } }));
  set({ status: "loading", ...(current?.result ? { result: current.result } : {}) });
  invoke<ClusterBaseCheck>("cluster_base_check", { key }).then(
    (result) => set({ status: "done", result }),
    (e) => set({ status: "error", error: String(e), ...(current?.result ? { result: current.result } : {}) }),
  );
}

export function craftCurrency(): Promise<CraftCurrency[]> {
  return inTauri ? invoke<CraftCurrency[]>("clusters_currency") : Promise.resolve(useClustersData.getState().demo?.currency ?? []);
}

/** Поиск на сайте торговли по запросу ядра (`?q=`). */
export function tradeUrl(league: string, query: unknown): string {
  return `https://www.pathofexile.com/trade/search/${encodeURIComponent(league)}?q=${encodeURIComponent(JSON.stringify(query))}`;
}
