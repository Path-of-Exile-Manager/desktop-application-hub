import { invoke } from "@tauri-apps/api/core";
import type { EconomyRow } from "@/generated/EconomyRow";
import { inTauri } from "@/app/window";
import type { StashRow, StashSnapshot, StashSnapshotDetail, StashStatus, StashTab } from "./stash";

// `?demo=stash` (только dev-сервер): вкладка «Тайник» без аккаунта PoE — для скриншотов. В приложении
// (tauri dev) предметы, иконки и цены берутся из настоящих цен лиги, в браузере — свои числа.

const TABS: StashTab[] = [
  { id: "t-cur", index: 0, name: "$", kind: "CurrencyStash", colour: "#e5c07b", hidden: false },
  { id: "t-frag", index: 1, name: "Frag", kind: "FragmentStash", colour: "#7c5cbf", hidden: false },
  { id: "t-ess", index: 2, name: "Ess", kind: "EssenceStash", colour: "#3fa7d6", hidden: false },
  { id: "t-div", index: 3, name: "Div", kind: "DivinationCardStash", colour: "#9aa0a6", hidden: false },
  { id: "t-maps", index: 4, name: "Maps", kind: "MapStash", colour: "#c8a2c8", hidden: false },
  { id: "t-gems", index: 5, name: "Gems", kind: "GemStash", colour: "#2fbf71", hidden: false },
  { id: "t-sell", index: 6, name: "SELL", kind: "PremiumStash", colour: "#e06c75", hidden: false },
  { id: "t-dump", index: 7, name: "dump", kind: "QuadStash", colour: "#5c6370", hidden: false },
  { id: "t-old", index: 8, name: "Remove-only", kind: "PremiumStash", colour: null, hidden: true },
];

/** Предмет демо: вкладка, английское имя, количество в каждом из пяти снапшотов, цена вне приложения. */
const ITEMS: [string, string, number[], number][] = [
  ["t-cur", "Divine Orb", [14, 15, 17, 19, 22], 210],
  ["t-cur", "Chaos Orb", [820, 912, 1040, 1188, 1305], 1],
  ["t-cur", "Exalted Orb", [31, 33, 36, 38, 41], 14],
  ["t-cur", "Orb of Alchemy", [240, 262, 301, 330, 356], 0.18],
  ["t-cur", "Orb of Fusing", [180, 190, 214, 233, 251], 0.6],
  ["t-cur", "Vaal Orb", [96, 104, 115, 120, 131], 0.9],
  ["t-cur", "Gemcutter's Prism", [22, 24, 26, 26, 29], 1.2],
  ["t-cur", "Orb of Annulment", [9, 9, 11, 12, 14], 5],
  ["t-frag", "Scarab of Monstrous Lineage", [4, 6, 9, 11, 14], 9],
  ["t-frag", "Fragment of the Phoenix", [1, 1, 2, 2, 3], 24],
  ["t-frag", "Sacrifice at Midnight", [12, 14, 16, 19, 21], 1.5],
  ["t-ess", "Deafening Essence of Greed", [3, 4, 5, 7, 8], 6],
  ["t-ess", "Screaming Essence of Contempt", [11, 14, 18, 20, 25], 2.2],
  ["t-div", "The Apothecary", [0, 0, 0, 1, 1], 1900],
  ["t-div", "The Enlightened", [2, 2, 3, 3, 3], 28],
  ["t-div", "Humility", [6, 8, 9, 12, 13], 1.4],
  ["t-maps", "Crimson Temple Map", [5, 7, 4, 8, 6], 1.8],
  ["t-maps", "Cemetery Map", [8, 9, 12, 10, 13], 1.1],
  ["t-gems", "Enlighten Support", [1, 1, 1, 1, 1], 95],
  ["t-gems", "Awakened Multistrike Support", [0, 1, 1, 1, 1], 70],
  ["t-sell", "Headhunter", [0, 0, 0, 0, 1], 9200],
  ["t-sell", "Watcher's Eye", [1, 1, 1, 1, 1], 160],
  ["t-dump", "Stygian Vise", [1, 1, 2, 2, 2], 4],
];

const HOUR = 3_600_000;

export async function stashDemo() {
  let found = new Map<string, EconomyRow>();
  if (inTauri) {
    const rows = await invoke<EconomyRow[]>("economy_rows", { category: "all" }).catch(() => [] as EconomyRow[]);
    // Самый дешёвый вариант имени — обычный предмет (камень без уровня, уникальный без связей).
    for (const r of rows) {
      const known = found.get(r.nameEn);
      if (!known || r.variantKey === "" || (known.variantKey !== "" && r.chaosValue < known.chaosValue)) found.set(r.nameEn, r);
    }
  } else {
    found = new Map();
  }
  const divine = found.get("Divine Orb")?.chaosValue ?? 210;
  const now = Date.now();
  const times = [now - 6.2 * HOUR, now - 4.9 * HOUR, now - 3.1 * HOUR, now - 1.6 * HOUR, now - 0.1 * HOUR];

  const snapshots: StashSnapshot[] = [];
  const details: Record<number, StashSnapshotDetail> = {};
  times.forEach((takenAt, s) => {
    const id = s + 1;
    // Цены немного гуляют между снапшотами.
    const drift = 1 + (s - 2) * 0.012;
    const rows: StashRow[] = ITEMS.filter(([, , qty]) => qty[s] > 0).map(([tabId, name, qty, fallback]) => {
      const real = found.get(name);
      const unit = name === "Chaos Orb" ? 1 : (real?.chaosValue ?? fallback) * drift;
      return {
        tabId,
        itemId: real?.itemId ?? `demo:${name}`,
        variantKey: real?.variantKey ?? "",
        nameEn: name,
        nameRu: real?.nameRu ?? null,
        iconSha256: real?.iconSha256 ?? null,
        category: real?.category ?? null,
        quantity: qty[s],
        unitChaos: unit,
        currentUnitChaos: unit,
        reliable: real?.reliable ?? true,
        exact: true,
        note: null,
      };
    });
    rows.push({
      tabId: "t-dump",
      itemId: null,
      variantKey: "",
      nameEn: "Cobalt Jewel",
      nameRu: null,
      iconSha256: null,
      category: null,
      quantity: 1,
      unitChaos: null,
      currentUnitChaos: null,
      reliable: false,
      exact: false,
      note: "неопознанный уникальный",
    });
    const tabs = TABS.filter((t) => !t.hidden).map((t) => {
      const own = rows.filter((r) => r.tabId === t.id);
      return {
        id: t.id,
        index: t.index,
        name: t.name,
        kind: t.kind,
        colour: t.colour,
        totalChaos: own.reduce((sum, r) => sum + (r.unitChaos ?? 0) * r.quantity, 0),
        priced: own.filter((r) => r.unitChaos !== null).length,
        unpriced: own.filter((r) => r.unitChaos === null).length,
        skipped: t.id === "t-dump" ? 37 : t.id === "t-sell" ? 4 : 0,
      };
    });
    const snapshot: StashSnapshot = {
      id,
      league: "Keepers",
      takenAt,
      totalChaos: tabs.reduce((sum, t) => sum + t.totalChaos, 0),
      divineChaos: divine * drift,
      tabs: tabs.length,
      priced: tabs.reduce((sum, t) => sum + t.priced, 0),
      unpriced: tabs.reduce((sum, t) => sum + t.unpriced, 0),
      skipped: 41,
      pricesUpdated: null,
    };
    snapshots.push(snapshot);
    details[id] = { snapshot, tabs, rows };
  });

  const status: StashStatus = {
    connected: true,
    account: "Shoki#1234",
    league: "Keepers",
    tabs: TABS,
    tabsFetchedAt: now,
    selected: TABS.filter((t) => !t.hidden).map((t) => t.id),
    job: null,
    error: null,
    limits: [
      { scope: "Ip", max: 30, period: 60, hits: 9, restricted: 0 },
      { scope: "Ip", max: 90, period: 1800, hits: 27, restricted: 0 },
      { scope: "Ip", max: 180, period: 7200, hits: 41, restricted: 0 },
    ],
  };
  return { status, snapshots, details, demo: true };
}
