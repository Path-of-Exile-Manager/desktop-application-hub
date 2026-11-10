import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { useDataset } from "@/app/dataset";
import { inTauri } from "@/app/window";
import { indexMapSearch, type MapSearch, type MapSearchIndex } from "./model";

// Моды и свойства карт из текущего набора данных (ядро: команда `catalog_map_search`).
// Перечитываются, когда меняется набор: событие `dataset-status` приносит новый `datasetId`.
// Без справочника вовсе приложение само показывает экран «Нужно подключение».

export type MapSearchState =
  | { status: "loading" }
  /** В наборе данных нет `map-search.json` — набор старше вкладки, его нужно обновить. */
  | { status: "missing" }
  /** Файл есть, но не прочитан — формат новее приложения. */
  | { status: "error"; message: string }
  /** `pnpm dev` в браузере: ядра нет. */
  | { status: "unavailable" }
  | { status: "ready"; datasetId: string; index: MapSearchIndex };

const LOADING: MapSearchState = { status: "loading" };

const useMapSearchStore = create<{ state: MapSearchState; datasetId: string | null }>(() => ({ state: LOADING, datasetId: null }));

export function useMapSearch(): MapSearchState {
  const ready = useDataset((s) => s.status?.state === "ready");
  const datasetId = useDataset((s) => s.status?.datasetId ?? null);

  useEffect(() => {
    if (!inTauri) {
      useMapSearchStore.setState({ state: { status: "unavailable" } });
      return;
    }
    if (!ready || !datasetId || useMapSearchStore.getState().datasetId === datasetId) return;
    let cancelled = false;
    invoke<MapSearch | null>("catalog_map_search").then(
      (data) => {
        if (cancelled) return;
        const state: MapSearchState = data ? { status: "ready", datasetId, index: indexMapSearch(data) } : { status: "missing" };
        useMapSearchStore.setState({ state, datasetId });
      },
      (error: unknown) => {
        if (!cancelled) useMapSearchStore.setState({ state: { status: "error", message: String(error) }, datasetId });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [ready, datasetId]);

  return useMapSearchStore((s) => s.state);
}
