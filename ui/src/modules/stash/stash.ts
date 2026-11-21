import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import type { StashRow } from "@/generated/StashRow";
import type { StashSnapshot } from "@/generated/StashSnapshot";
import type { StashSnapshotDetail } from "@/generated/StashSnapshotDetail";
import type { StashStatus } from "@/generated/StashStatus";
import type { StashTab } from "@/generated/StashTab";
import { inTauri } from "@/app/window";

// «Тайник»: вход по POESESSID, загрузка вкладок, оценка и снапшоты делает ядро (src-tauri/src/stash/);
// снапшоты лежат только в user.db этого компьютера. Здесь — состояние для вкладки и чистые расчёты.

export type { StashRow, StashSnapshot, StashSnapshotDetail, StashStatus, StashTab };

const NO_SNAPSHOTS: StashSnapshot[] = [];

export const useStash = create<{
  status: StashStatus | null;
  snapshots: StashSnapshot[];
  /** Снапшоты по id (загруженные целиком). */
  details: Record<number, StashSnapshotDetail>;
  /** Только `?demo=stash`: без ядра. */
  demo?: boolean;
}>(() => ({ status: null, snapshots: NO_SNAPSHOTS, details: {} }));

function loadSnapshots() {
  if (!inTauri || useStash.getState().demo) return;
  invoke<StashSnapshot[]>("stash_snapshots").then(
    (snapshots) => useStash.setState({ snapshots }),
    () => useStash.setState({ snapshots: NO_SNAPSHOTS }),
  );
}

/** Подписка на состояние ядра; список снапшотов перечитывается при смене лиги и аккаунта. */
export function useStashSync(leagueId: string | null) {
  useEffect(() => {
    if (!inTauri || useStash.getState().demo) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    listen<StashStatus>("stash-status", (e) => useStash.setState({ status: e.payload })).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const account = useStash((s) => s.status?.account ?? null);
  useEffect(() => {
    if (!inTauri || useStash.getState().demo) return;
    void invoke<StashStatus>("stash_status").then((status) => useStash.setState({ status }));
    loadSnapshots();
  }, [leagueId, account]);
}

export async function connect(session: string, account: string | null): Promise<void> {
  const status = await invoke<StashStatus>("stash_connect", { session, account: account?.trim() || null });
  useStash.setState({ status });
  loadSnapshots();
}

export function disconnect() {
  if (inTauri) void invoke("stash_disconnect");
}

export function refreshTabs(): Promise<unknown> {
  return inTauri ? invoke("stash_refresh_tabs") : Promise.resolve();
}

export function selectTabs(tabIds: string[]) {
  if (useStash.getState().demo) {
    useStash.setState((s) => ({ status: s.status && { ...s.status, selected: tabIds } }));
    return;
  }
  if (inTauri) void invoke("stash_select", { tabIds });
}

export function cancelJob() {
  if (inTauri) void invoke("stash_cancel");
}

export async function takeSnapshot(): Promise<StashSnapshot> {
  const snapshot = await invoke<StashSnapshot>("stash_take_snapshot");
  loadSnapshots();
  return snapshot;
}

export async function snapshotDetail(id: number): Promise<StashSnapshotDetail> {
  const cached = useStash.getState().details[id];
  if (cached) return cached;
  const detail = await invoke<StashSnapshotDetail>("stash_snapshot_detail", { id });
  useStash.setState((s) => ({ details: { ...s.details, [id]: detail } }));
  return detail;
}

export async function deleteSnapshot(id: number) {
  if (!useStash.getState().demo) await invoke("stash_snapshot_delete", { id });
  useStash.setState((s) => ({ snapshots: s.snapshots.filter((x) => x.id !== id) }));
}

// ------------------------------------------------------------------------------------------------
// Расчёты

/** Ключ предмета: один вариант цены (предмет без справочника — по имени). */
export const rowKey = (r: StashRow) => `${r.itemId ?? `name:${r.nameEn}`}|${r.variantKey}`;

export type ItemLine = {
  key: string;
  row: StashRow;
  quantity: number;
  /** Сумма по цене снапшота; `null` — цены нет. */
  total: number | null;
  /** Во скольких вкладках лежит. */
  tabs: number;
};

/** Предметы снапшота, сложенные по ключу (по всем вкладкам или по одной), дорогие сверху. */
export function itemLines(rows: StashRow[], tabId: string | null): ItemLine[] {
  const map = new Map<string, ItemLine>();
  for (const r of rows) {
    if (tabId && r.tabId !== tabId) continue;
    const key = rowKey(r);
    const line = map.get(key);
    const value = r.unitChaos === null ? null : r.unitChaos * r.quantity;
    if (line) {
      line.quantity += r.quantity;
      line.total = line.total === null || value === null ? (line.total ?? value) : line.total + value;
      line.tabs += 1;
    } else {
      map.set(key, { key, row: r, quantity: r.quantity, total: value, tabs: 1 });
    }
  }
  return [...map.values()].sort((a, b) => (b.total ?? -1) - (a.total ?? -1));
}

export type ChangeLine = {
  key: string;
  row: StashRow;
  before: number;
  after: number;
  /** Изменение стоимости: после − до, каждое по ценам своего снапшота. */
  delta: number;
};

/** Что изменилось между снапшотами: количество и стоимость каждого предмета. */
export function changeLines(before: StashRow[], after: StashRow[]): ChangeLine[] {
  const a = new Map(itemLines(before, null).map((l) => [l.key, l]));
  const b = new Map(itemLines(after, null).map((l) => [l.key, l]));
  const out: ChangeLine[] = [];
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(key);
    const y = b.get(key);
    const delta = (y?.total ?? 0) - (x?.total ?? 0);
    if ((x?.quantity ?? 0) === (y?.quantity ?? 0) && Math.abs(delta) < 0.005) continue;
    out.push({ key, row: (y ?? x)!.row, before: x?.quantity ?? 0, after: y?.quantity ?? 0, delta });
  }
  return out.sort((p, q) => Math.abs(q.delta) - Math.abs(p.delta));
}

/** Изменение стоимости в час между снапшотами; `null` — меньше минуты между ними. */
export function perHour(from: StashSnapshot, to: StashSnapshot): number | null {
  const hours = (to.takenAt - from.takenAt) / 3_600_000;
  return hours >= 1 / 60 ? (to.totalChaos - from.totalChaos) / hours : null;
}

/** Промежуток словами: «35 мин», «2 ч 10 мин», «3 дн». */
export function formatSpan(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return minutes % 60 ? `${hours} ч ${minutes % 60} мин` : `${hours} ч`;
  return `${Math.round(hours / 24)} дн`;
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Вкладки, содержимое которых сайт PoE не отдаёт (ядро: `OPAQUE_KINDS`). */
export const OPAQUE_KINDS = ["MapStash", "UniqueStash"];

/** Тип вкладки по-русски. */
export function tabKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    NormalStash: "обычная",
    PremiumStash: "премиум",
    QuadStash: "квадратная",
    CurrencyStash: "валюта",
    FragmentStash: "фрагменты",
    EssenceStash: "эссенции",
    DivinationCardStash: "гадальные карты",
    MapStash: "карты",
    UniqueStash: "уникальные",
    DelveStash: "Delve",
    BlightStash: "Blight",
    MetamorphStash: "Metamorph",
    DeliriumStash: "Delirium",
    GemStash: "камни",
    FlaskStash: "флаконы",
    UltimatumStash: "Ultimatum",
  };
  return labels[kind] ?? kind;
}
