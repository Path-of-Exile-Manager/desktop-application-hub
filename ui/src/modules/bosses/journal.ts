import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { toast } from "@/design-system";
import { deleteRecord, listRecords, putRecord, useSync } from "@/app/sync";
import { inTauri } from "@/app/window";
import type { FarmKillPrices } from "@/generated/FarmKillPrices";
import type { FarmKillsExpectation } from "@/generated/FarmKillsExpectation";
import type { FarmSettings } from "@/generated/FarmSettings";
import { formatDuration } from "./model";

// Журнал убийств — коллекция `bossKills` в user.db (форма — shared/docs/boss-farm.md, 7.4; проверка —
// src-tauri/src/sync/records.rs), синхронизируется с аккаунтом. Заходы из лога пишет ядро
// (src-tauri/src/farm_log.rs), ручные убийства и дроп — интерфейс. Цены строк дропа и входа — на
// момент записи (решение 12): правка записи старые цены не трогает, новые строки — по ценам сейчас.

export type { FarmKillPrices, FarmKillsExpectation };

export type BossKillDrop = { key: string; qty: number; chaos: number | null };
export type BossKillExtra = { itemId: string; qty: number; chaos: number | null };

export type BossKill = {
  id: string;
  bossId: string;
  league: string;
  dataVersion: string;
  /** ISO: конец захода (из лога) или время записи (вручную). */
  at: string;
  durationSec: number | null;
  overheadSec: number | null;
  pausedSec: number | null;
  deaths: number;
  source: "LOG" | "MANUAL";
  killed: boolean;
  dropsRecorded: boolean;
  drops: BossKillDrop[];
  extra: BossKillExtra[];
  entryChaos: number | null;
};

const COLLECTION = "bossKills";
/** Перерыв длиннее — новая сессия. */
export const SESSION_GAP_MS = 10 * 60 * 1000;
/** «По логу»: медиана последних заходов босса… */
export const LOG_RUNS = 20;
/** …если их не меньше. */
export const LOG_MIN_RUNS = 3;
export const QTY_MAX = 999;

const NO_KILLS: BossKill[] = [];

/** Записи журнала, новые сверху. `null` — ещё не прочитаны. */
export const useBossKills = create<{ kills: BossKill[] | null }>(() => ({ kills: null }));

/** Журнал без `null`: пустой массив — одна и та же константа (селектор zustand). */
export const useKills = () => useBossKills((s) => s.kills ?? NO_KILLS);

const byAtDesc = (a: BossKill, b: BossKill) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0);

export async function reloadKills(): Promise<void> {
  if (!inTauri) {
    if (useBossKills.getState().kills === null) useBossKills.setState({ kills: [] });
    return;
  }
  const records = await listRecords<BossKill>(COLLECTION);
  useBossKills.setState({ kills: records.sort(byAtDesc) });
}

/** Журнал в сторе: при любом изменении данных (запись из лога, другое устройство). Ставят страница и диалог дропа. */
export function useBossKillsSync() {
  const revision = useSync((s) => s.status?.revision);
  useEffect(() => {
    const load = () => reloadKills().catch((e: unknown) => toast({ status: "danger", title: "Журнал убийств не прочитан", description: String(e) }));
    void load();
    if (!inTauri) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unlisten = listen("user-data-changed", () => {
      clearTimeout(timer);
      timer = setTimeout(load, 200);
    });
    return () => {
      clearTimeout(timer);
      void unlisten.then((fn) => fn());
    };
  }, [revision]);
}

let demoCounter = 0;

/** Записать убийство (без `id` — новое). Возвращает сохранённое. */
export async function saveKill(kill: Omit<BossKill, "id"> & { id?: string }): Promise<BossKill> {
  const saved: BossKill = inTauri ? await putRecord<BossKill>(COLLECTION, kill as Record<string, unknown>) : { ...kill, id: kill.id ?? `demo-kill-${Date.now()}-${demoCounter++}` };
  useBossKills.setState((s) => ({ kills: [...(s.kills ?? []).filter((k) => k.id !== saved.id), saved].sort(byAtDesc) }));
  return saved;
}

export async function deleteKill(id: string): Promise<void> {
  if (inTauri) await deleteRecord(COLLECTION, id);
  useBossKills.setState((s) => ({ kills: (s.kills ?? []).filter((k) => k.id !== id) }));
}

/** Запись по id: из стора, иначе из базы (журнал ещё не прочитан — тост на другой вкладке). */
export async function findKill(id: string): Promise<BossKill | null> {
  const local = useBossKills.getState().kills?.find((k) => k.id === id);
  if (local) return local;
  if (!inTauri) return null;
  await reloadKills();
  return useBossKills.getState().kills?.find((k) => k.id === id) ?? null;
}

/** «Не убил»: заход остаётся (вход потрачен), дропа нет. */
export async function markNotKilled(id: string): Promise<void> {
  const kill = await findKill(id);
  if (!kill) throw new Error("запись удалена");
  await saveKill({ ...kill, killed: false, dropsRecorded: false, drops: [], extra: [] });
}

// ---------- цены и ожидание ----------

/** Демо (`?demo=bosses`): цены и EV из демо-расчёта; ставит demo.ts. */
export const journalDemo: {
  prices?: (league: string, bossId: string, extra: string[]) => FarmKillPrices;
  expect?: (kills: Record<string, number>) => Record<string, FarmKillsExpectation>;
} = {};

/** Цены входа, дропа босса и предметов `extra` сейчас — для новой записи и новых строк дропа. */
export function killPrices(league: string, bossId: string, extra: string[]): Promise<FarmKillPrices> {
  if (!inTauri) {
    if (journalDemo.prices) return Promise.resolve(journalDemo.prices(league, bossId, extra));
    return Promise.reject(new Error("цены считает ядро"));
  }
  return invoke<FarmKillPrices>("farm_kill_prices", { league, bossId, extra });
}

/** Ожидаемый доход K убийств по текущей оценке босса (`farm_engine::expect_kills`). */
export function expectKills(league: string, settings: FarmSettings, kills: Record<string, number>): Promise<Record<string, FarmKillsExpectation>> {
  if (!inTauri) return Promise.resolve(journalDemo.expect?.(kills) ?? {});
  return invoke<Record<string, FarmKillsExpectation>>("farm_expect_kills", { league, settings, kills });
}

// ---------- расчёты журнала ----------

/** Доход с дропа записи по ценам момента записи; `missing` — строк без цены. */
export function dropIncome(kill: BossKill): { chaos: number; missing: number; pieces: number } {
  let chaos = 0;
  let missing = 0;
  let pieces = 0;
  for (const line of [...kill.drops, ...kill.extra]) {
    pieces += line.qty;
    if (line.chaos === null) missing += 1;
    else chaos += line.chaos * line.qty;
  }
  return { chaos, missing, pieces };
}

/** Начало захода, мс: конец минус бой и паузы (у ручной записи — само время записи). */
export function killStart(kill: BossKill): number {
  return Date.parse(kill.at) - ((kill.durationSec ?? 0) + (kill.pausedSec ?? 0)) * 1000;
}

/** Время захода с паузами, с. */
const runSeconds = (kill: BossKill) => (kill.durationSec ?? 0) + (kill.pausedSec ?? 0);

/**
 * Учтённые в доходе: убийство с записанным дропом и заход без убийства (вход потрачен, дропа нет).
 * Убийство без записанного дропа в доход не входит — его дроп неизвестен.
 */
export const isCounted = (kill: BossKill) => kill.dropsRecorded || !kill.killed;

export type JournalTotals = {
  runs: number;
  kills: number;
  /** Убийств с записанным дропом — по ним доход и удача. */
  recorded: number;
  notRecorded: number;
  hours: number;
  /** Σ chaos дропа учтённых заходов. */
  dropChaos: number;
  /** Σ entryChaos учтённых заходов. */
  entryChaos: number;
  /** Входов без цены среди учтённых. */
  entryMissing: number;
  /** По боссам: убийств с записанным дропом — для ожидания. */
  recordedByBoss: Record<string, number>;
};

export function totals(kills: BossKill[], hours?: number): JournalTotals {
  const t: JournalTotals = { runs: kills.length, kills: 0, recorded: 0, notRecorded: 0, hours: 0, dropChaos: 0, entryChaos: 0, entryMissing: 0, recordedByBoss: {} };
  let seconds = 0;
  for (const k of kills) {
    if (k.killed) t.kills += 1;
    seconds += runSeconds(k) + (k.overheadSec ?? 0);
    if (k.killed && !k.dropsRecorded) t.notRecorded += 1;
    if (!isCounted(k)) continue;
    if (k.killed) {
      t.recorded += 1;
      t.recordedByBoss[k.bossId] = (t.recordedByBoss[k.bossId] ?? 0) + 1;
    }
    t.dropChaos += dropIncome(k).chaos;
    if (k.entryChaos === null) t.entryMissing += 1;
    else t.entryChaos += k.entryChaos;
  }
  t.hours = hours ?? seconds / 3600;
  return t;
}

export type Session = { id: string; start: number; end: number; kills: BossKill[] };

/** Сессии: заходы подряд, между концом одного и началом следующего — не больше 10 минут. Новые сверху. */
export function sessionsOf(kills: BossKill[]): Session[] {
  const sorted = [...kills].sort((a, b) => killStart(a) - killStart(b));
  const sessions: Session[] = [];
  for (const kill of sorted) {
    const start = killStart(kill);
    const end = Date.parse(kill.at);
    const last = sessions[sessions.length - 1];
    if (last && start - last.end <= SESSION_GAP_MS) {
      last.kills.push(kill);
      last.end = Math.max(last.end, end);
    } else {
      sessions.push({ id: kill.id, start, end, kills: [kill] });
    }
  }
  return sessions.reverse();
}

/** Ожидаемый доход с дропа учтённых убийств: Σ по боссам (EV за убийство × убийств). `null` — оценки нет. */
export function expectedIncome(t: JournalTotals, expectation: Record<string, FarmKillsExpectation> | null): number | null {
  if (!expectation) return null;
  let sum = 0;
  for (const [bossId, count] of Object.entries(t.recordedByBoss)) {
    const e = expectation[bossId];
    if (!e || e.kills === 0) return null;
    sum += (e.income / e.kills) * count;
  }
  return sum;
}

/** Удача: фактический доход с дропа к ожидаемому, доля (+0.38 — «+38 % к ожиданию»). */
export function luck(actual: number, expected: number | null): number | null {
  return expected === null || expected <= 0 ? null : actual / expected - 1;
}

// ---------- «По логу» (F11) ----------

export type LogTiming = { ttkSec: number; overheadSec: number | null; runs: number };

const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

let timingsCache: { kills: BossKill[]; timings: Record<string, LogTiming> } | null = null;

/**
 * TTK и накладные по логу: медиана последних 20 заходов босса из лога (`source: LOG`, `killed`). Боссы,
 * у которых таких заходов меньше 3, не попадают; накладные — медиана непустых из тех же заходов, если
 * их не меньше 3 (у первого захода сессии накладных нет). Один объект на один журнал — для селекторов.
 */
export function logTimings(kills: BossKill[]): Record<string, LogTiming> {
  if (timingsCache?.kills === kills) return timingsCache.timings;
  const runs: Record<string, BossKill[]> = {};
  for (const k of kills) {
    if (k.source !== "LOG" || !k.killed || k.durationSec === null) continue;
    const list = (runs[k.bossId] ??= []);
    if (list.length < LOG_RUNS) list.push(k);
  }
  const timings: Record<string, LogTiming> = {};
  for (const [bossId, list] of Object.entries(runs)) {
    if (list.length < LOG_MIN_RUNS) continue;
    const overheads = list.map((k) => k.overheadSec).filter((v): v is number => v !== null);
    timings[bossId] = {
      ttkSec: Math.max(1, Math.round(median(list.map((k) => k.durationSec ?? 0)))),
      overheadSec: overheads.length >= LOG_MIN_RUNS ? Math.max(1, Math.round(median(overheads))) : null,
      runs: list.length,
    };
  }
  timingsCache = { kills, timings };
  return timings;
}

export const useLogTimings = () => useBossKills((s) => logTimings(s.kills ?? NO_KILLS));

// ---------- формат ----------

/** «2:41», «1:02:05». */
export const clock = formatDuration;

/** «3 мин назад», «только что». */
export function agoText(ms: number, now = Date.now()): string {
  const min = Math.floor((now - ms) / 60000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  return `${Math.floor(min / 60)} ч назад`;
}

export function formatLuck(value: number | null): string {
  if (value === null) return "—";
  const pct = Math.round(value * 100);
  return `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct)} %`;
}
