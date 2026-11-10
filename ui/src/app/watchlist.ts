import { useEffect } from "react";
import { create } from "zustand";
import { deleteRecord, listRecords, putRecord, useSync } from "./sync";
import { inTauri } from "./window";

// Watchlist (Ф9): предметы, за ценой которых следит пользователь. Записи живут в user.db
// (коллекция `watchlist`) и с аккаунтом уезжают на сервер движком синхронизации.
// Цена — из прайса текущей лиги по (itemId, variantKey).

export type WatchEntry = {
  id: string;
  itemId: string;
  /** Канонический ключ варианта; `''` — обычный предмет. */
  variantKey: string;
  /** `null` — текущая лига приложения. */
  leagueId: string | null;
  note: string | null;
  addedAt: string;
};

export const NOTE_MAX = 500;

export const useWatchlist = create<{ entries: WatchEntry[] | null }>(() => ({ entries: null }));

export function reloadWatchlist() {
  if (!inTauri) return Promise.resolve();
  return listRecords<WatchEntry>("watchlist").then((entries) =>
    useWatchlist.setState({ entries: entries.sort((a, b) => b.addedAt.localeCompare(a.addedAt)) }),
  );
}

/** Список в сторе — по состоянию синхронизации (записи приходят и с других устройств). Один раз в корне. */
export function useWatchlistSync() {
  const count = useSync((s) => s.status?.counts.watchlist);
  const revision = useSync((s) => s.status?.revision);
  const pending = useSync((s) => s.status?.pending);
  useEffect(() => {
    void reloadWatchlist();
  }, [count, revision, pending]);
}

export function findWatch(entries: WatchEntry[] | null, itemId: string, variantKey: string): WatchEntry | undefined {
  return entries?.find((e) => e.itemId === itemId && e.variantKey === variantKey && e.leagueId === null);
}

/** Добавить; тот же предмет и вариант второй раз не добавляется. */
export async function addToWatchlist(itemId: string, variantKey: string): Promise<void> {
  if (findWatch(useWatchlist.getState().entries, itemId, variantKey)) return;
  await putRecord("watchlist", { itemId, variantKey, leagueId: null, note: null, addedAt: new Date().toISOString() });
  await reloadWatchlist();
}

export async function removeFromWatchlist(id: string): Promise<void> {
  await deleteRecord("watchlist", id);
  await reloadWatchlist();
}

export async function setWatchNote(entry: WatchEntry, note: string): Promise<void> {
  const text = note.trim().slice(0, NOTE_MAX) || null;
  if (text === entry.note) return;
  await putRecord("watchlist", { ...entry, note: text });
  await reloadWatchlist();
}

const BLIGHT: Record<string, string> = { BLIGHTED: "заражённая", RAVAGED: "разорённая" };

/** Ключ варианта словами: `corrupted=1;level=21;quality=20` → «ур. 21 · кач. 20 · осквернён». */
export function variantLabel(key: string): string {
  if (!key) return "обычный";
  const parts: string[] = [];
  for (const pair of key.split(";")) {
    const [name, value = ""] = pair.split("=");
    switch (name) {
      case "level":
        parts.push(`ур. ${value}`);
        break;
      case "quality":
        parts.push(`кач. ${value}`);
        break;
      case "corrupted":
        if (value === "1") parts.push("осквернён");
        break;
      case "links":
        parts.push(`${value} связей`);
        break;
      case "ilvl":
        parts.push(`ilvl ${value}`);
        break;
      case "influence":
        parts.push(value.charAt(0) + value.slice(1).toLowerCase());
        break;
      case "passives":
        parts.push(`${value} пассивов`);
        break;
      case "tier":
        parts.push(`тир ${value}`);
        break;
      case "relic":
        parts.push("relic");
        break;
      case "blight":
        parts.push(BLIGHT[value] ?? value);
        break;
      default:
        parts.push(value);
    }
  }
  return parts.join(" · ");
}
