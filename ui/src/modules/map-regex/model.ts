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
import { EXPRESSION_MAX, isThreshold, NUMBER_MAX, NUMBER_MIN, type ExpressionIssue } from "./regex";

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
    case "overlap":
      return issue.choice === "AVOID"
        ? `Исключение ${entryName(index, issue.modId, lang)} отсеет и карты с ${names(issue.others)}.`
        : `${entryName(index, issue.modId, lang)} подсветит и карты с ${names(issue.others)}.`;
    case "bad-number":
      return `Порог — целое число от ${NUMBER_MIN} до ${NUMBER_MAX}: ${names(issue.propertyIds)}.`;
    case "all-rarities-excluded":
      return "Нельзя исключить все редкости сразу.";
  }
}
