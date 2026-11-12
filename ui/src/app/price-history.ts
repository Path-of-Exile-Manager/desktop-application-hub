import { useEffect, useState } from "react";
import { displayPrice, usePriceDisplay, type CurrencyId } from "@/design-system";
import { priceHistory, usePrices, type HistoryRange, type PriceHistory } from "./prices";

// История цен в валюте показа (shared/docs/price-currency.md, Ш4). Сервер отдаёт историю в chaos
// по источникам. Для divine каждая точка делится на курс divine на тот же момент: курс — история
// Divine Orb за тот же период, медиана источников в каждой точке. Сегодняшний курс к прошлым
// точкам не применяется — иначе график показывал бы движение курса как движение цены предмета.

/** Точка курса: время (мс) и цена divine в chaos. По возрастанию времени. */
type RatePoint = { t: number; rate: number };

const RATES_TTL_MS = 15 * 60 * 1000;
const rateCache = new Map<string, { at: number; rates: Promise<RatePoint[]> }>();

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Курс divine во времени: медиана источников в каждой точке истории Divine Orb. */
export function divineRates(history: PriceHistory): RatePoint[] {
  const byTime = new Map<number, number[]>();
  for (const s of history.series)
    for (const p of s.points) {
      if (!(p.chaosValue > 0)) continue;
      const t = Date.parse(p.at);
      byTime.set(t, [...(byTime.get(t) ?? []), p.chaosValue]);
    }
  return [...byTime.entries()].map(([t, values]) => ({ t, rate: median(values) })).sort((a, b) => a.t - b.t);
}

/** История курса divine с кэшем на 15 минут: источники пересчитываются не чаще. */
function loadDivineRates(league: string, divineKeyId: number, range: HistoryRange): Promise<RatePoint[]> {
  const key = `${league}|${divineKeyId}|${range}`;
  const cached = rateCache.get(key);
  if (cached && Date.now() - cached.at < RATES_TTL_MS) return cached.rates;
  const rates = priceHistory(league, divineKeyId, range).then(divineRates);
  rateCache.set(key, { at: Date.now(), rates });
  rates.catch(() => rateCache.delete(key));
  return rates;
}

/** Курс на момент `t`: последний известный не позже `t`; раньше первой точки — первая. */
export function rateAt(rates: RatePoint[], t: number): number | null {
  if (rates.length === 0) return null;
  let lo = 0;
  let hi = rates.length - 1;
  if (t < rates[0].t) return rates[0].rate;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (rates[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return rates[lo].rate;
}

/** Ряд графика: источник и точки (время, значение в `unit`). */
export type HistorySeriesIn = { source: string; points: { t: number; v: number }[] };
export type HistoryIn = { unit: CurrencyId; series: HistorySeriesIn[] };

/** История в chaos → в divine по курсу на момент каждой точки; `rates = null` — оставить chaos. */
export function convertHistory(history: PriceHistory, rates: RatePoint[] | null): HistoryIn {
  return {
    unit: rates ? "divine" : "chaos",
    series: history.series.map((s) => ({
      source: s.source,
      points: s.points.flatMap((p) => {
        const t = Date.parse(p.at);
        if (!rates) return [{ t, v: p.chaosValue }];
        const rate = rateAt(rates, t);
        return rate ? [{ t, v: p.chaosValue / rate }] : [];
      }),
    })),
  };
}

/**
 * История цены в валюте показа. Валюта — как у основной цены (`displayPrice`): дорогое в режиме
 * «авто» и «обе» — в divine. Нет ключа или истории divine — история в chaos.
 */
export function usePriceHistoryIn(league: string | null | undefined, price: { priceKeyId: number; chaosValue: number } | null | undefined, range: HistoryRange) {
  const { mode, divineChaos } = usePriceDisplay();
  const divineKeyId = usePrices((p) => p.status?.divinePriceKeyId ?? null);
  const wanted: CurrencyId = price ? displayPrice(price.chaosValue, divineChaos, mode).primary.currency : "chaos";
  const inDivine = wanted === "divine" && divineKeyId !== null;
  const priceKeyId = price?.priceKeyId ?? null;
  const [history, setHistory] = useState<HistoryIn | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setHistory(null);
    setError(null);
    if (priceKeyId === null || !league) return;
    let cancelled = false;
    const rates = inDivine && divineKeyId !== null ? loadDivineRates(league, divineKeyId, range).catch(() => null) : Promise.resolve(null);
    Promise.all([priceHistory(league, priceKeyId, range), rates]).then(
      ([h, r]) => !cancelled && setHistory(convertHistory(h, r && r.length > 0 ? r : null)),
      (e) => !cancelled && setError(String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [league, priceKeyId, range, inDivine, divineKeyId]);

  return { history, error };
}
