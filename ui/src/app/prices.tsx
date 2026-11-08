import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Coins } from "lucide-react";
import { create } from "zustand";
import { Button, type CurrencyId, type StatusItem } from "@/design-system";
import type { CatalogItem } from "@/generated/CatalogItem";
import type { HistoryRange } from "@/generated/HistoryRange";
import type { Price } from "@/generated/Price";
import type { PriceHistory } from "@/generated/PriceHistory";
import type { PricesStatus } from "@/generated/PricesStatus";
import { iconUrl, useDataset } from "./dataset";
import { useCurrentLeague } from "./leagues";
import { formatCheckedAt } from "./server";
import { inTauri } from "./window";

// Цены текущей лиги. Загрузку, кэш и индекс ведёт ядро (src-tauri/src/prices.rs), лигу ему сообщает
// интерфейс. Сводная цена — медиана источников на сервере; свежесть проверяем здесь по `updatedAt`.

export type { HistoryRange, Price, PriceHistory, PricesStatus };

/** Источники пересчитываются раз в 15 минут; сервер считает значение устаревшим через 2 часа. */
export const FRESH_MS = 2 * 60 * 60 * 1000;

export const usePrices = create<{ status: PricesStatus | null }>(() => ({ status: null }));

/** Подписка на состояние цен и передача ядру текущей лиги. Ставится один раз в корне приложения. */
export function usePricesSync() {
  const league = useCurrentLeague();
  const leagueId = league?.id ?? null;

  useEffect(() => {
    if (!inTauri) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    listen<PricesStatus>("prices-status", (e) => usePrices.setState({ status: e.payload })).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    invoke<PricesStatus>("prices_status").then((status) => usePrices.setState({ status }));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (inTauri) void invoke("prices_set_league", { league: leagueId });
  }, [leagueId]);
}

export function refreshPrices() {
  if (inTauri) void invoke("prices_refresh");
}

/** Все варианты предмета с ценой в текущей лиге. */
export function priceVariants(itemId: string): Promise<Price[]> {
  return inTauri ? invoke<Price[]>("price_variants", { itemId }) : Promise.resolve([]);
}

export function priceHistory(league: string, priceKeyId: number, range: HistoryRange): Promise<PriceHistory> {
  return invoke<PriceHistory>("price_history", { league, priceKeyId, range });
}

/** Возраст ISO-времени словами: «3 мин», «5 ч», «2 дн». */
export function formatAge(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} ч`;
  return `${Math.round(hours / 24)} дн`;
}

export function isFresh(iso: string | null | undefined, now = Date.now()): boolean {
  return !!iso && now - Date.parse(iso) <= FRESH_MS;
}

/** Цена в divine по курсу лиги; `null`, пока курса нет. */
export function toDivine(chaos: number, divineChaos: number | null | undefined): number | null {
  return divineChaos ? chaos / divineChaos : null;
}

const CURRENCY_TRADE_IDS: Record<CurrencyId, string> = { chaos: "chaos", divine: "divine", exalted: "exalted", mirror: "mirror" };

/** Картинки валют из справочника (для `CurrencyIconsProvider`). Обновляются со сменой набора. */
export function useCurrencyIcons(): Partial<Record<CurrencyId, string>> {
  const datasetId = useDataset((d) => d.status?.datasetId ?? null);
  const [icons, setIcons] = useState<Partial<Record<CurrencyId, string>>>({});
  useEffect(() => {
    if (!inTauri || !datasetId) return;
    invoke<CatalogItem[]>("catalog_by_trade_ids", { tradeIds: Object.values(CURRENCY_TRADE_IDS) }).then((items) => {
      const next: Partial<Record<CurrencyId, string>> = {};
      for (const [currency, tradeId] of Object.entries(CURRENCY_TRADE_IDS) as [CurrencyId, string][]) {
        const src = iconUrl(items.find((i) => i.tradeId === tradeId)?.iconSha256);
        if (src) next[currency] = src;
      }
      setIcons(next);
    });
  }, [datasetId]);
  return icons;
}

function Details({ title, lines, action }: { title: string; lines: string[]; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-body font-semibold">{title}</p>
      {lines.map((l, i) => (
        <p key={i} className="text-label break-all text-text-secondary">
          {l}
        </p>
      ))}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

const retry = (
  <Button variant="secondary" onClick={refreshPrices} className="h-7 text-label">
    Обновить сейчас
  </Button>
);

/** Элемент строки статусов «Цены». */
export function pricesStatusItem(s: PricesStatus | null): StatusItem | null {
  if (!s || s.state === "idle") return null;
  const base = { id: "prices", icon: Coins };
  if (s.state === "loading") return { ...base, status: "info", label: `Цены · ${s.league} · загрузка…` };
  if (s.state === "missing")
    return { ...base, status: "danger", label: `Нет цен · ${s.league}`, details: <Details title="Цены не загружены" lines={[s.error ?? "нет связи с сервером"]} action={retry} /> };

  if (s.count === 0)
    return { ...base, status: "warning", label: `Цены · ${s.league} · не собираются`, details: <Details title="По этой лиге цены не собираются" lines={["Выберите лигу с ценами в шапке."]} /> };

  const age = formatAge(s.newestUpdate);
  const rate = s.divineChaos ? `Divine = ${Math.round(s.divineChaos)} chaos` : "курс divine неизвестен";
  const lines = [`${s.count.toLocaleString("ru-RU")} цен · обновлены ${age} назад`, rate, `Проверено в ${formatCheckedAt(s.checkedAt)}`];
  if (s.error) return { ...base, status: "warning", label: `Цены · ${s.league} · офлайн`, details: <Details title="Цены из сохранённых" lines={[s.error, ...lines]} action={retry} /> };
  if (!isFresh(s.newestUpdate))
    return { ...base, status: "warning", label: `Цены · ${s.league} · ${age} назад`, details: <Details title="Цены давно не обновлялись" lines={lines} action={retry} /> };
  return { ...base, status: "success", label: `Цены · ${s.league}`, details: <Details title={`Цены лиги ${s.league}`} lines={lines} action={retry} /> };
}
