import type { FarmBossGroup } from "@/generated/FarmBossGroup";
import type { FarmBossRow } from "@/generated/FarmBossRow";
import type { FarmPoolKind } from "@/generated/FarmPoolKind";
import type { FarmRef } from "@/generated/FarmRef";
import type { FarmText } from "@/generated/FarmText";

// «Фарм → Боссы»: подписи, сортировка и форматирование. Расчёт — в ядре (src-tauri/src/farm.rs,
// крейт farm-engine), здесь только показ. План — shared/docs/boss-farm.md, раздел 7.5.

export type NameLanguage = "ru" | "en";

export const nameIn = (name: FarmText, language: NameLanguage) => (language === "ru" ? (name.ru ?? name.en) : name.en);

/** Другое имя — для подсказки: на русском показываем английское и наоборот; совпадают — нет. */
export const otherName = (name: FarmText, language: NameLanguage) => {
  const other = language === "ru" ? name.en : (name.ru ?? null);
  return other && other !== nameIn(name, language) ? other : undefined;
};

export const GROUPS: { id: FarmBossGroup; label: string }[] = [
  { id: "pinnacle", label: "Пиннаклы" },
  { id: "pinnacle-uber", label: "Убер-боссы" },
  { id: "invitation", label: "Приглашения" },
  { id: "t17", label: "Карты T17" },
  { id: "league", label: "Боссы лиг" },
  { id: "other", label: "Другие" },
  { id: "unknown", label: "Прочие" },
];

export const GROUP_LABEL = Object.fromEntries(GROUPS.map((g) => [g.id, g.label])) as Record<FarmBossGroup, string>;

export type GroupFilter = FarmBossGroup | "all";

export const PATCH_LABEL: Record<string, string> = { new: "новый", changed: "изменён" };

export const POOL_TITLE: Record<FarmPoolKind, string> = {
  "one-of": "Выпадает одно из…",
  independent: "Дополнительно",
  unknown: "Прочий дроп",
};

// ---------- сортировка ----------

export type SortKey = "profitPerHour" | "profit" | "ev" | "entry" | "risk" | "name";

export type Sort = { key: SortKey; desc: boolean };

export const DEFAULT_SORT: Sort = { key: "profitPerHour", desc: true };

export const SORTS: { id: SortKey; label: string }[] = [
  { id: "profitPerHour", label: "Прибыль в час" },
  { id: "profit", label: "Прибыль за убийство" },
  { id: "ev", label: "Доход (EV)" },
  { id: "entry", label: "Вход" },
  { id: "risk", label: "Риск" },
  { id: "name", label: "Имя" },
];

/** Первое нажатие: деньги — от больших, вход, риск и имя — от меньших. */
export function firstDirectionDesc(key: SortKey): boolean {
  return key !== "entry" && key !== "risk" && key !== "name";
}

export function nextSort(current: Sort, key: SortKey): Sort {
  return current.key === key ? { key, desc: !current.desc } : { key, desc: firstDirectionDesc(key) };
}

function sortValue(row: FarmBossRow, key: SortKey): number | null {
  const s = row.summary;
  switch (key) {
    case "profitPerHour":
      return s.profitPerHour;
    case "profit":
      return s.profit;
    case "ev":
      return s.ev;
    case "entry":
      return s.entryCost;
    case "risk":
      return s.hour?.lossChance ?? null;
    case "name":
      return null;
  }
}

/** Сортировка; строки без значения (нет цены входа, нет TTK) — всегда внизу, внутри — по имени. */
export function sortRows(rows: FarmBossRow[], sort: Sort, language: NameLanguage): FarmBossRow[] {
  const byName = (a: FarmBossRow, b: FarmBossRow) => nameIn(a.name, language).localeCompare(nameIn(b.name, language), language);
  if (sort.key === "name") return [...rows].sort((a, b) => (sort.desc ? -byName(a, b) : byName(a, b)));
  return [...rows].sort((a, b) => {
    const x = sortValue(a, sort.key);
    const y = sortValue(b, sort.key);
    if (x === null || y === null) return x === y ? byName(a, b) : x === null ? 1 : -1;
    return (sort.desc ? y - x : x - y) || byName(a, b);
  });
}

// ---------- форматирование ----------

/** Секунды как `1:10`, от часа — `1:02:05`. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** «1:10», «70», «1:02:05» → секунды; пусто или ошибка — `null`. */
export function parseDuration(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  const parts = t.split(":");
  if (parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  return parts.reduce((sum, p) => sum * 60 + Number(p), 0);
}

/** Число из поля: запятая — как точка; пусто — `null`, не число или < 0 — `undefined` (ошибка). */
export function parseAmount(text: string): number | null | undefined {
  const t = text.trim().replace(",", ".");
  if (!t) return null;
  const value = Number(t);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Доля 0…1 в процентах: `31 %`, `4.5 %`, `0.12 %`. */
export function formatPercent(fraction: number): string {
  const p = fraction * 100;
  if (p !== 0 && Math.abs(p) < 0.01) return "< 0.01 %";
  const digits = Math.abs(p) >= 10 ? 0 : Math.abs(p) >= 1 ? 1 : 2;
  return `${p.toFixed(digits).replace(/\.0+$/, "")} %`;
}

/** Обычное число: `24`, `2.5`, `0.35`. */
export function formatNumber(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return Number(value.toFixed(digits)).toLocaleString("ru-RU").replace(",", ".");
}

/** Ключ дропа для показа, пока имени нет под рукой: `unid-sublime-vision` → «Unid sublime vision». */
export function humanizeKey(key: string): string {
  const text = key.replace(/[-_]+/g, " ").trim();
  return text ? text[0].toUpperCase() + text.slice(1) : key;
}

/** `{ none: true }` — дроп не продаётся: своей цены у него нет. */
export const isUnsellable = (ref: FarmRef | null): boolean => ref === null || "none" in ref;

/** Слово по числу: `plural(3, "дроп", "дропа", "дропов")`. */
export function plural(n: number, one: string, few: string, many: string): string {
  const tens = n % 100;
  const ones = n % 10;
  if (tens >= 11 && tens <= 14) return many;
  if (ones === 1) return one;
  if (ones >= 2 && ones <= 4) return few;
  return many;
}

/** Статус ключа особой цены словами (`/v1/farm/bosses/:league`). */
export const QUOTE_STATUS: Record<string, string> = {
  OK: "",
  NEW: "ещё не искали",
  NO_MARKET: "мало лотов",
  UNCONFIRMED: "не подтверждена",
  FAILED: "поиск не удался",
};
