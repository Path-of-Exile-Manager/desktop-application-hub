import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Item } from "@/design-system";
import type { OpenedIn } from "@/generated/OpenedIn";
import { deleteRecord, listRecords, putRecord, sortKeyBetween, type SyncCollection } from "./sync";
import { inTauri } from "./window";

// Папки, закладки, история и закреплённые лоты (Ф10): те же записи, что у расширения браузера и
// сервера (формы /v1/sync). Хранятся в user.db; правки отсюда уходят расширению и на сервер.

export type TradeType = "SEARCH" | "EXCHANGE";

export type Folder = { id: string; title: string; icon: string; archivedAt: string | null; sortKey: string };
export type Bookmark = { id: string; folderId: string; title: string; tradeType: TradeType; slug: string; completedAt: string | null; sortKey: string };
export type HistoryEntry = { id: string; tradeType: TradeType; league: string; slug: string; isLive: boolean; title: string; createdAt: string };
export type Pin = {
  id: string;
  tradeType: TradeType;
  league: string;
  slug: string;
  searchTitle: string;
  /** Снимок предмета из расширения — общий тип `Item` дизайн-системы. */
  item: Item;
  price: { amount: number; currency: string; iconUrl?: string } | null;
  seller: { account: string | null; character: string | null } | null;
  pinnedAt: string;
};

/** Побайтовое сравнение ключей порядка — как у сервера и SQLite (`localeCompare` путает регистр). */
export const bySortKey = <T extends { sortKey: string }>(a: T, b: T) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0);

/** Записи коллекции; перечитываются при любом изменении данных. */
export function useRecords<T>(collection: SyncCollection): T[] | null {
  const [records, setRecords] = useState<T[] | null>(null);
  useEffect(() => {
    if (!inTauri) return;
    let alive = true;
    const load = () => listRecords<T>(collection).then((r) => alive && setRecords(r));
    void load();
    const unlisten = listen("user-data-changed", () => void load());
    return () => {
      alive = false;
      void unlisten.then((fn) => fn());
    };
  }, [collection]);
  return records;
}

export const saveRecord = <T extends object>(collection: SyncCollection, record: T) => putRecord<T>(collection, record as Record<string, unknown>);
export const removeRecord = deleteRecord;

/** Ключ для вставки после `before` и перед `after` в упорядоченном списке. */
export const keyBetween = sortKeyBetween;

/** Новый ключ для элемента `index`, переставленного на место `to` в упорядоченном списке. */
export async function keyForMove<T extends { sortKey: string }>(sorted: T[], index: number, to: number): Promise<string> {
  const rest = sorted.filter((_, i) => i !== index);
  return sortKeyBetween(rest[to - 1]?.sortKey ?? null, rest[to]?.sortKey ?? null);
}

/** Адрес поиска на сайте торговли PoE 1. `league` — как в адресе (уже закодирована) или id лиги. */
export function tradeUrl(tradeType: TradeType, league: string, slug: string): string {
  const encoded = league.includes("%") ? league : encodeURIComponent(league);
  return `https://www.pathofexile.com/trade/${tradeType.toLowerCase()}/${encoded}/${slug}`;
}

/** Открыть поиск: через расширение в открытой вкладке торговли, без него — в браузере. */
export function openTrade(url: string): Promise<OpenedIn> {
  return invoke<OpenedIn>("extension_open_trade", { url });
}

/** Разобрать адрес поиска: `https://www.pathofexile.com/trade/search/Allflame/Ab12Cd`. */
export function parseTradeUrl(url: string): { tradeType: TradeType; league: string; slug: string } | null {
  const m = url.trim().match(/^https?:\/\/(?:www\.)?pathofexile\.com\/trade\/(search|exchange)\/([^/?#]+)\/([A-Za-z0-9_-]+)/);
  if (!m) return null;
  return { tradeType: m[1].toUpperCase() as TradeType, league: m[2], slug: m[3] };
}

export const nowIso = () => new Date().toISOString();
