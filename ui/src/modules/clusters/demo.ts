import type { ClusterDetail } from "@/generated/ClusterDetail";
import type { ClusterRow } from "@/generated/ClusterRow";
import type { CraftCurrency } from "@/generated/CraftCurrency";
import type { CraftPlan } from "@/generated/CraftPlan";
import type { ClustersStatus } from "@/generated/ClustersStatus";
import type { CraftMethodKind } from "@/generated/CraftMethodKind";

// Демо-данные вкладки для `?demo=clusters` (только dev-сервер): скриншоты и вёрстка без ядра.
// Числа — порядок величин из расчёта Allflame 11.11.2026, не рынок.

type Seed = [size: string, passives: number, notables: string[], share: number, sale: number | null, base: number, craft: number, method: CraftMethodKind, enchant: string];

const SEEDS: Seed[] = [
  ["large", 8, ["Prismatic Heart", "Widespread Destruction"], 0.093, 60, 10, 12.2, "fossil", "Elemental Damage"],
  ["large", 8, ["Prodigious Defence"], 0.079, 31.8, 15, 2.2, "altAug", "Attack Damage while holding a Shield"],
  ["large", 8, ["Prismatic Heart"], 0.144, 15, 8, 0.6, "altAug", "Elemental Damage"],
  ["large", 8, ["Fuel the Fight", "Martial Prowess"], 0.041, 85, 1, 19, "fossil", "Dagger and Claw Damage"],
  ["large", 8, ["Feed the Fury", "Fuel the Fight"], 0.033, 140, 1, 54, "fossil", "Dagger and Claw Damage"],
  ["large", 8, ["Martial Prowess"], 0.146, 3, 1, 1.1, "altAug", "Dagger and Claw Damage"],
  ["large", 8, ["Widespread Destruction"], 0.139, 9, 8, 1.0, "altAug", "Elemental Damage"],
  ["medium", 4, ["Empowered Envoy", "Endbringer"], 0.055, 250, 3, 200, "chaos", "Damage while you have a Herald"],
  ["medium", 4, ["Unwaveringly Evil"], 0.042, 22, 2, 3.9, "altAug", "Chaos Damage over Time"],
  ["medium", 4, ["Wicked Pall"], 0.031, 18, 2, 4.5, "alteration", "Chaos Damage over Time"],
  ["small", 2, ["Prodigious Defence"], 0.079, 6, 1, 3.2, "harvest", "Chance to Block Spell Damage"],
  ["small", 2, ["Enduring Composure"], 0.051, 4, 1, 11.6, "altAug", "Armour"],
  ["small", 2, ["Prismatic Heart"], 0.144, 1, 0.9, 0.5, "altAug", "Fire Resistance"],
  ["large", 8, ["Smite the Weak"], 0.021, null, 1, 2.0, "altAug", "Dagger and Claw Damage"],
  ["large", 8, ["Heavy Hitter", "Martial Prowess"], 0.012, null, 1, 25, "fossil", "Dagger and Claw Damage"],
];

const DEMO_TRADE = { query: { status: { option: "available" }, type: "Large Cluster Jewel" }, sort: { price: "asc" } };

/** Карточка цели из строки: лучший план и два других для сравнения. */
function demoDetail(row: ClusterRow): ClusterDetail {
  const best = row.best!;
  const variant = (method: CraftMethodKind, factor: number): CraftPlan => ({
    ...best,
    method,
    fossils: [],
    resonatorSockets: null,
    harvest: null,
    probability: best.probability / factor,
    attempts: { mean: best.attempts.mean * factor, p50: Math.ceil(best.attempts.p50 * factor), p90: Math.ceil(best.attempts.p90 * factor) },
    craftCost: { mean: best.craftCost.mean * factor, p50: best.craftCost.p50 * factor, p90: best.craftCost.p90 * factor },
    totalCost: best.basePrice + best.craftCost.mean * factor,
    totalCostP90: best.basePrice + best.craftCost.p90 * factor,
    profit: best.profit === null ? null : best.profit - best.craftCost.mean * (factor - 1),
    roi: best.profit === null ? null : (best.profit - best.craftCost.mean * (factor - 1)) / (best.basePrice + best.craftCost.mean * factor),
  });
  return {
    row,
    plans: [best, variant("chaos", 1.6), variant("alteration", 2.4)],
    enchants: [best.enchant, { en: "Attack Damage", ru: "Урон атак" }],
    tradeTarget: DEMO_TRADE,
  };
}

const DEMO_CURRENCY: CraftCurrency[] = [
  ["transmutation", "Сфера превращения", 0.05],
  ["alteration", "Сфера перемен", 0.15],
  ["augmentation", "Сфера усиления", 0.05],
  ["regal", "Сфера царей", 0.5],
  ["exalted", "Сфера возвышения", 4],
  ["alchemy", "Сфера алхимии", 0.3],
  ["scouring", "Сфера очищения", 0.3],
].map(([key, ru, chaos]) => ({ key: String(key), itemId: `demo:${key}`, name: { en: String(key), ru: String(ru) }, marketChaos: Number(chaos), ownChaos: null }));

export function clustersDemo(): { status: ClustersStatus; rows: ClusterRow[]; demo: { details: Record<string, ClusterDetail>; currency: CraftCurrency[] } } {
  const now = Date.now();
  const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60000).toISOString();
  const rows: ClusterRow[] = SEEDS.map(([size, passives, notables, share, sale, base, craft, method, enchant], index) => {
    const total = base + craft;
    const profit = sale === null ? null : sale - total;
    return {
      key: `${size}|${passives}|1|${notables.join("+")}`,
      size,
      sizeName: { en: `${size[0].toUpperCase()}${size.slice(1)} Cluster Jewel`, ru: null },
      passives,
      minIlvl: notables.length > 1 ? 50 : 1,
      notables: notables.map((en) => ({ en, ru: null })),
      demand: { characters: Math.round(share * 124352), share, previousShare: index % 3 === 0 ? share - 0.004 : index % 3 === 1 ? share + 0.002 : null },
      market: sale === null ? null : { status: "OK", priceChaos: sale, minChaos: sale * 0.8, listings: 200 + index * 37, sampled: 10, fetchedAt: iso(20 + index * 9) },
      best: {
        method,
        fossils: method === "fossil" ? [{ itemId: "fossil", name: { en: "Prismatic Fossil", ru: "Призматическое ископаемое" } }] : [],
        resonatorSockets: method === "fossil" ? 1 : null,
        harvest:
          method === "harvest"
            ? { craft: "ReforgeAttack", tag: "attack", lifeforce: "wild", lifeforceCost: 75, text: { en: "Reforge a Rare item with random modifiers, including an Attack modifier", ru: "Перековать редкий предмет, наделяя его случайными свойствами, включая свойство атак" } }
            : null,
        enchantId: enchant,
        enchant: { en: enchant, ru: null },
        itemLevel: notables.length > 1 ? 75 : 1,
        basePrice: base,
        probability: 0.6 / (1 + craft),
        attempts: { mean: 1 + craft, p50: Math.ceil(craft * 0.7) + 1, p90: Math.ceil(craft * 2.3) + 1 },
        attemptCost: 1,
        craftCost: { mean: craft, p50: craft * 0.7, p90: craft * 2.3 },
        totalCost: total,
        totalCostP90: base + craft * 2.3,
        profit,
        roi: profit === null ? null : profit / total,
        tradeBase: DEMO_TRADE,
      },
      plans: 4,
      issue: sale === null ? "notQuoted" : null,
    };
  });
  const status: ClustersStatus = {
    league: "Allflame",
    state: "ready",
    syncing: false,
    computing: false,
    tracked: true,
    demand: { ninjaVersion: "demo", total: 124352, fetchedAt: iso(42) },
    targets: rows.length,
    planned: rows.length,
    profitable: rows.filter((r) => (r.best?.profit ?? 0) > 0).length,
    checkedAt: now,
    computedAt: now,
    computeMs: 2460,
    error: null,
    engineError: null,
  };
  const details = Object.fromEntries(rows.filter((r) => r.best).map((r) => [r.key, demoDetail(r)]));
  return { status, rows, demo: { details, currency: DEMO_CURRENCY } };
}
