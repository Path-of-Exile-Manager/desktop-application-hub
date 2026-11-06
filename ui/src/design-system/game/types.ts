// Типы игровых данных, которые показывают компоненты дизайн-системы.
// По форме они повторяют то, что будет отдавать Rust-парсер предметов (crates/item-parser):
// когда парсер дорастёт, эти типы можно будет генерировать из Rust-структур (ts-rs).

export type Rarity = "normal" | "magic" | "rare" | "unique" | "gem" | "currency" | "divination";

export type Affix = "prefix" | "suffix";

/** Тип мода. `explicit` — обычный мод, без тега. */
export type ModKind = "explicit" | "crafted" | "fractured" | "implicit" | "enchant";

/**
 * Часть текста мода: строка — обычный текст, объект — число из предмета и его диапазон.
 * `+105 (100–109) to maximum Energy Shield` →
 * `[{ value: "+105", range: [100, 109] }, " to maximum Energy Shield"]`.
 */
export type ModSegment = string | { value: string; range?: [number, number] };

export type ItemMod = {
  affix?: Affix;
  kind?: ModKind;
  /** 1 — лучший тир. `null` — тира нет (crafted, implicit…). */
  tier?: number | null;
  segments: ModSegment[];
};

export type ItemState = "corrupted" | "mirrored" | "split" | "unidentified";

export type SocketColor = "R" | "G" | "B" | "W";

/** Группы связанных сокетов: `[["B","B","B","B","B","G"]]` — шесть связанных. */
export type SocketGroups = SocketColor[][];

/** Валюта. Пока известны только основные — список дополнит набор данных с бэкенда. */
export type CurrencyId = "chaos" | "divine" | "exalted" | "mirror";

export type PriceAmount = {
  amount: number;
  currency: CurrencyId;
};

export type ItemProperty = {
  label: string;
  value: string;
};

/** Предмет, как его показывают Price check, оверлей и панель «Текущий предмет». */
export type Item = {
  rarity: Rarity;
  /** Класс предмета: «Body Armour». */
  itemClass: string;
  /** Имя редкого/уникального: «Doom Shell». У обычных — нет. */
  name?: string;
  baseType: string;
  itemLevel?: number;
  quality?: number;
  properties?: ItemProperty[];
  sockets?: SocketGroups;
  mods: ItemMod[];
  states?: ItemState[];
  /** Размер в клетках инвентаря: [ширина, высота]. */
  size?: [number, number];
  iconUrl?: string;
};
