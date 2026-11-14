import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { LiveListing } from "@/generated/LiveListing";
import type { LiveSearch } from "@/generated/LiveSearch";
import type { TradeSearchSpec } from "@/components/trade/spec";

// Живой поиск лотов Price check (ядро — src-tauri/src/trade/live.rs): поиск и первые 10 лотов,
// «Ещё» — следующие 10 из тех же id. Состояние привязано к пойманному предмету: новый предмет —
// выдача сбрасывается.

export type { LiveListing, LiveSearch };

/** Лотов за одну подгрузку — столько сайт отдаёт за раз. */
const PAGE = 10;

type State = {
  /** Предмет, к которому относится выдача. */
  owner: unknown;
  result: LiveSearch | null;
  listings: LiveListing[];
  loading: boolean;
  error: string | null;
};

const EMPTY = (owner: unknown): State => ({ owner, result: null, listings: [], loading: false, error: null });

export function useLiveSearch(owner: unknown) {
  const [raw, setState] = useState<State>(() => EMPTY(owner));
  const state = raw.owner === owner ? raw : EMPTY(owner);
  // Ответ для предмета, который уже сменился, не нужен.
  const update = (patch: Partial<State>) => setState((s) => (s.owner === owner ? { ...s, ...patch } : { ...EMPTY(owner), ...patch }));

  const search = (spec: TradeSearchSpec, league: string) => {
    update({ loading: true, error: null });
    invoke<LiveSearch>("trade_live_search", { spec, league }).then(
      (found) => update({ result: found, listings: found.listings, loading: false }),
      (e) => update({ loading: false, error: String(e) }),
    );
  };

  const more = () => {
    const found = state.result;
    if (!found) return;
    const ids = found.ids.slice(state.listings.length, state.listings.length + PAGE);
    if (ids.length === 0) return;
    update({ loading: true, error: null });
    invoke<LiveListing[]>("trade_live_fetch", { queryId: found.queryId, ids }).then(
      (next) => setState((s) => (s.owner === owner ? { ...s, listings: [...s.listings, ...next], loading: false } : s)),
      (e) => update({ loading: false, error: String(e) }),
    );
  };

  const hasMore = !!state.result && state.listings.length < state.result.ids.length;
  return { ...state, search, more, hasMore, reset: () => setState(EMPTY(owner)) };
}
