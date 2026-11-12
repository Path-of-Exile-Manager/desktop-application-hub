import type { SocketColor } from "@/design-system";
import type { PobBuild } from "@/generated/PobBuild";
import type { PobStageRow } from "@/generated/PobStageRow";

// Кукла камней (план shared/docs/pob-trader.md, P11): связки набора камней раскладываются по слотам
// экипировки этапа, камни — по гнёздам предметов. PoB не хранит, в каком гнезде стоит камень,
// поэтому гнездо подбирается: связка — в группу гнёзд по длине, камень — в гнездо своего цвета.

/** Связки без слота или со слотом вне куклы. */
export const LOOSE = "loose";

/** Место слота на кукле: колонка и строка (с 1), ширина и высота в клетках — как в инвентаре игры. */
export type DollPlace = { col: number; row: number; w: number; h: number };

export const DOLL_COLUMNS = 8;
export const DOLL_ROWS = 6;

export const DOLL_PLACES: Record<string, DollPlace> = {
  "Weapon 1": { col: 1, row: 1, w: 2, h: 4 },
  "Weapon 2": { col: 7, row: 1, w: 2, h: 4 },
  Helmet: { col: 4, row: 1, w: 2, h: 2 },
  "Body Armour": { col: 4, row: 3, w: 2, h: 3 },
  Belt: { col: 4, row: 6, w: 2, h: 1 },
  Gloves: { col: 1, row: 5, w: 2, h: 2 },
  Boots: { col: 7, row: 5, w: 2, h: 2 },
  "Ring 3": { col: 3, row: 2, w: 1, h: 1 },
  Amulet: { col: 6, row: 2, w: 1, h: 1 },
  "Ring 1": { col: 3, row: 4, w: 1, h: 1 },
  "Ring 2": { col: 6, row: 4, w: 1, h: 1 },
};

/** Слоты куклы в порядке обхода (для выбора по умолчанию). */
export const DOLL_ORDER = ["Body Armour", "Weapon 1", "Weapon 2", "Helmet", "Gloves", "Boots", "Amulet", "Ring 1", "Ring 2", "Ring 3", "Belt"];

/** `Weapon 1 Swap` стоит на месте `Weapon 1`. */
export const placeName = (slot: string) => slot.replace(/ Swap$/, "");
export const isSwap = (slot: string) => slot.endsWith(" Swap");
export const onDoll = (slot: string) => placeName(slot) in DOLL_PLACES;

export type DollSocket = {
  /** Цвет гнезда; `A` — абиссальное, камни в него не ставятся. */
  color: SocketColor | "A";
  linked: boolean;
  gem: PobStageRow | null;
  /** Камень не того цвета, что гнездо. */
  mismatch: boolean;
};

export type DollGroup = {
  /** Номер связки (с 0) в наборе камней. */
  index: number;
  /** Подпись связки в PoB. */
  label: string | null;
  enabled: boolean;
  rows: PobStageRow[];
};

export type DollSlot = {
  /** Слот как в PoB (`Body Armour`, `Weapon 1 Swap`) или `LOOSE`. */
  id: string;
  /** Предмет этапа в этом слоте. */
  item: PobStageRow | null;
  sockets: DollSocket[];
  /** Гнёзд у предмета не известно — нарисованы по цветам камней. */
  virtualSockets: boolean;
  groups: DollGroup[];
  /** Камни, которым не хватило гнезда. */
  overflow: PobStageRow[];
  warnings: string[];
};

export type GemDoll = {
  slots: Map<string, DollSlot>;
  loose: DollSlot | null;
  hasSwap: boolean;
};

const GEM_COLOR: Record<string, SocketColor | null> = { RED: "R", GREEN: "G", BLUE: "B", WHITE: "W", UNKNOWN: null };

/** Цвет камня по справочнику; нет — подходит любое гнездо. */
export function gemColor(row: PobStageRow): SocketColor | null {
  const d = row.catalogItem?.details;
  return d?.kind === "GEM" ? GEM_COLOR[d.color] : null;
}

export function isSupport(row: PobStageRow): boolean {
  const d = row.catalogItem?.details;
  return d?.kind === "GEM" ? d.isSupport : (row.gem?.gem.gemId?.includes("/Support") ?? false);
}

/** Гнёзда PoB (`R-R-G B A`) → группы связанных гнёзд. */
export function parseSockets(text: string): (SocketColor | "A")[][] {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((group) => group.split("-").map((c) => (c === "R" || c === "G" || c === "B" || c === "W" || c === "A" ? c : "W")));
}

export function plural(k: number, one: string, few: string, many: string): string {
  return k % 10 === 1 && k % 100 !== 11 ? one : k % 10 >= 2 && k % 10 <= 4 && (k % 100 < 12 || k % 100 > 14) ? few : many;
}

export const groupName = (g: DollGroup) => g.label?.trim() || `связка ${g.index + 1}`;

/**
 * Раскладка камней набора `skillSet` по слотам этапа. `rows` — строки этапа, посчитанного для
 * этого же набора камней (номер связки в строке камня — индекс в его `groups`).
 */
export function layoutGems(build: PobBuild, rows: PobStageRow[], skillSet: number): GemDoll {
  const groups = build.skillSets[skillSet]?.groups ?? [];

  const items = new Map<string, PobStageRow>();
  for (const r of rows) if (r.item && (r.section === "equipment" || r.section === "jewellery") && onDoll(r.slot)) items.set(r.slot, r);

  const bySlot = new Map<string, DollGroup[]>();
  const byGroup = new Map<number, PobStageRow[]>();
  for (const r of rows) {
    if (!r.gem) continue;
    byGroup.set(r.gem.group, [...(byGroup.get(r.gem.group) ?? []), r]);
  }
  for (const [index, list] of byGroup) {
    const g = groups[index];
    const slot = g?.slot && onDoll(g.slot) ? g.slot : LOOSE;
    const label = g?.label?.trim() || (slot === LOOSE && g?.slot ? g.slot : null);
    bySlot.set(slot, [...(bySlot.get(slot) ?? []), { index, label, enabled: g?.enabled ?? true, rows: list }]);
  }

  const slots = new Map<string, DollSlot>();
  for (const id of new Set([...items.keys(), ...bySlot.keys()])) {
    if (id === LOOSE) continue;
    slots.set(id, fill(id, items.get(id) ?? null, bySlot.get(id) ?? []));
  }
  const looseGroups = bySlot.get(LOOSE);
  const loose = looseGroups ? { id: LOOSE, item: null, sockets: [], virtualSockets: false, groups: looseGroups, overflow: [], warnings: [] } : null;
  return { slots, loose, hasSwap: [...slots.keys()].some(isSwap) };
}

/** Сколько гнёзд помещается на месте слота: 1 клетка — 1, остальное — до 6. */
function capacity(slot: string): number {
  const p = DOLL_PLACES[placeName(slot)];
  return Math.min(6, p ? p.w * p.h : 6);
}

function fill(id: string, item: PobStageRow | null, groups: DollGroup[]): DollSlot {
  const warnings: string[] = [];
  const overflow: PobStageRow[] = [];
  const parsed = item?.item?.sockets ? parseSockets(item.item.sockets.text) : [];
  const virtual = parsed.length === 0 && groups.length > 0;

  let socketGroups: DollSocket[][];
  if (virtual) {
    // Гнёзда по камням: каждая связка — своя группа, цвет — цвет камня.
    let left = capacity(id);
    socketGroups = [];
    for (const g of groups) {
      const fit = g.rows.slice(0, left);
      overflow.push(...g.rows.slice(left));
      left -= fit.length;
      if (fit.length) socketGroups.push(fit.map((r) => ({ color: gemColor(r) ?? "W", linked: true, gem: r, mismatch: false })));
    }
    warnings.push(item ? "PoB не записал гнёзда предмета — гнёзда нарисованы по камням" : "В этом этапе в слоте нет предмета — гнёзда нарисованы по камням");
  } else {
    socketGroups = parsed.map((g) => g.map((color) => ({ color, linked: true, gem: null, mismatch: false })));
    const free = socketGroups.map((g, i) => ({ i, len: g.filter((s) => s.color !== "A").length, used: false }));
    // Сначала длинные связки: им важнее найти подходящую группу гнёзд.
    for (const g of [...groups].sort((a, b) => b.rows.length - a.rows.length)) {
      const open = free.filter((f) => !f.used && f.len > 0);
      const pick = open.filter((f) => f.len >= g.rows.length).sort((a, b) => a.len - b.len)[0] ?? open.sort((a, b) => b.len - a.len)[0];
      if (!pick) {
        overflow.push(...g.rows);
        continue;
      }
      pick.used = true;
      if (pick.len < g.rows.length) warnings.push(`${groupName(g).replace(/^./, (c) => c.toUpperCase())}: ${g.rows.length} ${plural(g.rows.length, "камень", "камня", "камней")}, а связано гнёзд ${pick.len}`);
      overflow.push(...place(socketGroups[pick.i], g.rows));
    }
  }
  for (const g of socketGroups) g[g.length - 1].linked = false;

  const sockets = socketGroups.flat();
  const mismatched = sockets.filter((s) => s.mismatch).length;
  if (mismatched) warnings.push(`${mismatched} ${plural(mismatched, "камень", "камня", "камней")} не по цвету гнезда — нужна перекраска`);
  if (overflow.length) warnings.push(`${overflow.length} ${plural(overflow.length, "камень не помещается", "камня не помещаются", "камней не помещаются")} в гнёзда`);
  return { id, item, sockets, virtualSockets: virtual, groups, overflow, warnings };
}

/** Камни связки → гнёзда группы: свой цвет, затем подходящее (белое гнездо, белый или неизвестный камень), затем любое. Возвращает не поместившиеся. */
function place(sockets: DollSocket[], rows: PobStageRow[]): PobStageRow[] {
  let pending = [...rows];
  const fits = (s: DollSocket, c: SocketColor | null) => c === null || c === "W" || s.color === "W" || s.color === c;
  const passes: ((s: DollSocket, c: SocketColor | null) => boolean)[] = [(s, c) => c !== null && s.color === c, fits, () => true];
  passes.forEach((test, pass) => {
    pending = pending.filter((r) => {
      const c = gemColor(r);
      const s = sockets.find((s) => !s.gem && s.color !== "A" && test(s, c));
      if (!s) return true;
      s.gem = r;
      s.mismatch = pass === 2 && !fits(s, c);
      return false;
    });
  });
  return pending;
}
