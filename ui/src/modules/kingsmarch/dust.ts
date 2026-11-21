import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { DustCatalyst } from "@/generated/DustCatalyst";
import type { DustOverview } from "@/generated/DustOverview";
import type { DustRow } from "@/generated/DustRow";
import { inTauri } from "@/app/window";

// «Kingsmarch → Пыль». Ядро (src-tauri/src/kingsmarch.rs) отдаёт уникальные с пылью при уровне 84
// и ценами лиги, здесь — пересчёт по уровню предмета, качеству и катализаторам и фильтры.
// Формулы — из poe-disenchant-tool (MIT, THIRD-PARTY-NOTICES.md).

export type { DustCatalyst, DustOverview, DustRow };

export function dustOverview(): Promise<DustOverview> {
  if (!inTauri) return Promise.resolve({ league: null, rows: [], catalyst: null, dataDate: "" });
  return invoke<DustOverview>("kingsmarch_dust");
}

export type DustSortKey = "perChaos" | "perSlot" | "dust" | "price" | "gold" | "listings";
export type DustKind = "all" | "weapons" | "armours" | "accessories" | "other";

export type DustSettings = {
  /** Уровень предмета, 65–84: пыль растёт линейно до 84. */
  ilvl: number;
  /** Считать 20 % качества у оружия, брони и флаконов (поднимается копейками). */
  quality: boolean;
  /** Бижутерии — 20 катализаторов, если так выходит больше пыли на chaos. */
  catalysts: boolean;
  /** Не меньше стольких лотов (дешёвые редкости часто не купить). */
  minListings: number;
  /** Не меньше пыли за предмет. */
  minDust: number;
  /** Не дороже, chaos; 0 — без ограничения. */
  maxPrice: number;
  kind: DustKind;
  showUnpriced: boolean;
  sort: { key: DustSortKey; desc: boolean };
};

export const DEFAULT_SETTINGS: DustSettings = {
  ilvl: 84,
  quality: true,
  catalysts: true,
  minListings: 3,
  minDust: 0,
  maxPrice: 0,
  kind: "all",
  showUnpriced: false,
  sort: { key: "perChaos", desc: true },
};

export const useDustSettings = create<{ settings: DustSettings; set: (patch: Partial<DustSettings>) => void; reset: () => void }>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      set: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      reset: () => set({ settings: DEFAULT_SETTINGS }),
    }),
    { name: "poe-manager.kingsmarch-dust", version: 1, partialize: ({ settings }) => ({ settings }) },
  ),
);

/** Дешевле одного chaos уникальные на деле почти не продают — цена для расчёта не ниже 1 chaos. */
export const MIN_COST = 1;

export type DustLine = {
  row: DustRow;
  /** Пыль с учётом уровня и качества. */
  dust: number;
  /** Посчитано с 20 % качества. */
  q20: boolean;
  /** Качество — 20 катализаторами (их цена входит в стоимость). */
  catalyzed: boolean;
  /** Стоимость для расчёта: цена (не ниже 1 chaos) + катализаторы; `null` — цены нет. */
  cost: number | null;
  perChaos: number | null;
  perSlot: number | null;
  perGold: number;
};

const kindOf = (category: string | null): DustKind =>
  category === "unique-weapons" ? "weapons" : category === "unique-armours" ? "armours" : category === "unique-accessories" ? "accessories" : "other";

/** Множитель уровня предмета: 65 → 1/20, 84 → 1 (`125 × (20 − (84 − ilvl))`). */
export const ilvlFactor = (ilvl: number) => (20 - (84 - Math.min(84, Math.max(65, ilvl)))) / 20;

export function dustLine(row: DustRow, s: DustSettings, catalyst: DustCatalyst | null): DustLine {
  const f = ilvlFactor(s.ilvl);
  const plain = Math.round(row.dust * f);
  const withQuality = Math.round(row.dustQ20 * f);
  const price = row.chaos === null ? null : Math.max(row.chaos, MIN_COST);
  let dust = plain;
  let cost = price;
  let q20 = false;
  let catalyzed = false;
  if (s.quality && row.quality === "cheap") {
    dust = withQuality;
    q20 = true;
  } else if (s.catalysts && row.quality === "catalyst" && catalyst && price !== null) {
    const catalystCost = catalyst.chaos * 20;
    if (withQuality / (price + catalystCost) > plain / price) {
      dust = withQuality;
      cost = price + catalystCost;
      q20 = true;
      catalyzed = true;
    }
  }
  const perChaos = cost === null ? null : dust / cost;
  return { row, dust, q20, catalyzed, cost, perChaos, perSlot: perChaos === null ? null : perChaos / row.slots, perGold: dust / row.gold };
}

const sortValue = (l: DustLine, key: DustSortKey): number => {
  switch (key) {
    case "perChaos":
      return l.perChaos ?? -1;
    case "perSlot":
      return l.perSlot ?? -1;
    case "dust":
      return l.dust;
    case "price":
      return l.row.chaos ?? Number.POSITIVE_INFINITY;
    case "gold":
      return l.row.gold;
    case "listings":
      return l.row.listings ?? -1;
  }
};

/** Строки после фильтров и сортировки; `query` — по имени и базе, по-русски и по-английски. */
export function dustLines(rows: DustRow[], s: DustSettings, catalyst: DustCatalyst | null, query: string): DustLine[] {
  const q = query.trim().toLowerCase().replace(/ё/g, "е");
  const out: DustLine[] = [];
  for (const row of rows) {
    if (s.kind !== "all" && kindOf(row.category) !== s.kind) continue;
    if (row.chaos === null && !s.showUnpriced) continue;
    if (q && !`${row.nameEn}\n${row.nameRu ?? ""}\n${row.baseEn}\n${row.baseRu ?? ""}`.toLowerCase().replace(/ё/g, "е").includes(q)) continue;
    if (row.chaos !== null && s.minListings > 0 && (row.listings ?? 0) < s.minListings) continue;
    if (s.maxPrice > 0 && row.chaos !== null && row.chaos > s.maxPrice) continue;
    const line = dustLine(row, s, catalyst);
    if (line.dust < s.minDust) continue;
    out.push(line);
  }
  const { key, desc } = s.sort;
  out.sort((a, b) => {
    const d = sortValue(a, key) - sortValue(b, key);
    return desc ? -d : d;
  });
  return out;
}

/** Направление по умолчанию при выборе столбца: эффективность и пыль — по убыванию, цена и золото — по возрастанию. */
export const firstDesc = (key: DustSortKey) => key !== "price" && key !== "gold";

/** Поиск предмета на сайте торговли: имя и база, уровень предмета не ниже выбранного, мгновенный выкуп, дешёвые сверху. */
export function dustTradeQuery(row: DustRow, ilvl: number) {
  return {
    query: {
      status: { option: "securable" },
      name: row.nameEn,
      type: row.baseEn,
      stats: [{ type: "and", filters: [] }],
      filters: { misc_filters: { filters: { ilvl: { min: ilvl } } } },
    },
    sort: { price: "asc" },
  };
}

/** Большое число с пробелами: 3 119 060. */
export const formatInt = (n: number) => Math.round(n).toLocaleString("ru-RU");

/** Компактно: 3.12 млн, 254 тыс., 980. */
export function formatCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} млн`;
  if (abs >= 10_000) return `${(n / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 0 })} тыс.`;
  return formatInt(n);
}
