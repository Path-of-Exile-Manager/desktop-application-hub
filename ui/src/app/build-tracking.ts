import { useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { toast } from "@/design-system";
import type { BuildPrice } from "@/generated/BuildPrice";
import type { BuildPriceEvent } from "@/generated/BuildPriceEvent";
import type { BuildPriceEvents } from "@/generated/BuildPriceEvents";
import type { BuildPriceSummary } from "@/generated/BuildPriceSummary";
import type { RefreshResult } from "@/generated/RefreshResult";
import type { TrackingSummary } from "@/generated/TrackingSummary";
import { useAccount } from "./account";
import { useMarket } from "./market";
import { useRecords } from "./user-data";
import { inTauri } from "./window";
import { slotLabel } from "@/modules/pob-builds/StageRows";

// Отслеживание цены билдов (shared/docs/build-price-tracking.md, T7–T8): сводка отслеживаемых билдов
// (бейджи библиотеки), команды экрана сборки и опрос событий цены → тосты.

export type PriceRange = "week" | "month" | "all";

type TrackingState = {
  /** Отслеживаемые билды по id записи; null — ещё не загружено. */
  summaries: Record<string, BuildPriceSummary> | null;
  loadSummaries: () => Promise<void>;
};

export const useBuildTracking = create<TrackingState>((set) => ({
  summaries: null,
  loadSummaries: async () => {
    if (!inTauri) return;
    const list = await invoke<BuildPriceSummary[]>("build_prices");
    set({ summaries: Object.fromEntries(list.map((s) => [s.recordId, s])) });
  },
}));

export const enableTracking = (recordId: string, code: string, activeStage: number, disabledStages: number[]) =>
  invoke<TrackingSummary>("build_tracking_enable", { recordId, code, activeStage, disabledStages }).finally(() => useBuildTracking.getState().loadSummaries().catch(() => undefined));

export const updateTracking = (recordId: string, activeStage: number, disabledStages: number[]) =>
  invoke<void>("build_tracking_update", { recordId, activeStage, disabledStages }).finally(() => useBuildTracking.getState().loadSummaries().catch(() => undefined));

export const disableTracking = (recordId: string) =>
  invoke<void>("build_tracking_disable", { recordId }).finally(() => useBuildTracking.getState().loadSummaries().catch(() => undefined));

export const refreshTracking = (recordId: string) => invoke<RefreshResult>("build_tracking_refresh", { recordId });

export const loadBuildPrice = (recordId: string, range: PriceRange) => invoke<BuildPrice>("build_price", { recordId, range });

/** Где есть отслеживание: вошёл и есть право `builds.track`. */
export function useTrackingAvailable(): boolean {
  const signedIn = useAccount((a) => a.status?.state === "signedIn");
  const allowed = useMarket((m) => m.status?.allowed === true);
  return signedIn && allowed;
}

/** Цена этапа в «12,5 div» / «840 c» для тоста. */
function shortPrice(chaos: number, divine: number | null | undefined): string {
  if (divine && chaos >= divine) return `${(chaos / divine).toFixed(1).replace(".", ",")} div`;
  return `${Math.round(chaos)} c`;
}

function eventText(event: BuildPriceEvent, names: Record<string, string>): { title: string; description: string } {
  const p = event.payload as { before?: number; after?: number; title?: string | null; row?: string; slot?: string | null; divine?: number | null };
  // Редкий из крафтера PoB называется «New Item» — тогда только слот.
  const place = p.slot ? slotLabel(p.slot) : null;
  const row = !p.row ? "вещь" : !place ? p.row : p.row === "New Item" ? place : `${p.row} (${place})`;
  const build = names[event.recordId] ?? "Билд";
  const stage = p.title ? ` · ${p.title}` : "";
  switch (event.kind) {
    case "STAGE_PRICE_CHANGED": {
      const up = (p.after ?? 0) > (p.before ?? 0);
      return {
        title: `${build}${stage}: цена ${up ? "выросла" : "упала"}`,
        description: `${shortPrice(p.before ?? 0, p.divine)} → ${shortPrice(p.after ?? 0, p.divine)} за сутки`,
      };
    }
    case "ITEM_PRICE_CHANGED":
      return { title: `${build}${stage}: ${row}`, description: `${shortPrice(p.before ?? 0, p.divine)} → ${shortPrice(p.after ?? 0, p.divine)} за сутки` };
    default:
      return { title: `${build}${stage}: ${row}`, description: "Нет предложений на сайте торговли" };
  }
}

/** Опрос событий цены раз в 5 минут → тосты. Ставится один раз в корне; `names` — названия билдов по id. */
export function useBuildPriceEvents(names: Record<string, string>) {
  const available = useTrackingAvailable();
  const namesRef = useRef(names);
  namesRef.current = names;
  useEffect(() => {
    if (!inTauri || !available) return;
    let cursor: number | null = null;
    let stopped = false;
    const poll = async () => {
      try {
        const answer = await invoke<BuildPriceEvents>("build_price_events", { since: cursor });
        if (cursor !== null) {
          for (const event of answer.events) toast({ status: "info", ...eventText(event, namesRef.current) });
        }
        cursor = answer.cursor;
      } catch {
        // Нет связи — повторим в следующий раз.
      }
    };
    poll();
    useBuildTracking.getState().loadSummaries().catch(() => undefined);
    const timer = setInterval(() => {
      if (!stopped) poll();
    }, 5 * 60_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [available]);
}
/** Уведомления о цене отслеживаемых билдов: ставится один раз в корне приложения. */
export function useBuildPriceEventsSync() {
  const records = useRecords<{ id: string; name: string }>("pobBuilds");
  const names = useMemo(() => Object.fromEntries((records ?? []).map((r) => [r.id, r.name])), [records]);
  useBuildPriceEvents(names);
}