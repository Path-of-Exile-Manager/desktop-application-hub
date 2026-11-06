// Демо-данные из макетов дизайн-системы (docs/design/app-shell.md, раздел «Данные для макетов»).
// Заменятся данными от Rust-ядра (пойманный предмет) и BFF (цены, справочник).

import type { Item, League, PriceAmount, Rarity } from "@/design-system";

export const LEAGUES: League[] = [
  { id: "settlers", name: "Settlers of Kalguur", kind: "challenge" },
  { id: "hc-settlers", name: "Hardcore Settlers", kind: "challenge" },
  { id: "standard", name: "Standard", kind: "permanent" },
  { id: "hardcore", name: "Hardcore", kind: "permanent" },
];

export const DATA_VERSION = "3.29.3.3";

export const DOOM_SHELL: Item = {
  rarity: "rare",
  itemClass: "Body Armour",
  name: "Doom Shell",
  baseType: "Vaal Regalia",
  itemLevel: 84,
  quality: 20,
  properties: [{ label: "Energy Shield", value: "512" }],
  sockets: [["B", "B", "B", "B", "B", "G"]],
  size: [2, 3],
  mods: [
    { affix: "prefix", tier: 1, segments: [{ value: "+105", range: [100, 109] }, " to maximum Energy Shield"] },
    { affix: "prefix", tier: 2, segments: [{ value: "+87", range: [80, 89] }, " to maximum Life"] },
    { affix: "prefix", tier: 3, segments: [{ value: "+28", range: [27, 32] }, "% increased Energy Shield"] },
    { affix: "suffix", tier: 3, segments: [{ value: "+38", range: [36, 41] }, "% to Fire Resistance"] },
    { affix: "suffix", tier: 1, segments: [{ value: "+46", range: [46, 48] }, "% to Lightning Resistance"] },
    { affix: "suffix", kind: "crafted", tier: null, segments: [{ value: "+15", range: [15, 16] }, "% to Cold Resistance"] },
  ],
  states: ["corrupted"],
};

export const DOOM_SHELL_PRICE: PriceAmount = { amount: 120, currency: "chaos" };
export const DOOM_SHELL_DIVINE: PriceAmount = { amount: 0.6, currency: "divine" };
export const SIMILAR_COUNT = 23;

export type Lot = { id: string; price: PriceAmount; es: number; life: number; listed: string; listedMinutes: number };

export const SIMILAR_LOTS: Lot[] = [
  { id: "l1", price: { amount: 105, currency: "chaos" }, es: 102, life: 84, listed: "2 ч", listedMinutes: 120 },
  { id: "l2", price: { amount: 115, currency: "chaos" }, es: 106, life: 81, listed: "5 ч", listedMinutes: 300 },
  { id: "l3", price: { amount: 120, currency: "chaos" }, es: 104, life: 88, listed: "1 д", listedMinutes: 1440 },
  { id: "l4", price: { amount: 125, currency: "chaos" }, es: 108, life: 86, listed: "3 ч", listedMinutes: 180 },
  { id: "l5", price: { amount: 0.7, currency: "divine" }, es: 109, life: 89, listed: "20 мин", listedMinutes: 20 },
];

/** Курс для сортировки лотов в chaos. */
export const DIVINE_IN_CHAOS = 200;

export type CatalogItem = {
  id: string;
  name: string;
  itemClass: string;
  rarity: Rarity;
  size: [number, number];
  price: string;
  tradable: boolean;
};

const c = (name: string, itemClass: string, rarity: Rarity, w: number, h: number, price: string, tradable = true): CatalogItem => ({
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  name,
  itemClass,
  rarity,
  size: [w, h],
  price,
  tradable,
});

export const CATALOG: CatalogItem[] = [
  c("Vaal Regalia", "Body Armour", "normal", 2, 3, "~2 chaos"),
  c("Astral Plate", "Body Armour", "normal", 2, 3, "~1 chaos"),
  c("Tabula Rasa", "Body Armour", "unique", 2, 3, "~10 chaos"),
  c("Chaos Orb", "Currency", "currency", 1, 1, "1 chaos"),
  c("Divine Orb", "Currency", "currency", 1, 1, "~200 chaos"),
  c("Headhunter", "Belt", "unique", 2, 1, "~38 divine"),
  c("Mageblood", "Belt", "unique", 2, 1, "~150 divine"),
  c("Fireball", "Gem", "gem", 1, 1, "~1 chaos"),
  c("Hubris Circlet", "Helmet", "normal", 2, 2, "~1 chaos"),
  c("Imbued Wand", "Weapon", "normal", 1, 3, "~1 chaos"),
  c("Ezomyte Tower Shield", "Shield", "normal", 2, 4, "~1 chaos"),
  c("Lion Pelt", "Helmet", "normal", 2, 2, "~1 chaos"),
  c("Goldrim", "Helmet", "unique", 2, 2, "~1 chaos"),
  c("Crown of Eyes", "Helmet", "unique", 2, 2, "~3 chaos"),
  c("Opal Ring", "Ring", "normal", 1, 1, "~5 chaos"),
  c("Two-Stone Ring", "Ring", "normal", 1, 1, "~1 chaos"),
  c("Kalandra's Touch", "Ring", "unique", 1, 1, "~12 divine"),
  c("Stygian Vise", "Belt", "normal", 2, 1, "~3 chaos"),
  c("Exalted Orb", "Currency", "currency", 1, 1, "~15 chaos"),
  c("Orb of Alteration", "Currency", "currency", 1, 1, "~0.1 chaos"),
  c("Mirror of Kalandra", "Currency", "currency", 1, 1, "~1 400 divine"),
  c("Essence of Greed", "Currency", "currency", 1, 1, "~1 chaos"),
  c("Cast when Damage Taken", "Gem", "gem", 1, 1, "~1 chaos"),
  c("Empower Support", "Gem", "gem", 1, 1, "~40 chaos"),
  c("Lightning Strike", "Gem", "gem", 1, 1, "~1 chaos"),
  c("Strand Map", "Map", "normal", 1, 1, "~1 chaos"),
  c("Crimson Temple Map", "Map", "normal", 1, 1, "~2 chaos"),
  c("The Apothecary", "Map", "divination", 1, 1, "~12 divine"),
  c("Carcass Jack", "Body Armour", "unique", 2, 3, "~2 chaos"),
  c("Kaom's Heart", "Body Armour", "unique", 2, 3, "~1 divine"),
  c("Spine Bow", "Weapon", "normal", 2, 4, "~1 chaos"),
  c("Void Sceptre", "Weapon", "normal", 1, 3, "~1 chaos"),
  c("Voidforge", "Weapon", "unique", 2, 4, "~4 divine"),
  c("Titanium Spirit Shield", "Shield", "normal", 2, 3, "~1 chaos"),
  c("Aegis Aurora", "Shield", "unique", 2, 3, "~30 chaos"),
  c("Remnant of Empires", "Shield", "unique", 2, 3, "—", false),
  c("Deshret's Vise", "Gloves", "unique", 2, 2, "—", false),
  c("Hellbringer", "Weapon", "unique", 2, 3, "—", false),
];

export const CATALOG_CLASSES = ["Body Armour", "Helmet", "Ring", "Belt", "Currency", "Map", "Gem", "Weapon", "Shield"];
