import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { useDataset } from "@/app/dataset";
import { inTauri } from "@/app/window";
import type { Ascendancy } from "@/generated/Ascendancy";

// Портреты классов и восхождений — `ascendancies.json` набора данных (команда ядра
// `catalog_ascendancies`). Нет файла (старый набор) или справочника — пустая карта, вкладка рисует монограммы.

type PortraitsState = { datasetId: string | null; byId: Map<string, Ascendancy> };

const EMPTY = new Map<string, Ascendancy>();

export const usePortraits = create<PortraitsState>(() => ({ datasetId: null, byId: EMPTY }));

/** Перечитать портреты, когда сменился набор данных. Ставится на странице вкладки. */
export function usePortraitsSync() {
  const datasetId = useDataset((s) => s.status?.datasetId ?? null);
  useEffect(() => {
    if (!inTauri || !datasetId || usePortraits.getState().datasetId === datasetId) return;
    invoke<Ascendancy[]>("catalog_ascendancies").then(
      (list) => usePortraits.setState({ datasetId, byId: new Map(list.map((a) => [a.id, a])) }),
      () => undefined,
    );
  }, [datasetId]);
}

/** Портрет билда: восхождения, а без него (или без его портрета) — класса. */
export function portraitOf(byId: Map<string, Ascendancy>, build: { className: string; ascendancy: string | null }): Ascendancy | undefined {
  return (build.ascendancy && byId.get(build.ascendancy.toLowerCase())) || byId.get(build.className.toLowerCase());
}
