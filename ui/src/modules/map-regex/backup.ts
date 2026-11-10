/**
 * Импорт и экспорт наборов (shared/docs/map-regex.md, D8): наборы сайта «Атлас — конструктор RegEx»
 * (`localStorage['atlas-regex-v1']` или его файл `atlas-regex-backup.json`) и наша копия (экспорт вкладки).
 *
 * Сайт хранит выбор мода по его НОМЕРУ в своём списке из 118 модов. `data/site-mods.json` — тот же
 * порядок, но наши ключи семейств: сопоставлено один раз по тексту и проверено токенами сайта (236 из
 * 236). Текстов и токенов poe.re в репозитории нет.
 */
import siteMods from "./data/site-mods.json";
import { isThreshold } from "./regex";
import { DEFAULT_NAME, NAME_MAX, normalizePreset, presetDefaults, type Inclusion, type MapRegexPreset, type ModChoice } from "./model";

/** Набор без полей хранилища: id, порядок и дата появятся при записи. */
export type PresetDraft = Omit<MapRegexPreset, "id" | "sortKey" | "createdAt">;

export type BackupImport = {
  source: "site" | "app";
  presets: PresetDraft[];
  /** Какой набор сделать активным (на сайте — `current`). */
  activeIndex: number;
  /** Моды, номера которых нет в таблице сайта (на будущее, если сайт добавит моды). */
  unknownMods: number;
};

export const EXPORT_FORMAT = "poe-manager.map-regex";

/** Наша копия: все наборы как есть, без id — при восстановлении получат новые. */
export function exportPresets(presets: MapRegexPreset[]): string {
  const strip = ({ id: _id, sortKey: _sortKey, ...rest }: MapRegexPreset) => rest;
  return JSON.stringify({ format: EXPORT_FORMAT, version: 1, presets: presets.map(strip) }, null, 2);
}

/** Поля сайта → ключи наших свойств. */
const SITE_NUMBERS: Record<string, string> = {
  quantity: "quantity",
  pack: "pack-size",
  maps: "more-maps",
  rarity: "rarity",
  currency: "more-currency",
  scarab: "more-scarabs",
  divination: "more-divination-cards",
  quality: "quality-quantity",
  qpack: "quality-pack-size",
  qrarity: "quality-rarity",
  qcurrency: "quality-currency",
  qdiv: "quality-divination-cards",
  qscarab: "quality-scarabs",
};
const SITE_TYPES: Record<string, string> = {
  shaper: "type-shaper",
  elder: "type-elder",
  conqueror: "type-conqueror",
  originator: "type-originator",
  blighted: "type-blighted",
  ravaged: "type-blight-ravaged",
};
const SITE_RARITIES: Record<string, string> = { normal: "rarity-normal", magic: "rarity-magic", rare: "rarity-rare" };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const cleanName = (value: unknown): string => {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, NAME_MAX) : "";
  return name || DEFAULT_NAME;
};

const inclusion = (value: unknown): Inclusion | null => (value === "include" ? "INCLUDE" : value === "exclude" ? "EXCLUDE" : null);

/** Текст файла или вставленный JSON → наборы, или ошибка словами. */
export function parseBackup(text: string): BackupImport | string {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return "Это не JSON. Вставьте содержимое atlas-regex-backup.json или копию наборов этой вкладки.";
  }
  if (isRecord(raw) && raw.format === EXPORT_FORMAT) return fromApp(raw);
  if (isRecord(raw) && Array.isArray(raw.presets)) return fromSite(raw);
  return "Не похоже на наборы: нет списка presets.";
}

function fromApp(raw: Record<string, unknown>): BackupImport | string {
  const list = Array.isArray(raw.presets) ? raw.presets : [];
  const presets = list
    .map((p) => normalizePreset(isRecord(p) ? { ...p, id: "x" } : null))
    .filter((p): p is MapRegexPreset => p !== null)
    .map(({ id: _id, sortKey: _sortKey, createdAt: _createdAt, ...rest }) => ({ ...rest, name: cleanName(rest.name) }));
  if (!presets.length) return "В копии нет ни одного набора.";
  return { source: "app", presets, activeIndex: 0, unknownMods: 0 };
}

function fromSite(raw: Record<string, unknown>): BackupImport | string {
  const list = (raw.presets as unknown[]).filter(isRecord);
  if (!list.length) return "В данных сайта нет наборов.";
  if (list.some((p) => (p.lang !== "ru" && p.lang !== "en") || !isRecord(p.choices))) return "Данные сайта в неизвестном формате: у набора нет языка или выбора модов.";

  let unknownMods = 0;
  const presets = list.map((site): PresetDraft => {
    const preset: PresetDraft = { ...presetDefaults(), name: cleanName(site.name), lang: site.lang === "ru" ? "RU" : "EN", wantMode: site.wantMode === "all" ? "ALL" : "ANY" };

    for (const [indexText, choice] of Object.entries(site.choices as Record<string, unknown>)) {
      const key = (siteMods as string[])[Number(indexText)];
      const mapped: ModChoice | null = choice === "avoid" ? "AVOID" : choice === "want" ? "WANT" : null;
      if (!mapped) continue;
      if (key) preset.mods[key] = mapped;
      else unknownMods++;
    }

    const o = isRecord(site.options) ? site.options : {};
    if (isRecord(o.numbers)) {
      for (const [field, value] of Object.entries(o.numbers)) {
        const id = SITE_NUMBERS[field];
        const n = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : typeof value === "number" ? value : NaN;
        if (id && isThreshold(n)) preset.numbers[id] = n;
      }
    }
    preset.yieldRule = { mode: o.yieldMode === "optimized" ? "ROUNDED" : "EXACT", any: typeof o.yieldAny === "boolean" ? o.yieldAny : preset.yieldRule.any };
    preset.qualityRule = { mode: o.qualityMode === "optimized" ? "ROUNDED" : "EXACT", any: typeof o.qualityAny === "boolean" ? o.qualityAny : preset.qualityRule.any };
    for (const field of ["corrupted", "unidentified"] as const) {
      const value = inclusion(o[field]);
      if (value) preset.flags[field] = value;
    }
    if (Array.isArray(o.rarities)) preset.rarity.keys = [...new Set(o.rarities.map((r) => SITE_RARITIES[String(r)]).filter((k): k is string => !!k))];
    preset.rarity.mode = o.rarityMode === "exclude" ? "EXCLUDE" : "INCLUDE";
    preset.useTypes = o.useTypes === true;
    if (isRecord(o.types)) {
      for (const [type, value] of Object.entries(o.types)) {
        const id = SITE_TYPES[type];
        const flag = inclusion(value);
        if (id && flag) preset.flags[id] = flag;
      }
    }
    return preset;
  });

  const activeIndex = Math.max(0, list.findIndex((p) => p.id === raw.current));
  return { source: "site", presets, activeIndex, unknownMods };
}
