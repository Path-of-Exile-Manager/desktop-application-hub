import type { Item, ItemMod, ItemState, ModSegment, Rarity, SocketColor, SocketGroups } from "@/design-system";
import type { Appraisal } from "@/generated/Appraisal";
import type { ParsedMod } from "@/generated/ParsedMod";
import { iconUrl, itemName } from "./dataset";

// Оценка (разбор из ядра) → `Item` дизайн-системы, который рисуют ItemCard, оверлей и панель
// «Текущий предмет». Названия — как в клиенте игры; база — из справочника, если найдена.

const RARITY: Record<Appraisal["item"]["rarity"], Rarity> = {
  normal: "normal",
  magic: "magic",
  rare: "rare",
  unique: "unique",
  gem: "gem",
  currency: "currency",
  divinationCard: "divination",
  quest: "normal",
};

const MOD_KIND: Record<ParsedMod["kind"], ItemMod["kind"]> = {
  enchant: "enchant",
  implicit: "implicit",
  explicit: "explicit",
  crafted: "crafted",
  fractured: "fractured",
  scourge: "enchant",
};

/** Число с диапазоном из расширенного описания: `+15(10-19)`, `12.5(10-15)`, `(6-10)%` без значения. */
const ROLL = /([+-]?\d+(?:\.\d+)?)\((\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\)/g;

/** Строка свойства → сегменты: числа с диапазонами выделяются, остальное — текст. */
export function modSegments(line: string): ModSegment[] {
  const segments: ModSegment[] = [];
  let last = 0;
  for (const m of line.matchAll(ROLL)) {
    if (m.index > last) segments.push(line.slice(last, m.index));
    segments.push({ value: m[1], range: [Number(m[2]), Number(m[3])] });
    last = m.index + m[0].length;
  }
  if (last < line.length) segments.push(line.slice(last));
  return segments;
}

function toMods(mods: ParsedMod[]): ItemMod[] {
  return mods.flatMap((m) =>
    m.lines.map((line) => ({
      kind: MOD_KIND[m.kind],
      affix: m.affix ?? undefined,
      tier: m.tier,
      segments: modSegments(line),
    })),
  );
}

/** `B-B-B-B-R G` → `[["B","B","B","B","R"],["G"]]`; незнакомые буквы (A, DV) пропускаются. */
export function socketGroups(text: string): SocketGroups {
  return text
    .split(" ")
    .filter(Boolean)
    .map((group) => group.split("-").filter((c): c is SocketColor => c === "R" || c === "G" || c === "B" || c === "W"))
    .filter((g) => g.length > 0);
}

export function appraisalToItem(appraisal: Appraisal): Item {
  const { item, catalogItem } = appraisal;
  const rarity = RARITY[item.rarity];
  const named = rarity === "rare" || rarity === "unique";
  const states: ItemState[] = [];
  if (item.corrupted) states.push("corrupted");
  if (item.mirrored) states.push("mirrored");
  if (item.split) states.push("split");
  if (item.unidentified) states.push("unidentified");

  // У редкого и уникального имя своё, база — вторая строка; у волшебного база из справочника,
  // потому что имя с аффиксами («Hale Vaal Regalia of the Fox»).
  const baseFromCatalog = catalogItem && !named ? itemName(catalogItem) : undefined;
  return {
    rarity,
    itemClass: item.itemClass,
    name: named || rarity === "magic" ? item.name : undefined,
    baseType: item.baseType ?? baseFromCatalog ?? item.name,
    itemLevel: item.itemLevel ?? undefined,
    quality: item.quality ?? undefined,
    sockets: item.sockets ? socketGroups(item.sockets.text) : undefined,
    mods: toMods(item.mods),
    states: states.length ? states : undefined,
    size: catalogItem ? [catalogItem.size.w, catalogItem.size.h] : undefined,
    iconUrl: iconUrl(catalogItem?.iconSha256),
  };
}
