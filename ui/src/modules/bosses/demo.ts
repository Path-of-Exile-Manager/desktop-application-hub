import type { FarmBossDetail } from "@/generated/FarmBossDetail";
import type { FarmBossGroup } from "@/generated/FarmBossGroup";
import type { FarmBossRow } from "@/generated/FarmBossRow";
import type { FarmDropLine } from "@/generated/FarmDropLine";
import type { FarmEntryLine } from "@/generated/FarmEntryLine";
import type { FarmPrice } from "@/generated/FarmPrice";
import type { FarmQuotesStatus } from "@/generated/FarmQuotesStatus";
import type { FarmRef } from "@/generated/FarmRef";
import type { FarmSettings } from "@/generated/FarmSettings";
import type { FarmSummary } from "@/generated/FarmSummary";
import type { FarmTable } from "@/generated/FarmTable";
import { refKey, type BossesDemo } from "./useBosses";

// Демо-данные вкладки для `?demo=bosses` (только dev-сервер): вёрстка и скриншоты без ядра.
// Боссы и числа — порядок величин, не таблица шансов и не рынок. Расчёт упрощён: σ — как в
// farm-engine, «за час» — нормальное приближение вместо Монте-Карло.

type Price = number | null;
type Drop = { key: string; en: string; ru?: string; price: Price; weight?: number | null; chance?: number | null; quote?: { status: string; total: number }; none?: boolean };
type Pool = { id: string; kind: "one-of" | "independent"; scales?: boolean; drops: Drop[] };
type Boss = {
  id: string;
  group: FarmBossGroup;
  en: string;
  ru: string;
  entry: { key: string; en: string; ru?: string; qty: number; price: Price }[];
  pools: Pool[];
  ttk: number;
  overhead: number;
  steps?: { iiq: number; mult: number }[];
  patch?: { tag: string; ru: string };
  notes?: string;
  area?: string;
};

const BOSSES: Boss[] = [
  {
    id: "uber-shaper",
    group: "pinnacle-uber",
    en: "Uber Shaper",
    ru: "Создатель (убер)",
    entry: [{ key: "cosmic-fragment", en: "Cosmic Fragment", ru: "Космический осколок", qty: 1, price: 380 }],
    pools: [
      {
        id: "uniques",
        kind: "one-of",
        drops: [
          { key: "echoes-of-creation", en: "Echoes of Creation", ru: "Отголоски созидания", weight: 30, price: 120 },
          { key: "entropic-devastation", en: "Entropic Devastation", ru: "Энтропийное опустошение", weight: 30, price: 40 },
          { key: "starforge", en: "Starforge", ru: "Звёздная кузня", weight: 20, price: 1100 },
          { key: "the-tempest-rising", en: "The Tempest Rising", ru: "Восходящая буря", weight: 20, price: 25 },
        ],
      },
      {
        id: "extra",
        kind: "independent",
        scales: true,
        drops: [
          { key: "unid-sublime-vision", en: "Sublime Vision (unidentified)", ru: "Возвышенное видение (неопознанное)", chance: 2, price: 68000, quote: { status: "OK", total: 7 } },
          { key: "orb-of-dominance", en: "Orb of Dominance", ru: "Сфера превосходства", chance: 10, price: 210 },
          { key: "cosmic-fragment", en: "Cosmic Fragment", ru: "Космический осколок", chance: 5, price: 380 },
          { key: "royal-visage", en: "Royal Visage", ru: "Царственный лик", chance: null, price: 900 },
        ],
      },
    ],
    ttk: 70,
    overhead: 45,
    patch: { tag: "changed", ru: "3.30: Sublime Vision выпадает только неопознанным." },
    notes: "Шансы уникальных — веса пула; дополнительный дроп растёт с IIQ.",
    area: "Владения Создателя",
  },
  {
    id: "uber-elder",
    group: "pinnacle-uber",
    en: "Uber Elder",
    ru: "Древний (убер)",
    entry: [
      { key: "fragment-of-knowledge", en: "Fragment of Knowledge", ru: "Осколок знания", qty: 1, price: 25 },
      { key: "fragment-of-shape", en: "Fragment of Shape", ru: "Осколок формы", qty: 1, price: 30 },
      { key: "fragment-of-terror", en: "Fragment of Terror", ru: "Осколок ужаса", qty: 1, price: 20 },
      { key: "fragment-of-emptiness", en: "Fragment of Emptiness", ru: "Осколок пустоты", qty: 1, price: 22 },
    ],
    pools: [
      {
        id: "uniques",
        kind: "one-of",
        drops: [
          { key: "voidforge", en: "Voidforge", ru: "Кузня пустоты", weight: 20, price: 700 },
          { key: "call-of-the-void", en: "Call of the Void", ru: "Зов пустоты", weight: 40, price: 60 },
          { key: "soul-ascension", en: "Soul Ascension", ru: "Вознесение души", weight: 40, price: 45 },
        ],
      },
      {
        id: "extra",
        kind: "independent",
        scales: true,
        drops: [
          { key: "unid-voidforge", en: "Voidforge (unidentified)", ru: "Кузня пустоты (неопознанная)", chance: 3, price: null, quote: { status: "NEW", total: 0 } },
          { key: "orb-of-dominance", en: "Orb of Dominance", ru: "Сфера превосходства", chance: 8, price: 210 },
          { key: "awakeners-orb", en: "Awakener's Orb", ru: "Сфера Пробудителя", chance: 15, price: 35 },
        ],
      },
    ],
    ttk: 90,
    overhead: 60,
    area: "Вне времени",
  },
  {
    id: "shaper",
    group: "pinnacle",
    en: "The Shaper",
    ru: "Создатель",
    entry: [
      { key: "fragment-of-the-minotaur", en: "Fragment of the Minotaur", ru: "Фрагмент Минотавра", qty: 1, price: 4 },
      { key: "fragment-of-the-phoenix", en: "Fragment of the Phoenix", ru: "Фрагмент Феникса", qty: 1, price: null },
      { key: "fragment-of-the-hydra", en: "Fragment of the Hydra", ru: "Фрагмент Гидры", qty: 1, price: 3 },
      { key: "fragment-of-the-chimera", en: "Fragment of the Chimera", ru: "Фрагмент Химеры", qty: 1, price: 5 },
    ],
    pools: [
      {
        id: "uniques",
        kind: "one-of",
        drops: [
          { key: "shapers-touch", en: "Shaper's Touch", ru: "Прикосновение Создателя", weight: 40, price: 3 },
          { key: "dying-sun", en: "Dying Sun", ru: "Умирающее солнце", weight: 30, price: 15 },
          { key: "starforge", en: "Starforge", ru: "Звёздная кузня", weight: 5, price: 1100 },
          { key: "solstice-vigil", en: "Solstice Vigil", ru: "Бдение солнцестояния", weight: 25, price: 2 },
        ],
      },
      {
        id: "extra",
        kind: "independent",
        scales: true,
        drops: [{ key: "shaper-guardian-map", en: "Shaped map", ru: "Карта Создателя", chance: 50, price: 1, none: true }],
      },
    ],
    ttk: 120,
    overhead: 60,
    area: "Владения Создателя",
  },
  {
    id: "searing-exarch",
    group: "pinnacle",
    en: "The Searing Exarch",
    ru: "Пламенный экзарх",
    entry: [{ key: "incandescent-invitation", en: "Incandescent Invitation", ru: "Раскалённое приглашение", qty: 1, price: 12 }],
    pools: [
      {
        id: "uniques",
        kind: "one-of",
        drops: [
          { key: "annihilations-approach", en: "Annihilation's Approach", ru: "Приближение аннигиляции", weight: 50, price: 8 },
          { key: "ashes-of-the-stars", en: "Ashes of the Stars", ru: "Пепел звёзд", weight: 20, price: 450 },
          { key: "dawnbreaker", en: "Dawnbreaker", ru: "Рассветный", weight: 30, price: 3 },
        ],
      },
      {
        id: "extra",
        kind: "independent",
        scales: true,
        drops: [
          { key: "exceptional-eldritch-ember", en: "Exceptional Eldritch Ember", ru: "Исключительный потусторонний уголь", chance: 30, price: 25 },
          { key: "grand-eldritch-ember", en: "Grand Eldritch Ember", ru: "Большой потусторонний уголь", chance: 80, price: 4 },
          { key: "orb-of-conflict", en: "Orb of Conflict", ru: "Сфера противостояния", chance: 5, price: 65 },
        ],
      },
    ],
    ttk: 80,
    overhead: 50,
    area: "Пылающий монастырь",
  },
  {
    id: "black-star",
    group: "invitation",
    en: "The Black Star",
    ru: "Чёрная звезда",
    entry: [{ key: "polaric-invitation", en: "Polaric Invitation", ru: "Полярное приглашение", qty: 1, price: 45 }],
    pools: [
      {
        id: "uniques",
        kind: "one-of",
        drops: [
          { key: "polaric-devastation", en: "Polaric Devastation", ru: "Полярное опустошение", weight: 50, price: 20 },
          { key: "the-annihilating-light", en: "The Annihilating Light", ru: "Уничтожающий свет", weight: 40, price: 14 },
          { key: "the-burden-of-shadows", en: "The Burden of Shadows", ru: "Бремя теней", weight: 10, price: 900 },
        ],
      },
    ],
    ttk: 60,
    overhead: 40,
    patch: { tag: "new", ru: "Новый босс 3.30." },
    area: "Полярный рубеж",
  },
  {
    id: "t17-fortress",
    group: "t17",
    en: "Fortress Map (T17)",
    ru: "Карта крепости (T17)",
    entry: [{ key: "fortress-map", en: "Fortress Map", ru: "Карта крепости", qty: 1, price: 90 }],
    pools: [
      {
        id: "fragments",
        kind: "independent",
        scales: true,
        drops: [
          { key: "primordial-fragment-a", en: "Echo of Loneliness", ru: "Отзвук одиночества", chance: 50, price: 60 },
          { key: "primordial-fragment-b", en: "Echo of Reverence", ru: "Отзвук благоговения", chance: 50, price: 45 },
        ],
      },
    ],
    ttk: 240,
    overhead: 60,
    steps: [
      { iiq: 0, mult: 2 },
      { iiq: 235, mult: 2.5 },
      { iiq: 250, mult: 3 },
    ],
    area: "Крепость",
  },
  {
    id: "coven-queen",
    group: "league",
    en: "Coven Queen",
    ru: "Королева ковена",
    entry: [],
    pools: [
      {
        id: "uniques",
        kind: "one-of",
        drops: [
          { key: "covens-crown", en: "Coven's Crown", ru: "Корона ковена", weight: null, price: 300 },
          { key: "witchs-veil", en: "Witch's Veil", ru: "Вуаль ведьмы", weight: null, price: 40 },
          { key: "hex-binder", en: "Hex Binder", ru: "Связующий проклятия", weight: null, price: null },
        ],
      },
    ],
    ttk: 150,
    overhead: 90,
    notes: "Шансы ещё не опубликованы: впишите свои по своему дропу.",
  },
  {
    id: "uber-maven",
    group: "pinnacle-uber",
    en: "Uber Maven",
    ru: "Дева (убер)",
    entry: [{ key: "mavens-writ", en: "The Maven's Writ", ru: "Предписание Девы", qty: 1, price: 140 }],
    pools: [
      {
        id: "uniques",
        kind: "one-of",
        drops: [
          { key: "graven-ancient", en: "Graven's Secret", ru: "Тайна Грейвена", weight: 45, price: 15 },
          { key: "legacy-of-fury", en: "Legacy of Fury", ru: "Наследие ярости", weight: 45, price: 10 },
          { key: "impossible-escape", en: "Impossible Escape", ru: "Невозможный побег", weight: 10, price: 180 },
        ],
      },
      {
        id: "extra",
        kind: "independent",
        scales: true,
        drops: [{ key: "awakened-empower", en: "Awakened Empower Support", ru: "Пробуждённое усиление", chance: 1, price: 9000 }],
      },
    ],
    ttk: 150,
    overhead: 60,
    area: "Отголосок Девы",
  },
];

const QUOTES: FarmQuotesStatus = { tracked: true, priced: 1, checkedAt: null, syncing: false, error: null };

/** Нормальная функция распределения (приближение Абрамовица — Стиган). */
function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

function ref(drop: { key: string; quote?: unknown; none?: boolean }): FarmRef {
  if (drop.none) return { none: true };
  return drop.quote ? { quote: drop.key } : { itemId: `demo:${drop.key}` };
}

function price(seed: { price: Price; quote?: { status: string; total: number }; none?: boolean }, r: FarmRef, own: Record<string, number>, minutesAgo: (m: number) => string): FarmPrice {
  const key = refKey(r);
  const ownChaos = key !== null ? (own[key] ?? null) : null;
  const base: FarmPrice = {
    chaos: seed.price,
    source: seed.price === null ? "missing" : seed.quote ? "quote" : "aggregate",
    marketChaos: seed.price,
    ownChaos,
    updatedAt: seed.price === null ? null : minutesAgo(seed.quote ? 22 : 4),
    variantKey: null,
    exact: seed.quote ? null : true,
    reliable: seed.quote ? null : true,
    quoteStatus: seed.quote?.status ?? null,
    minChaos: seed.quote && seed.price !== null ? seed.price * 0.85 : null,
    total: seed.quote?.total ?? null,
  };
  if (seed.none) return { ...base, chaos: 0, source: "none", marketChaos: null, updatedAt: null, exact: null, reliable: null };
  return ownChaos !== null ? { ...base, chaos: ownChaos, source: "own" } : base;
}

function compute(settings: FarmSettings, own: Record<string, number>): { table: FarmTable; details: Record<string, FarmBossDetail> } {
  const now = Date.now();
  const minutesAgo = (m: number) => new Date(now - m * 60000).toISOString();
  const details: Record<string, FarmBossDetail> = {};
  const rows: FarmBossRow[] = [];

  for (const boss of BOSSES) {
    const s = settings.bosses[boss.id] ?? {};
    const iiq = s.iiq ?? settings.iiq;
    const mult = boss.steps ? ([...boss.steps].reverse().find((step) => step.iiq <= iiq) ?? boss.steps[0]).mult : 1 + iiq / 100;
    const chances = s.chances ?? {};

    const entry: FarmEntryLine[] = boss.entry.map((e) => {
      const r = ref(e);
      const p = price(e, r, own, minutesAgo);
      return { ref: r, refKey: refKey(r), name: { en: e.en, ru: e.ru ?? null }, iconItemId: null, iconSha256: null, qty: e.qty, price: p, cost: p.chaos === null ? null : p.chaos * e.qty, tradeUrl: "https://www.pathofexile.com/trade/search/Covens" };
    });
    const entryCost = entry.some((e) => e.cost === null) ? null : entry.reduce((sum, e) => sum + (e.cost ?? 0), 0);

    let ev = 0;
    let variance = 0;
    const unpriced: string[] = [];
    const unknownChance: string[] = [];
    const lines: { key: string; probability: number | null; value: number }[] = [];
    const pools = boss.pools.map((pool) => {
      const weights = pool.drops.map((d) => chances[d.key] ?? d.weight ?? null);
      const total = weights.reduce<number>((sum, w) => sum + (w ?? 0), 0);
      let poolMean = 0;
      let poolSquare = 0;
      const drops: FarmDropLine[] = pool.drops.map((d, i) => {
        const r = ref(d);
        const p = price(d, r, own, minutesAgo);
        const ownChance = chances[d.key] ?? null;
        let probability: number | null = null;
        let expected: number | null = null;
        if (pool.kind === "one-of") {
          const w = weights[i];
          if (w !== null && total > 0) probability = expected = w / total;
        } else {
          const chance = ownChance ?? d.chance ?? null;
          if (chance !== null) {
            expected = (chance / 100) * (pool.scales ? mult : 1);
            probability = Math.min(1, expected);
          }
        }
        const unit = d.none ? 0 : (p.chaos ?? 0);
        const value = (expected ?? 0) * unit;
        if (probability === null) unknownChance.push(d.key);
        else if (p.chaos === null && !d.none) unpriced.push(d.key);
        if (pool.kind === "one-of") {
          poolMean += value;
          poolSquare += (probability ?? 0) * unit * unit;
        } else if (expected !== null) {
          const f = expected > 1 ? expected - Math.floor(expected) : expected;
          variance += f * (1 - f) * unit * unit;
        }
        ev += value;
        lines.push({ key: d.key, probability, value });
        return {
          key: d.key,
          ref: r,
          refKey: refKey(r),
          name: { en: d.en, ru: d.ru ?? null },
          iconItemId: null,
          iconSha256: null,
          chanceSource: ownChance !== null ? "user" : probability === null ? "unknown" : "data",
          dataWeight: pool.kind === "one-of" ? (d.weight ?? null) : null,
          dataChance: pool.kind === "independent" ? (d.chance ?? null) : null,
          ownChance,
          probability,
          expected,
          price: p,
          sellable: !d.none,
          value,
          tradeUrl: d.none ? null : "https://www.pathofexile.com/trade/search/Covens",
        };
      });
      if (pool.kind === "one-of") variance += poolSquare - poolMean * poolMean;
      return { id: pool.id, kind: pool.kind, scalesWithQuantity: pool.scales ?? false, drops };
    });

    const sigma = Math.sqrt(Math.max(0, variance));
    const ttkSec = s.ttkSec ?? boss.ttk;
    const overheadSec = s.overheadSec ?? boss.overhead;
    const killsPerHour = 3600 / Math.max(1, ttkSec + overheadSec);
    const profit = entryCost === null ? null : ev - entryCost;
    const profitPerHour = profit === null ? null : profit * killsPerHour;
    const kills = Math.max(1, Math.round(killsPerHour));
    const hour =
      profit === null
        ? null
        : (() => {
            const mean = profit * kills;
            const sd = sigma * Math.sqrt(kills);
            const z = 1.2816 * sd;
            return { kills, runs: 20000, mean, p10: mean - z, p50: mean, p90: mean + z, lossChance: sd > 0 ? normalCdf(-mean / sd) : mean < 0 ? 1 : 0 };
          })();
    const rare = lines.filter((l) => l.probability !== null && l.probability < 0.05 && l.value > 0);
    const rareTop = rare.sort((a, b) => b.value - a.value)[0]?.key ?? null;
    const summary: FarmSummary = {
      entryCost,
      ev,
      sigma,
      profit,
      ttkSec,
      overheadSec,
      killsPerHour,
      profitPerHour,
      hour,
      rareShare: ev > 0 ? rare.reduce((sum, l) => sum + l.value, 0) / ev : null,
      rareTop,
      unpriced,
      unknownChance,
    };
    const oldestQuoteAt = boss.pools.some((p) => p.drops.some((d) => d.quote && d.price !== null)) ? minutesAgo(22) : null;
    const row: FarmBossRow = {
      id: boss.id,
      group: boss.group,
      name: { en: boss.en, ru: boss.ru },
      iconItemId: null,
      iconSha256: null,
      hidden: s.hidden ?? false,
      patchTag: boss.patch?.tag ?? null,
      summary,
      oldestQuoteAt,
    };
    rows.push(row);
    details[boss.id] = {
      league: "Covens",
      datasetId: "демо",
      dataVersion: "3.30.0-2",
      pricesReady: true,
      pricesUpdatedAt: minutesAgo(4),
      quotes: QUOTES,
      boss: row,
      areas: boss.area ? [{ id: boss.id, name: { en: boss.en, ru: boss.area } }] : null,
      defaultTtkSec: boss.ttk,
      defaultOverheadSec: boss.overhead,
      iiq,
      quantityMultiplier: mult,
      quantityDefault: 0,
      quantitySteps: boss.steps ?? null,
      notes: boss.notes ? { en: boss.notes, ru: boss.notes } : null,
      patch: boss.patch ? { tag: boss.patch.tag, text: { en: boss.patch.ru, ru: boss.patch.ru } } : null,
      sources: [`https://www.poewiki.net/wiki/${boss.en.replace(/ /g, "_")}`],
      entry,
      pools,
    };
  }

  const table: FarmTable = {
    league: "Covens",
    datasetId: "демо",
    dataVersion: "3.30.0-2",
    pricesReady: true,
    pricesUpdatedAt: minutesAgo(4),
    quotes: QUOTES,
    oldestQuoteAt: minutesAgo(22),
    ownPrices: Object.keys(own).length,
    bosses: rows,
    computedAt: now,
    computeMs: 5,
  };
  return { table, details };
}

export function bossesDemo(): BossesDemo {
  return { compute, ownPrices: {}, details: {} };
}
