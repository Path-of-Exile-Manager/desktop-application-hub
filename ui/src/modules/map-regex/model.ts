/**
 * RegEx карт (shared/docs/map-regex.md, раздел 2): набор пользователя — какие моды карт исключить
 * или требовать и какие свойства карты учесть. Моды и свойства — из набора данных
 * (`map-search.json`, команда ядра `catalog_map_search`); наборы — коллекция `mapRegexPresets`
 * в user.db, синхронизируется с аккаунтом.
 */
import type { MapProperty } from "@/generated/MapProperty";
import type { MapPropertyGroup } from "@/generated/MapPropertyGroup";
import type { MapSearch } from "@/generated/MapSearch";
import type { MapSearchMod } from "@/generated/MapSearchMod";
import { EXPRESSION_MAX, isThreshold, NUMBER_MAX, NUMBER_MIN, type ExpressionIssue, type ParsedExpression } from "./regex";

export type { MapProperty, MapSearch, MapSearchMod };

export const NAME_MAX = 40;
export const DEFAULT_NAME = "Мой первый набор";

/** Язык клиента игры: от него зависят токены. */
export type GameLang = "EN" | "RU";
export type ModChoice = "AVOID" | "WANT";
/** Нужные моды: достаточно любого или нужны все. */
export type WantMode = "ANY" | "ALL";
export type Inclusion = "INCLUDE" | "EXCLUDE";
/** ROUNDED — порог округляется вниз до десятка: выражение короче. */
export type ThresholdMode = "EXACT" | "ROUNDED";

const GAME_LANGS: readonly GameLang[] = ["EN", "RU"];
const WANT_MODES: readonly WantMode[] = ["ANY", "ALL"];
const INCLUSIONS: readonly Inclusion[] = ["INCLUDE", "EXCLUDE"];
const THRESHOLD_MODES: readonly ThresholdMode[] = ["EXACT", "ROUNDED"];

/** Как собирать пороги одной группы (награды или качество). */
export type ThresholdRule = {
  mode: ThresholdMode;
  /** true — достаточно любого порога группы (один блок), false — нужны все. */
  any: boolean;
};

/** Запись коллекции `mapRegexPresets`. */
export type MapRegexPreset = {
  id: string;
  /** 1–40 символов. */
  name: string;
  lang: GameLang;
  wantMode: WantMode;
  /** Ключ семейства мода (`map:…`) → выбор. Ключи, которых нет в наборе данных, сохраняются. */
  mods: Record<string, ModChoice>;
  /** Ключ свойства-числа (`quantity`, `quality-rarity`…) → порог, целое 1–9999. */
  numbers: Record<string, number>;
  /** Ключ признака состояния или типа карты (`corrupted`, `type-shaper`…); нет ключа — «любые». */
  flags: Record<string, Inclusion>;
  /** Отмеченные редкости (`rarity-normal`…); пусто — любая. */
  rarity: { keys: string[]; mode: Inclusion };
  yieldRule: ThresholdRule;
  qualityRule: ThresholdRule;
  /** Выключено — типы карт сохраняются, но в выражение не идут. */
  useTypes: boolean;
  sortKey: string;
  createdAt: string;
};

/** Поля нового набора, кроме тех, что задаёт хранилище. Значения по умолчанию — как на сайте. */
export function presetDefaults(): Omit<MapRegexPreset, "id" | "name" | "sortKey" | "createdAt"> {
  return {
    lang: "EN",
    wantMode: "ANY",
    mods: {},
    numbers: {},
    flags: {},
    rarity: { keys: [], mode: "INCLUDE" },
    yieldRule: { mode: "EXACT", any: false },
    qualityRule: { mode: "EXACT", any: true },
    useTypes: false,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function oneOf<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return values.includes(value as T) ? (value as T) : fallback;
}

function entriesWhere<T>(value: unknown, keep: (v: unknown) => v is T): Record<string, T> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, T] => keep(entry[1])));
}

const isChoice = (v: unknown): v is ModChoice => v === "AVOID" || v === "WANT";
const isInclusion = (v: unknown): v is Inclusion => v === "INCLUDE" || v === "EXCLUDE";

/**
 * Запись из хранилища → набор: недостающее и испорченное заменяется значениями по умолчанию,
 * чтобы старая или чужая запись не роняла вкладку. `null` — это не набор вовсе.
 */
export function normalizePreset(raw: unknown): MapRegexPreset | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.name !== "string") return null;
  const defaults = presetDefaults();
  const rule = (value: unknown, fallback: ThresholdRule): ThresholdRule =>
    isRecord(value) ? { mode: oneOf(value.mode, THRESHOLD_MODES, fallback.mode), any: typeof value.any === "boolean" ? value.any : fallback.any } : fallback;
  const rarity = isRecord(raw.rarity) ? raw.rarity : {};
  const rarityKeys = Array.isArray(rarity.keys) ? rarity.keys.filter((key): key is string => typeof key === "string") : [];
  return {
    id: raw.id,
    name: raw.name,
    lang: oneOf(raw.lang, GAME_LANGS, defaults.lang),
    wantMode: oneOf(raw.wantMode, WANT_MODES, defaults.wantMode),
    mods: entriesWhere(raw.mods, isChoice),
    numbers: entriesWhere(raw.numbers, isThreshold),
    flags: entriesWhere(raw.flags, isInclusion),
    rarity: { keys: [...new Set(rarityKeys)], mode: oneOf(rarity.mode, INCLUSIONS, defaults.rarity.mode) },
    yieldRule: rule(raw.yieldRule, defaults.yieldRule),
    qualityRule: rule(raw.qualityRule, defaults.qualityRule),
    useTypes: typeof raw.useTypes === "boolean" ? raw.useTypes : defaults.useTypes,
    sortKey: typeof raw.sortKey === "string" ? raw.sortKey : "",
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
  };
}

/**
 * Разобранная строка → набор: моды и параметры карт заменяются распознанными, язык — тем, на котором
 * строка узналась. Округлённый порог неотличим от точного (25 → 20 читается как 20): режим — EXACT.
 */
export function applyParsed(preset: MapRegexPreset, parsed: ParsedExpression): MapRegexPreset {
  return {
    ...preset,
    lang: parsed.lang,
    wantMode: parsed.wantMode,
    mods: parsed.mods,
    numbers: parsed.numbers,
    flags: parsed.flags,
    rarity: parsed.rarity,
    yieldRule: { mode: "EXACT", any: parsed.yieldAny ?? preset.yieldRule.any },
    qualityRule: { mode: "EXACT", any: parsed.qualityAny ?? preset.qualityRule.any },
    useTypes: parsed.useTypes,
  };
}

/** Ключи набора, которых нет в текущем наборе данных: мод или свойство ушли из игры (или сменили текст). */
export function staleKeys(preset: MapRegexPreset, index: MapSearchIndex): { mods: string[]; properties: string[] } {
  const known = (id: string) => index.propertyById.has(id);
  const properties = [...Object.keys(preset.numbers), ...Object.keys(preset.flags), ...preset.rarity.keys].filter((id) => !known(id));
  return { mods: Object.keys(preset.mods).filter((id) => !index.modById.has(id)).sort(), properties: [...new Set(properties)].sort() };
}

/** Убрать из набора ключи (пропавшие моды и свойства). */
export function dropKeys(preset: MapRegexPreset, keys: string[]): MapRegexPreset {
  const drop = new Set(keys);
  const keep = <T,>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([id]) => !drop.has(id)));
  return {
    ...preset,
    mods: keep(preset.mods),
    numbers: keep(preset.numbers),
    flags: keep(preset.flags),
    rarity: { ...preset.rarity, keys: preset.rarity.keys.filter((id) => !drop.has(id)) },
  };
}

/** Ключ без текста → читаемо: `map:players-have-…:nightmare` → «players have … (Nightmare)». */
export function humanizeKey(key: string): string {
  const nightmare = key.endsWith(":nightmare");
  const words = key.replace(/^map:/, "").replace(/:nightmare$/, "").replace(/-/g, " ");
  return nightmare ? `${words} (Nightmare)` : words;
}

/** «Снять все» в колонке: убрать отметки одной стороны у модов из набора данных (пропавшие — у баннера). */
export function clearSide(preset: MapRegexPreset, choice: ModChoice, index: MapSearchIndex): MapRegexPreset {
  return { ...preset, mods: Object.fromEntries(Object.entries(preset.mods).filter(([id, c]) => c !== choice || !index.modById.has(id))) };
}

/** «Сбросить выбор»: только моды, параметры карт остаются. */
export function resetChoices(preset: MapRegexPreset): MapRegexPreset {
  return { ...preset, mods: {} };
}

/** «Сбросить всё»: моды и параметры карт; имя, язык и режим нужных модов остаются. */
export function resetAll(preset: MapRegexPreset): MapRegexPreset {
  const { lang: _lang, wantMode: _wantMode, ...cleared } = presetDefaults();
  return { ...preset, ...cleared };
}

/** Отметить мод в колонке; повторная отметка снимает. Мод бывает только в одной колонке. */
export function toggleMod(preset: MapRegexPreset, modId: string, choice: ModChoice): MapRegexPreset {
  const mods = { ...preset.mods };
  if (mods[modId] === choice) delete mods[modId];
  else mods[modId] = choice;
  return { ...preset, mods };
}

/** Порог свойства-числа; `null` — не учитывать. */
export function setNumber(preset: MapRegexPreset, propertyId: string, value: number | null): MapRegexPreset {
  const numbers = { ...preset.numbers };
  if (value === null) delete numbers[propertyId];
  else numbers[propertyId] = value;
  return { ...preset, numbers };
}

/** Признак состояния или типа карты; `null` — «любые». */
export function setFlag(preset: MapRegexPreset, propertyId: string, value: Inclusion | null): MapRegexPreset {
  const flags = { ...preset.flags };
  if (value === null) delete flags[propertyId];
  else flags[propertyId] = value;
  return { ...preset, flags };
}

export function toggleRarity(preset: MapRegexPreset, propertyId: string): MapRegexPreset {
  const keys = preset.rarity.keys.includes(propertyId) ? preset.rarity.keys.filter((k) => k !== propertyId) : [...preset.rarity.keys, propertyId];
  return { ...preset, rarity: { ...preset.rarity, keys } };
}

/** Сколько параметров карты сейчас попадает в выражение. */
export function activeOptions(preset: MapRegexPreset, index: MapSearchIndex): number {
  let count = Object.keys(preset.numbers).length + (preset.rarity.keys.length ? 1 : 0);
  for (const [id] of Object.entries(preset.flags)) {
    const group = index.propertyById.get(id)?.group;
    if (group === "STATE" || (group === "TYPE" && preset.useTypes)) count++;
  }
  return count;
}

/** Текст для поиска по списку: без регистра, «ё» = «е», «й» = «и» (как поиск игры). */
export function searchKey(text: string): string {
  return text.toLowerCase().replace(/ё/g, "е").replace(/й/g, "и");
}

/** Порядок групп свойств на экране и в выражении. */
export const GROUP_ORDER: readonly MapPropertyGroup[] = ["YIELD", "QUALITY", "STATE", "RARITY", "TYPE"];

/** Данные вкладки с поиском по ключу. */
export type MapSearchIndex = {
  /** Как в наборе данных: по ключу. */
  mods: MapSearchMod[];
  modById: ReadonlyMap<string, MapSearchMod>;
  /** По группам в порядке `GROUP_ORDER`, внутри — по `sortOrder`; незнакомые группы — в конце. */
  properties: MapProperty[];
  propertyById: ReadonlyMap<string, MapProperty>;
};

export function indexMapSearch(data: MapSearch): MapSearchIndex {
  const rank = (group: MapPropertyGroup) => {
    const i = GROUP_ORDER.indexOf(group);
    return i < 0 ? GROUP_ORDER.length : i;
  };
  const properties = [...data.properties].sort((a, b) => rank(a.group) - rank(b.group) || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  return {
    mods: data.mods,
    modById: new Map(data.mods.map((mod) => [mod.id, mod])),
    properties,
    propertyById: new Map(properties.map((property) => [property.id, property])),
  };
}

/** Текст мода на языке игры (нет перевода — английский), строки через « · ». */
export function modText(mod: MapSearchMod, lang: GameLang): string {
  return ((lang === "RU" ? mod.lines.ru : null) ?? mod.lines.en).join(" · ");
}

/** Подпись свойства в интерфейсе — по-русски, если есть. */
export function propertyLabel(property: MapProperty): string {
  return property.label.ru ?? property.label.en;
}

/** Название мода или свойства для сообщения; пропавший мод — его ключ. */
function entryName(index: MapSearchIndex, id: string, lang: GameLang): string {
  const mod = index.modById.get(id);
  if (mod) return `«${modText(mod, lang)}»`;
  const property = index.propertyById.get(id);
  return property ? `«${propertyLabel(property)}»` : id;
}

/**
 * Моды, которые не отмечены, но всё равно попадут под строку поиска отмеченного мода (его токен находит
 * и их — обычно Nightmare-близнеца): id → выбор и через какие моды.
 */
export function impliedChoices(preset: MapRegexPreset, index: MapSearchIndex): Map<string, { choice: ModChoice; via: string[] }> {
  const implied = new Map<string, { choice: ModChoice; via: string[] }>();
  for (const [id, choice] of Object.entries(preset.mods)) {
    const mod = index.modById.get(id);
    if (!mod) continue;
    const overlaps = (preset.lang === "RU" ? mod.search.ru : mod.search.en)?.overlaps ?? [];
    for (const other of overlaps) {
      if (preset.mods[other] !== undefined || !index.modById.has(other)) continue;
      const entry = implied.get(other) ?? { choice, via: [] };
      entry.via.push(id);
      implied.set(other, entry);
    }
  }
  return implied;
}

/** Отметить моды той же стороной (пересечение «захватит их» — пусть это будет видно в наборе). */
export function markMods(preset: MapRegexPreset, ids: string[], choice: ModChoice): MapRegexPreset {
  return { ...preset, mods: { ...preset.mods, ...Object.fromEntries(ids.map((id) => [id, choice])) } };
}

/** Снять отметку мода. */
export function unmarkMod(preset: MapRegexPreset, id: string): MapRegexPreset {
  const mods = { ...preset.mods };
  delete mods[id];
  return { ...preset, mods };
}

/** Короткое имя записи для списков: текст мода или подпись свойства (пропавший — ключ). */
export function entryLabel(index: MapSearchIndex, id: string, lang: GameLang): string {
  const mod = index.modById.get(id);
  if (mod) return modText(mod, lang);
  const property = index.propertyById.get(id);
  return property ? property.label.en : humanizeKey(id);
}

/** Предупреждение или ошибка выражения словами. */
export function describeIssue(issue: ExpressionIssue, index: MapSearchIndex, lang: GameLang): string {
  const names = (ids: string[]) => ids.map((id) => entryName(index, id, lang)).join(", ");
  switch (issue.kind) {
    case "too-long":
      return `Выражение длиннее ${EXPRESSION_MAX} символов (${issue.length}) — поиск игры его обрежет.`;
    case "unknown-mods":
      return `Больше не встречаются в игре и в выражение не попали (${issue.modIds.length}): ${issue.modIds.join(", ")}.`;
    case "whole-line":
      return `Нет короткой строки поиска — взята строка целиком: ${names(issue.ids)}.`;
    case "no-text":
      return `Нет текста на языке игры — пропущено: ${names(issue.ids)}.`;
    case "overlap": {
      const source = entryName(index, issue.modId, lang);
      const others = names([...issue.conflicts, ...issue.extra]);
      if (issue.conflicts.length)
        return issue.choice === "AVOID"
          ? `Исключение ${source} отсеет и нужные ${names(issue.conflicts)}.`
          : `${source} подсветит и исключённые ${names(issue.conflicts)}.`;
      return issue.choice === "AVOID" ? `Исключение ${source} отсеет и карты с ${others}.` : `${source} подсветит и карты с ${others}.`;
    }
    case "bad-number":
      return `Порог — целое число от ${NUMBER_MIN} до ${NUMBER_MAX}: ${names(issue.propertyIds)}.`;
    case "all-rarities-excluded":
      return "Нельзя исключить все редкости сразу.";
  }
}
