import type { ClusterRow } from "@/generated/ClusterRow";
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
  ["small", 2, ["Prodigious Defence"], 0.079, 6, 1, 4.3, "altAug", "Chance to Block Spell Damage"],
  ["small", 2, ["Enduring Composure"], 0.051, 4, 1, 11.6, "altAug", "Armour"],
  ["small", 2, ["Prismatic Heart"], 0.144, 1, 0.9, 0.5, "altAug", "Fire Resistance"],
  ["large", 8, ["Smite the Weak"], 0.021, null, 1, 2.0, "altAug", "Dagger and Claw Damage"],
  ["large", 8, ["Heavy Hitter", "Martial Prowess"], 0.012, null, 1, 25, "fossil", "Dagger and Claw Damage"],
];

export function clustersDemo(): { status: ClustersStatus; rows: ClusterRow[] } {
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
  return { status, rows };
}
