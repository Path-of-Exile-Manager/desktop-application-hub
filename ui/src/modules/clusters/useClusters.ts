import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ClusterDetail } from "@/generated/ClusterDetail";
import type { ClusterRow } from "@/generated/ClusterRow";
import type { ClustersStatus } from "@/generated/ClustersStatus";
import { inTauri } from "@/app/window";
import { NO_FILTERS, type Band, type Filters, type SortKey } from "./model";

// Цели и планы считает ядро (src-tauri/src/clusters.rs) для лиги цен; вкладка только показывает.

export type { ClusterDetail, ClusterRow, ClustersStatus };

const NO_ROWS: ClusterRow[] = [];

export const useClustersData = create<{ status: ClustersStatus | null; rows: ClusterRow[] }>(() => ({ status: null, rows: NO_ROWS }));

/** Вид вкладки: группа, фильтры, сортировка, убыточные. Хранится локально. */
export const useClustersView = create<{
  band: Band | null;
  filters: Filters;
  sort: SortKey;
  showLosses: boolean;
  set: (patch: Partial<{ band: Band | null; filters: Filters; sort: SortKey; showLosses: boolean }>) => void;
}>()(
  persist(
    (set) => ({
      band: null,
      filters: NO_FILTERS,
      sort: "roi",
      showLosses: false,
      set: (patch) => set(patch),
    }),
    { name: "poe-manager.clusters-view", partialize: ({ band, filters, sort, showLosses }) => ({ band, filters, sort, showLosses }) },
  ),
);

/** Подписка на состояние ядра; список перечитывается, когда ядро его пересчитало. */
export function useClustersSync() {
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
  return inTauri ? invoke<ClusterDetail | null>("cluster_detail", { key }) : Promise.resolve(null);
}
