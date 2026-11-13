import { invoke } from "@tauri-apps/api/core";
import type { Corrupted } from "@/generated/Corrupted";
import type { SpecMod } from "@/generated/SpecMod";
import type { TradeQuery } from "@/generated/TradeQuery";
import type { TradeSearchSpec } from "@/generated/TradeSearchSpec";

// Спецификация поиска на сайте торговли (ядро — src-tauri/src/trade/query.rs): умолчания даёт ядро,
// правки пользователя хранятся отдельно — только изменённые поля (решение 3.10 плана
// shared/docs/pob-trader.md), чтобы новые умолчания доходили до старых сборок.

export type { Corrupted, SpecMod, TradeSearchSpec };

/** Правка одного мода: только то, что пользователь поменял. */
export type ModOverride = { enabled?: boolean; min?: number | null; max?: number | null; useFractured?: boolean };

/** Правки спецификации строки. Моды — по номеру мода в предмете. */
export type SpecOverride = {
  mods?: Record<string, ModOverride>;
  sockets?: number | null;
  links?: number | null;
  corrupted?: Corrupted;
  usePseudo?: boolean;
  gemLevel?: number | null;
  quality?: number | null;
};

/** Спецификация с правками поверх умолчаний. */
export function applyOverride(spec: TradeSearchSpec, o: SpecOverride | undefined): TradeSearchSpec {
  if (!o) return spec;
  return {
    ...spec,
    sockets: o.sockets !== undefined ? o.sockets : spec.sockets,
    links: o.links !== undefined ? o.links : spec.links,
    corrupted: o.corrupted ?? spec.corrupted,
    usePseudo: o.usePseudo ?? spec.usePseudo,
    gemLevel: o.gemLevel !== undefined ? o.gemLevel : spec.gemLevel,
    quality: o.quality !== undefined ? o.quality : spec.quality,
    mods: spec.mods.map((m) => {
      const mo = o.mods?.[String(m.index)];
      if (!mo) return m;
      return {
        ...m,
        enabled: m.statId ? (mo.enabled ?? m.enabled) : false,
        min: mo.min !== undefined ? mo.min : m.min,
        max: mo.max !== undefined ? mo.max : m.max,
        useFractured: mo.useFractured ?? m.useFractured,
      };
    }),
  };
}

/** Что отличается от умолчаний; ничего — `undefined`. */
export function diffOverride(defaults: TradeSearchSpec, edited: TradeSearchSpec): SpecOverride | undefined {
  const o: SpecOverride = {};
  if (edited.sockets !== defaults.sockets) o.sockets = edited.sockets;
  if (edited.links !== defaults.links) o.links = edited.links;
  if (edited.corrupted !== defaults.corrupted) o.corrupted = edited.corrupted;
  if (edited.usePseudo !== defaults.usePseudo) o.usePseudo = edited.usePseudo;
  if (edited.gemLevel !== defaults.gemLevel) o.gemLevel = edited.gemLevel;
  if (edited.quality !== defaults.quality) o.quality = edited.quality;
  const mods: Record<string, ModOverride> = {};
  for (const m of edited.mods) {
    const d = defaults.mods.find((x) => x.index === m.index);
    if (!d) continue;
    const mo: ModOverride = {};
    if (m.enabled !== d.enabled) mo.enabled = m.enabled;
    if (m.min !== d.min) mo.min = m.min;
    if (m.max !== d.max) mo.max = m.max;
    if (m.useFractured !== d.useFractured) mo.useFractured = m.useFractured;
    if (Object.keys(mo).length) mods[String(m.index)] = mo;
  }
  if (Object.keys(mods).length) o.mods = mods;
  return Object.keys(o).length ? o : undefined;
}

/** Модов в поиске и недоступных. */
export function modCounts(spec: TradeSearchSpec): { searched: number; unavailable: number } {
  return {
    searched: spec.mods.filter((m) => m.enabled && m.statId).length,
    unavailable: spec.mods.filter((m) => m.unavailable).length,
  };
}

/** Ошибка спецификации словами (как проверяет ядро) — чтобы выключить «Трейд» без запроса. */
export function specError(spec: TradeSearchSpec): string | null {
  if (!spec.name && !spec.typeLine) return "не известен тип предмета";
  const bad = spec.mods.find((m) => m.enabled && m.min !== null && m.max !== null && m.min > m.max);
  return bad ? `у «${bad.line}» MIN больше MAX` : null;
}

/** Спецификация по записи справочника и ключу варианта цены (Watchlist). */
export const variantSpec = (itemId: string, variantKey: string) => invoke<TradeSearchSpec>("trade_variant_spec", { itemId, variantKey });

/** Запрос по спецификации: тело и ссылка для лиги. */
export const tradeQuery = (spec: TradeSearchSpec, league: string | null) => invoke<TradeQuery>("trade_query", { spec, league });
