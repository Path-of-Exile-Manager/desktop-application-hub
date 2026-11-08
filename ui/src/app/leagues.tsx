import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { LeagueSelect, type League as LeagueOption } from "@/design-system";
import type { League } from "@/generated/League";
import type { LeaguesStatus } from "@/generated/LeaguesStatus";
import { inTauri } from "./window";

// Лиги. Список и кэш — в ядре (src-tauri/src/leagues.rs), событие `leagues-status`.
// Какая лига текущая, сервер не говорит: выбор пользователя хранится здесь, а пока его нет
// (или выбранная лига закончилась) — лига по умолчанию (`defaultLeague`).

export type { League, LeaguesStatus };

/** Для предпросмотра в браузере (`pnpm dev` без Tauri). */
const DEMO_LEAGUES: League[] = [
  { id: "Allflame", name: "Allflame", kind: "CHALLENGE", hardcore: false, startAt: "2026-07-24T20:00:00.000Z", endAt: null, pricesTracked: true },
  { id: "Hardcore Allflame", name: "Hardcore Allflame", kind: "CHALLENGE", hardcore: true, startAt: "2026-07-24T20:00:00.000Z", endAt: null, pricesTracked: false },
  { id: "Standard", name: "Standard", kind: "PERMANENT", hardcore: false, startAt: null, endAt: null, pricesTracked: false },
];

/** Один и тот же пустой список: селектор zustand с новым массивом на каждый вызов зацикливает рендер. */
const NO_LEAGUES: League[] = [];

export const useLeagues = create<{ status: LeaguesStatus | null }>(() => ({ status: null }));

/** Лига, выбранная пользователем; сохраняется между запусками. `null` — по умолчанию. */
export const useLeagueChoice = create<{ selectedId: string | null; select: (id: string) => void }>()(
  persist((set) => ({ selectedId: null, select: (id) => set({ selectedId: id }) }), { name: "poe-manager.league", version: 1 }),
);

/** Подписка на список лиг от ядра. Ставится один раз в корне приложения. */
export function useLeaguesStatusSync() {
  useEffect(() => {
    if (!inTauri) {
      useLeagues.setState({ status: { leagues: DEMO_LEAGUES, source: "cache", syncing: false, checkedAt: null, error: null } });
      return;
    }
    let unlisten: (() => void) | undefined;
    let disposed = false;
    listen<LeaguesStatus>("leagues-status", (e) => useLeagues.setState({ status: e.payload })).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    invoke<LeaguesStatus>("leagues_status").then((status) => useLeagues.setState({ status }));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}

export function refreshLeagues() {
  if (inTauri) void invoke("leagues_refresh");
}

const time = (iso: string | null) => (iso ? Date.parse(iso) : NaN);

/** Лига идёт: началась (или начало неизвестно) и не закончилась. */
export function isActive(league: League, now: number): boolean {
  const start = time(league.startAt);
  const end = time(league.endAt);
  return !(start > now) && !(end <= now);
}

/**
 * Лига по умолчанию: идущая лига испытаний, не hardcore; из таких — с ценами, затем начавшаяся
 * позже, затем с самым коротким названием (`Allflame`, а не `SSF R Allflame`). Нет таких — `Standard`.
 */
export function defaultLeague(leagues: League[], now: number): League | null {
  const candidates = leagues.filter((l) => l.kind === "CHALLENGE" && !l.hardcore && isActive(l, now));
  candidates.sort(
    (a, b) =>
      Number(b.pricesTracked) - Number(a.pricesTracked) ||
      (time(b.startAt) || 0) - (time(a.startAt) || 0) ||
      a.id.length - b.id.length,
  );
  return candidates[0] ?? leagues.find((l) => l.id === "Standard") ?? leagues[0] ?? null;
}

/** Лиги для выбора: только идущие; сначала с ценами, затем испытаний, события, постоянные; hardcore ниже. */
export function selectableLeagues(leagues: League[], now: number): League[] {
  const order = { CHALLENGE: 0, EVENT: 1, PERMANENT: 2, UNKNOWN: 3 } as const;
  return leagues
    .filter((l) => isActive(l, now))
    .sort(
      (a, b) =>
        Number(b.pricesTracked) - Number(a.pricesTracked) ||
        order[a.kind] - order[b.kind] ||
        Number(a.hardcore) - Number(b.hardcore) ||
        a.id.length - b.id.length ||
        a.id.localeCompare(b.id),
    );
}

/** Текущая лига: выбранная пользователем, если она ещё идёт, иначе по умолчанию. */
export function useCurrentLeague(): League | null {
  const leagues = useLeagues((s) => s.status?.leagues ?? NO_LEAGUES);
  const selectedId = useLeagueChoice((s) => s.selectedId);
  const now = Date.now();
  const selected = leagues.find((l) => l.id === selectedId);
  return selected && isActive(selected, now) ? selected : defaultLeague(leagues, now);
}

/** Выбор лиги в шапке. Пока списка нет (первый запуск без сети) — ничего. */
export function LeaguePicker() {
  const leagues = useLeagues((s) => s.status?.leagues ?? NO_LEAGUES);
  const current = useCurrentLeague();
  const select = useLeagueChoice((s) => s.select);
  if (!current) return null;
  return <LeagueSelect leagues={selectableLeagues(leagues, Date.now()).map(toOption)} value={current.id} onValueChange={select} />;
}

/** Пункт меню выбора лиги в шапке. */
export function toOption(league: League): LeagueOption {
  return {
    id: league.id,
    name: league.name,
    kind: league.kind === "PERMANENT" ? "permanent" : league.kind === "EVENT" ? "event" : "challenge",
    noPrices: !league.pricesTracked,
  };
}
