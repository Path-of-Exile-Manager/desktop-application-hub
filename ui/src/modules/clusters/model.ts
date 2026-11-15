import type { ClusterIssue } from "@/generated/ClusterIssue";
import type { ClusterName } from "@/generated/ClusterName";
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

/** По какому столбцу сортировать: название, спрос, цена на рынке, вложения, прибыль, ROI, шанс крафта. */
export type SortKey = "name" | "demand" | "market" | "cost" | "profit" | "roi" | "chance";

export type Sort = { key: SortKey; desc: boolean };

export const DEFAULT_SORT: Sort = { key: "roi", desc: true };

/** Первое нажатие на столбец: названия — от А, вложения — от дешёвых, остальное — от большего. */
export function firstDirectionDesc(key: SortKey): boolean {
  return key !== "name" && key !== "cost";
}

/** Сортировка после нажатия на столбец: тот же — в обратную сторону, другой — в свою первую. */
export function nextSort(current: Sort, key: SortKey): Sort {
  return current.key === key ? { key, desc: !current.desc } : { key, desc: firstDirectionDesc(key) };
}

const rowName = (row: ClusterRow) => row.notables.map((n) => n.en).join(" + ");

/** Значение строки для сортировки; `null` — нет значения (такие всегда в конце). */
function sortValue(row: ClusterRow, key: SortKey): number | string | null {
  switch (key) {
    case "name":
      return rowName(row);
    case "demand":
      return row.demand.share;
    case "market":
      return row.market?.status === "OK" ? (row.market.priceChaos ?? null) : null;
    case "cost":
      return row.best?.totalCost ?? null;
    case "profit":
      return row.best?.profit ?? null;
    case "roi":
      return row.best?.roi ?? null;
    case "chance":
      return row.best?.probability ?? null;
  }
}

/** Порядок внутри группы; без значения — в конце при любом направлении, равные — по спросу. */
export function sortRows(rows: ClusterRow[], sort: Sort): ClusterRow[] {
  const sign = sort.desc ? -1 : 1;
  return [...rows].sort((a, b) => {
    const left = sortValue(a, sort.key);
    const right = sortValue(b, sort.key);
    if (left === null && right === null) return b.demand.share - a.demand.share;
    if (left === null) return 1;
    if (right === null) return -1;
    const order = typeof left === "string" && typeof right === "string" ? left.localeCompare(right, "en") : Number(left) - Number(right);
    return sign * order || b.demand.share - a.demand.share;
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

/** Язык названий игры (notable, валюта, энчанты): переключатель «Рус / Eng» на вкладке. */
export type NameLanguage = "ru" | "en";

/** Название на выбранном языке; русского нет — английское. */
export const nameIn = (name: { en: string; ru: string | null }, language: NameLanguage) => (language === "ru" ? (name.ru ?? name.en) : name.en);

export const METHOD_LABEL: Record<NameLanguage, Record<CraftMethodKind, string>> = {
  ru: {
    alteration: "Перемены",
    altAug: "Перемены + усиление",
    altAugRegal: "Перемены + усиление + царь",
    altAugRegalExalt: "Перемены + усиление + царь + возвышение",
    chaos: "Хаос",
    fossil: "Ископаемые",
    harvest: "Harvest",
  },
  en: {
    alteration: "Alteration",
    altAug: "Alteration + Augmentation",
    altAugRegal: "Alteration + Augmentation + Regal",
    altAugRegalExalt: "Alteration + Augmentation + Regal + Exalted",
    chaos: "Chaos",
    fossil: "Fossils",
    harvest: "Harvest",
  },
};

const LIFEFORCE_LABEL: Record<string, string> = { wild: "дикой (Wild)", vivid: "яркой (Vivid)", primal: "первородной (Primal)" };

/** Валюта в шагах крафта: в «Eng» — названия, как в игре на английском. */
const ORBS: Record<NameLanguage, Record<"transmute" | "alts" | "alt" | "aug" | "regal" | "scour" | "exalt" | "alch" | "chaos" | "resonator", string>> = {
  ru: {
    transmute: "Сфера превращения",
    alts: "Сферы перемен",
    alt: "Сфера перемен",
    aug: "сфера усиления",
    regal: "Сфера царей",
    scour: "сфера очищения",
    exalt: "сфера возвышения",
    alch: "Сфера алхимии",
    chaos: "Сферы хаоса",
    resonator: "Хаотический резонатор",
  },
  en: {
    transmute: "Orb of Transmutation",
    alts: "Orb of Alteration",
    alt: "Orb of Alteration",
    aug: "Orb of Augmentation",
    regal: "Regal Orb",
    scour: "Orb of Scouring",
    exalt: "Exalted Orb",
    alch: "Orb of Alchemy",
    chaos: "Chaos Orb",
    resonator: "Chaotic Resonator",
  },
};

/** Название способа: ископаемые и крафт Harvest — по именам. */
export function methodName(plan: CraftPlan, language: NameLanguage = "ru"): string {
  if (plan.method === "fossil") return `${METHOD_LABEL[language].fossil}: ${plan.fossils.map((f) => nameIn(f.name, language)).join(" + ")}`;
  if (plan.method === "harvest" && plan.harvest) return `Harvest: ${language === "ru" ? "перековка с тегом" : "reforge"} ${plan.harvest.tag}`;
  return METHOD_LABEL[language][plan.method];
}

/**
 * Уровни базы, на которых посчитан шанс: «68–74», «84+». Выше диапазона в пул добавляются моды и
 * шанс цели падает, поэтому поиск базы на трейде ограничен им же.
 */
export function levelRange(plan: CraftPlan): string {
  if (plan.itemLevelMax === null) return `${plan.itemLevel}+`;
  return plan.itemLevelMax === plan.itemLevel ? String(plan.itemLevel) : `${plan.itemLevel}–${plan.itemLevelMax}`;
}

/** Шаг плана крафта: что сделать, подробности и главный ли это шаг (его выделяют). */
export type PlanStep = { title: string; detail?: string; key?: boolean };

/** Шанс в процентах для подсказок: 0.0196 → «1,96 %». */
export function formatChance(chance: number): string {
  const percent = chance * 100;
  return `${percent.toLocaleString("ru-RU", { maximumFractionDigits: percent < 10 ? 2 : 1 })} %`;
}

/**
 * Шаги крафта после покупки базы (её — блок «Нужная база»). Для царя с несколькими notable
 * говорит, какой ловить сферами перемен первым (движок выбрал выгоднейший, обычно — реже
 * выпадающий) и с каким шансом выпадает каждый.
 */
export function craftSteps(plan: CraftPlan, notables: string, language: NameLanguage = "ru"): PlanStep[] {
  const o = ORBS[language];
  const done: PlanStep = { title: `Готово: ${notables}` };
  const chances = plan.notableChances;
  const chanceList = chances.length > 0 ? chances.map((c) => `${nameIn(c.name, language)} — ${formatChance(c.chance)}`).join(", ") : null;
  const fishing = (): PlanStep => {
    if (chances.length < 2) {
      return {
        title: `${o.alts} — до notable цели`,
        detail: `${chanceList ? `Шанс за одну сферу: ${chanceList}. ` : ""}${o.aug} — если на предмете один мод и она может дать нужный notable.`,
        key: true,
      };
    }
    const first = plan.fishFirst ? nameIn(plan.fishFirst, language) : null;
    const others = chances.filter((c) => c.name.en !== plan.fishFirst?.en).map((c) => nameIn(c.name, language)).join(" + ");
    const rarest = [...chances].sort((a, b) => a.chance - b.chance)[0]!;
    return first
      ? {
          title: `${o.alts} — ловите первым ${first}`,
          detail:
            `Шанс за одну сферу: ${chanceList}. ${first} выпадает ${rarest.name.en === plan.fishFirst?.en ? "реже" : "сложнее добрать царём"} — его выгоднее ловить переменами, а ${others} добирать царём. ` +
            `Выпал только ${others} — крутите дальше. ${o.aug} — если на предмете один мод и она может дать ${first}.`,
          key: true,
        }
      : {
          title: `${o.alts} — до любого notable цели`,
          detail: `Шанс за одну сферу: ${chanceList}. Подойдёт любой: как только на предмете есть один из них — переходите к царю. ${o.aug} — если на предмете один мод и она может дать notable цели.`,
          key: true,
        };
  };
  const regalTarget = plan.fishFirst
    ? chances
        .filter((c) => c.name.en !== plan.fishFirst?.en)
        .map((c) => nameIn(c.name, language))
        .join(" + ")
    : "недостающий notable";

  switch (plan.method) {
    case "alteration":
      return [{ title: o.transmute, detail: "Белая база станет магической." }, { ...fishing(), detail: `${chanceList ? `Шанс за одну сферу: ${chanceList}. ` : ""}Крутите, пока не выпадет вся цель.` }, done];
    case "altAug":
      return [{ title: o.transmute, detail: "Белая база станет магической." }, fishing(), done];
    case "altAugRegal":
      return [
        { title: o.transmute, detail: "Белая база станет магической." },
        fishing(),
        { title: `${o.regal} — добирает ${regalTarget}`, detail: `Предмет станет редким и получит ещё один мод. Не вышло — ${o.scour}, ${o.transmute} и снова шаг 3.` },
        done,
      ];
    case "altAugRegalExalt":
      return [
        { title: o.transmute, detail: "Белая база станет магической." },
        fishing(),
        { title: `${o.regal} — добирает ${regalTarget}`, detail: "Предмет станет редким и получит ещё один мод." },
        { title: `${o.exalt} — если не хватает одного мода`, detail: `Не вышло и после него — ${o.scour}, ${o.transmute} и снова шаг 3.` },
        done,
      ];
    case "chaos":
      return [{ title: o.alch, detail: "Белая база станет редкой." }, { title: `${o.chaos} — пока не выпадет цель`, detail: "Каждая сфера полностью меняет моды.", key: true }, done];
    case "harvest": {
      const h = plan.harvest;
      const craft = h ? `«${nameIn(h.text, language)}»` : "перековка Harvest";
      const cost = h ? `${h.lifeforceCost} ${LIFEFORCE_LABEL[h.lifeforce] ?? h.lifeforce} жизненной силы за попытку` : undefined;
      return [{ title: o.alch, detail: "Белая база станет редкой." }, { title: `Harvest: ${craft} — пока не выпадет цель`, ...(cost ? { detail: cost } : {}), key: true }, done];
    }
    case "fossil": {
      const fossils = plan.fossils.map((f) => nameIn(f.name, language)).join(", ");
      const sockets = plan.resonatorSockets ?? plan.fossils.length;
      return [
        { title: `${o.resonator} (${sockets} ${sockets === 1 ? "гнездо" : "гнезда"})`, detail: `В него: ${fossils}.` },
        { title: "Резонатор на базу — пока не выпадет цель", detail: "Каждая попытка — новый резонатор с теми же ископаемыми.", key: true },
        done,
      ];
    }
  }
}
/** Другая цель, которая может выпасть на той же базе: её цена на рынке и общие с целью notable. */
export type Alternative = { row: ClusterRow; price: number; shared: ClusterName[] };

/**
 * Что ещё может выпасть при крафте цели и стоит денег: цели того же размера и числа пассивов,
 * которые выпадают на энчанте базы плана и на её уровне (без плана — на любом энчанте цели), с
 * ценой на рынке дороже самой базы. Сначала — с общими notable (пара одного из них, он же один),
 * внутри — дорогие первыми.
 */
export function alternativesFor(target: ClusterRow, plan: CraftPlan | null, rows: ClusterRow[]): Alternative[] {
  const enchants = plan ? [plan.enchantId] : target.enchantIds;
  const floor = plan?.basePrice ?? 0;
  const own = new Set(target.notables.map((n) => n.en));
  const result: Alternative[] = [];
  for (const row of rows) {
    if (row.key === target.key || row.size !== target.size || row.passives !== target.passives) continue;
    if (!row.enchantIds.some((id) => enchants.includes(id))) continue;
    if (plan && row.minIlvl > plan.itemLevel) continue;
    const price = row.market?.status === "OK" ? row.market.priceChaos : null;
    if (price === null || !(price > floor)) continue;
    result.push({ row, price, shared: row.notables.filter((n) => own.has(n.en)) });
  }
  return result.sort((a, b) => Number(b.shared.length > 0) - Number(a.shared.length > 0) || b.price - a.price);
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
