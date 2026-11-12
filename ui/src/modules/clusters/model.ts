import type { ClusterIssue } from "@/generated/ClusterIssue";
import type { ClusterRow } from "@/generated/ClusterRow";
import type { CraftMethodKind } from "@/generated/CraftMethodKind";
import type { CraftPlan } from "@/generated/CraftPlan";

// Чистые функции вкладки «Выгодные кластеры»: группы по ROI, фильтры, подписи. Без импортов
// во время выполнения — запускаются и в Node.

/** Группа списка. Убыточные показываются только по переключателю; без цены продажи — отдельно. */
export type Band = "roi200" | "roi100" | "roi50" | "roi0" | "loss" | "unpriced";

export const BANDS: { id: Band; label: string; floor: number }[] = [
  { id: "roi200", label: "≥ 200 %", floor: 2 },
  { id: "roi100", label: "100–200 %", floor: 1 },
  { id: "roi50", label: "50–100 %", floor: 0.5 },
  { id: "roi0", label: "0–50 %", floor: 0 },
  { id: "loss", label: "Убыточные", floor: Number.NEGATIVE_INFINITY },
];

export const UNPRICED_LABEL = "Без цены продажи";

/** Группа цели: по ROI лучшего плана; без плана или без цены продажи — `unpriced`. */
export function bandOf(row: ClusterRow): Band {
  const roi = row.best?.roi;
  if (roi === null || roi === undefined) return "unpriced";
  return BANDS.find((b) => roi >= b.floor)?.id ?? "loss";
}

export type SizeId = "large" | "medium" | "small";

export const SIZES: { id: SizeId; label: string }[] = [
  { id: "large", label: "Большие" },
  { id: "medium", label: "Средние" },
  { id: "small", label: "Малые" },
];

export type Filters = {
  sizes: SizeId[];
  /** `single` — один notable, `pair` — два; пусто — все. */
  kinds: ("single" | "pair")[];
  query: string;
};

export const NO_FILTERS: Filters = { sizes: [], kinds: [], query: "" };

/** Цели, прошедшие фильтры (размер, один/два notable, поиск по названию notable en/ru). */
export function applyFilters(rows: ClusterRow[], filters: Filters): ClusterRow[] {
  const needle = filters.query.trim().toLowerCase().replace(/ё/g, "е");
  return rows.filter((row) => {
    if (filters.sizes.length > 0 && !filters.sizes.includes(row.size as SizeId)) return false;
    const kind = row.notables.length > 1 ? "pair" : "single";
    if (filters.kinds.length > 0 && !filters.kinds.includes(kind)) return false;
    if (!needle) return true;
    return row.notables.some((n) => [n.en, n.ru ?? ""].some((name) => name.toLowerCase().replace(/ё/g, "е").includes(needle)));
  });
}

export type SortKey = "roi" | "profit" | "demand" | "cost";

/** Порядок внутри группы; без значения — в конце. */
export function sortRows(rows: ClusterRow[], key: SortKey): ClusterRow[] {
  const value = (row: ClusterRow): number | null => {
    switch (key) {
      case "roi":
        return row.best?.roi ?? null;
      case "profit":
        return row.best?.profit ?? null;
      case "demand":
        return row.demand.share;
      case "cost":
        return row.best ? -row.best.totalCost : null;
    }
  };
  return [...rows].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    if (left === null && right === null) return b.demand.share - a.demand.share;
    if (left === null) return 1;
    if (right === null) return -1;
    return right - left || b.demand.share - a.demand.share;
  });
}

/** Число целей в каждой группе. */
export function bandCounts(rows: ClusterRow[]): Record<Band, number> {
  const counts: Record<Band, number> = { roi200: 0, roi100: 0, roi50: 0, roi0: 0, loss: 0, unpriced: 0 };
  for (const row of rows) counts[bandOf(row)] += 1;
  return counts;
}

/** Группа по умолчанию: самая выгодная непустая (убыточные — только если разрешены). */
export function defaultBand(counts: Record<Band, number>, showLosses: boolean): Band {
  const order: Band[] = ["roi200", "roi100", "roi50", "roi0", ...(showLosses ? (["loss"] as Band[]) : []), "unpriced"];
  return order.find((band) => counts[band] > 0) ?? "roi0";
}

export const METHOD_LABEL: Record<CraftMethodKind, string> = {
  alteration: "Перемены",
  altAug: "Перемены + усиление",
  altAugRegal: "Перемены + усиление + царь",
  altAugRegalExalt: "Перемены + усиление + царь + возвышение",
  chaos: "Хаос",
  fossil: "Ископаемые",
  harvest: "Harvest",
};

const LIFEFORCE_LABEL: Record<string, string> = { wild: "дикой (Wild)", vivid: "яркой (Vivid)", primal: "первородной (Primal)" };

/** Название способа: ископаемые и крафт Harvest — по именам. */
export function methodName(plan: CraftPlan): string {
  if (plan.method === "fossil") return `Ископаемые: ${plan.fossils.map((f) => f.name.ru ?? f.name.en).join(" + ")}`;
  if (plan.method === "harvest" && plan.harvest) return `Harvest: перековка с тегом ${plan.harvest.tag}`;
  return METHOD_LABEL[plan.method];
}

/** Шаги метода словами: что купить и что делать до попадания. `price` — цена в chaos строкой (валюта показа). */
export function methodSteps(plan: CraftPlan, notables: string, price: (chaos: number) => string): string[] {
  const base = `Купить белую базу: ${plan.enchant.ru ?? plan.enchant.en}, уровень не ниже ${plan.itemLevel} (≈ ${price(plan.basePrice)}).`;
  const target = `Цель — ${notables}.`;
  switch (plan.method) {
    case "alteration":
      return [base, "Сфера превращения.", `Сферы перемен, пока не выпадет цель. ${target}`];
    case "altAug":
      return [base, "Сфера превращения.", "Сфера перемен; если у предмета один мод и сфера усиления может закончить цель — усиление.", `Повторять до попадания. ${target}`];
    case "altAugRegal":
      return [
        base,
        "Сфера превращения.",
        "Сферы перемен (и усиление, когда оно может дать нужный notable), пока на предмете не будет notable цели.",
        "Сфера царей. Не вышло — сфера очищения, превращение и снова перемены.",
        target,
      ];
    case "altAugRegalExalt":
      return [
        base,
        "Сфера превращения.",
        "Сферы перемен (и усиление), пока на предмете не будет notable цели.",
        "Сфера царей; если цели не хватает одного мода — сфера возвышения.",
        "Не вышло — сфера очищения, превращение и снова перемены.",
        target,
      ];
    case "chaos":
      return [base, "Сфера алхимии.", `Сферы хаоса, пока не выпадет цель. ${target}`];
    case "harvest": {
      const h = plan.harvest;
      const craft = h ? `«${h.text.ru ?? h.text.en}» — ${h.lifeforceCost} ${LIFEFORCE_LABEL[h.lifeforce] ?? h.lifeforce} жизненной силы` : "перековка Harvest";
      return [base, "Сфера алхимии.", `На станции Harvest: ${craft}; повторять до попадания. ${target}`];
    }
    case "fossil": {
      const fossils = plan.fossils.map((f) => f.name.ru ?? f.name.en).join(", ");
      const sockets = plan.resonatorSockets ?? plan.fossils.length;
      return [base, `Хаотический резонатор (${sockets} ${sockets === 1 ? "гнездо" : "гнезда"}), в него: ${fossils}.`, `Резонатор с ископаемыми на каждую попытку, пока не выпадет цель. ${target}`];
    }
  }
}

export const ISSUE_LABEL: Record<ClusterIssue, string> = {
  unreachable: "не выпадает на базах этой версии игры",
  noBasePrice: "нет цен баз с таким числом пассивов",
  noCurrencyPrice: "нет цен валюты",
  notQuoted: "цена на сайте торговли ещё не проверена",
  noMarket: "меньше трёх объявлений на сайте торговли",
};

export const SIZE_LABEL: Record<string, string> = { large: "Большой", medium: "Средний", small: "Малый" };

/** Доля в процентах: 0.1455 → «14,6 %», меньше процента — с двумя знаками. */
export function formatShare(share: number): string {
  const percent = share * 100;
  return `${percent.toLocaleString("ru-RU", { maximumFractionDigits: percent < 1 ? 2 : 1 })} %`;
}

/** ROI в процентах без дробной части: 0.853 → «85 %». */
export function formatRoi(roi: number): string {
  return `${Math.round(roi * 100).toLocaleString("ru-RU")} %`;
}

/** Изменение доли за сутки в процентных пунктах; `null`, если прошлой доли нет или разница мала. */
export function shareTrend(row: ClusterRow): number | null {
  const previous = row.demand.previousShare;
  if (previous === null) return null;
  const delta = (row.demand.share - previous) * 100;
  return Math.abs(delta) < 0.05 ? 0 : delta;
}
