/**
 * Строка поиска вкладки сундука по набору (shared/docs/map-regex.md, раздел 1 «Как собирается
 * выражение»). Блоки, пороги и их порядок — как на сайте «Атлас — конструктор RegEx»; токены —
 * наши, из набора данных (`map-search.json`).
 *
 * Здесь только чистые функции и только типовые импорты: файл можно запустить в Node и сверить
 * результат с сайтом побайтно.
 */
import type { GameLang, MapRegexPreset, MapSearchIndex, ModChoice, ThresholdMode } from "./model";
import type { LocalizedLines } from "@/generated/LocalizedLines";
import type { LocalizedSearchToken } from "@/generated/LocalizedSearchToken";
import type { MapProperty } from "@/generated/MapProperty";

/** Лимит поля поиска вкладки сундука. */
export const EXPRESSION_MAX = 250;
export const NUMBER_MIN = 1;
export const NUMBER_MAX = 9999;

export type ExpressionIssue =
  /** Выражение длиннее лимита игры. */
  | { kind: "too-long"; length: number }
  /** Моды набора, которых больше нет в наборе данных: в выражение не попали. */
  | { kind: "unknown-mods"; modIds: string[] }
  /** Нет короткой строки поиска — взята строка игры целиком (моды и свойства). */
  | { kind: "whole-line"; ids: string[] }
  /** Нет текста на языке игры — пропущены. */
  | { kind: "no-text"; ids: string[] }
  /** Токен мода находит и другие моды (обычный ↔ nightmare), которые выбраны иначе. */
  | { kind: "overlap"; modId: string; choice: ModChoice; others: string[] }
  /** Порог не целое число 1–9999 — пропущен. */
  | { kind: "bad-number"; propertyIds: string[] }
  /** Исключены все редкости — блок не строится. */
  | { kind: "all-rarities-excluded" };

export type Expression = {
  /** Блоки через пробел; пусто, если ничего не выбрано. */
  text: string;
  blocks: string[];
  issues: ExpressionIssue[];
};

/** Ошибка ввода (в отличие от предупреждения): выражение собрано без этой части. */
export function isError(issue: ExpressionIssue): boolean {
  return issue.kind === "bad-number" || issue.kind === "all-rarities-excluded" || issue.kind === "no-text";
}

export function isThreshold(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= NUMBER_MIN && value <= NUMBER_MAX;
}

export function buildExpression(preset: MapRegexPreset, index: MapSearchIndex): Expression {
  const lang = preset.lang;
  const blocks: string[] = [];
  const issues: ExpressionIssue[] = [];
  const wholeLine: string[] = [];
  const noText: string[] = [];

  const unknown = Object.keys(preset.mods)
    .filter((id) => !index.modById.has(id))
    .sort();
  if (unknown.length) issues.push({ kind: "unknown-mods", modIds: unknown });

  /** Токены модов с этим выбором, в порядке набора данных, без повторов. */
  const modTokens = (choice: ModChoice): string[] => {
    const values: string[] = [];
    for (const mod of index.mods) {
      if (preset.mods[mod.id] !== choice) continue;
      const token = entryToken(mod, lang, false);
      if (token === null) {
        noText.push(mod.id);
        continue;
      }
      if (token.wholeLine) wholeLine.push(mod.id);
      if (!values.includes(token.value)) values.push(token.value);
      const others = (searchOf(mod.search, lang)?.overlaps ?? []).filter((other) => preset.mods[other] !== choice);
      if (others.length) issues.push({ kind: "overlap", modId: mod.id, choice, others });
    }
    return values;
  };

  const avoid = modTokens("AVOID");
  const want = modTokens("WANT");
  if (avoid.length) blocks.push(`"!${avoid.join("|")}"`);
  if (preset.wantMode === "ANY") {
    if (want.length) blocks.push(`"${want.join("|")}"`);
  } else blocks.push(...want.map((token) => `"${token}"`));

  // Пороги: `<токен>.*<не меньше N>%`; награды и качество — каждая группа по своему правилу.
  const yieldParts: string[] = [];
  const qualityParts: string[] = [];
  const badNumbers: string[] = [];
  for (const property of index.properties) {
    if (property.kind !== "NUMBER" || (property.group !== "YIELD" && property.group !== "QUALITY")) continue;
    const value = preset.numbers[property.id];
    if (value === undefined) continue;
    if (!isThreshold(value)) {
      badNumbers.push(property.id);
      continue;
    }
    const token = entryToken(property, lang, true);
    if (token === null) {
      noText.push(property.id);
      continue;
    }
    if (token.wholeLine) wholeLine.push(property.id);
    const quality = property.group === "QUALITY";
    const mode = quality ? preset.qualityRule.mode : preset.yieldRule.mode;
    (quality ? qualityParts : yieldParts).push(`${token.value}.*${numberPattern(value, mode)}%`);
  }
  for (const [parts, any] of [
    [yieldParts, preset.yieldRule.any],
    [qualityParts, preset.qualityRule.any],
  ] as const) {
    if (any && parts.length) blocks.push(`"(${parts.join("|")})"`);
    else blocks.push(...parts.map((part) => `"${part}"`));
  }

  // Признаки: включить — `"x"`, исключить — `!"x"`.
  const flagToken = (property: MapProperty): string | null => {
    const token = entryToken(property, lang, false);
    if (token === null) noText.push(property.id);
    else if (token.wholeLine) wholeLine.push(property.id);
    return token?.value ?? null;
  };
  for (const property of group(index, "STATE")) {
    const flag = preset.flags[property.id];
    if (flag === undefined) continue;
    const token = flagToken(property);
    if (token !== null) blocks.push(`${flag === "EXCLUDE" ? "!" : ""}"${token}"`);
  }

  const rarities = group(index, "RARITY");
  const picked = rarities.filter((property) => preset.rarity.keys.includes(property.id));
  if (picked.length && picked.length === rarities.length && preset.rarity.mode === "EXCLUDE") issues.push({ kind: "all-rarities-excluded" });
  if (picked.length && picked.length !== rarities.length) {
    const tokens = picked.map(flagToken).filter((token): token is string => token !== null);
    if (tokens.length) blocks.push(`${preset.rarity.mode === "EXCLUDE" ? "!" : ""}"${tokens.join("|")}"`);
  }

  if (preset.useTypes) {
    const include: string[] = [];
    const exclude: string[] = [];
    for (const property of group(index, "TYPE")) {
      const flag = preset.flags[property.id];
      if (flag === undefined) continue;
      const token = flagToken(property);
      if (token !== null) (flag === "EXCLUDE" ? exclude : include).push(token);
    }
    if (include.length) blocks.push(`"${include.join("|")}"`);
    if (exclude.length) blocks.push(`!"${exclude.join("|")}"`);
  }

  const text = blocks.join(" ");
  if (badNumbers.length) issues.push({ kind: "bad-number", propertyIds: badNumbers });
  if (noText.length) issues.push({ kind: "no-text", ids: noText });
  if (wholeLine.length) issues.push({ kind: "whole-line", ids: wholeLine });
  if (text.length > EXPRESSION_MAX) issues.push({ kind: "too-long", length: text.length });
  return { text, blocks, issues };
}

/**
 * «Не меньше n» цифрами: 75 → `(7[5-9]|[8-9].|\d..)` — последняя ветка ловит числа длиннее n.
 * ROUNDED округляет n вниз до десятка (от 10): строка короче, порог чуть мягче.
 */
export function numberPattern(n: number, mode: ThresholdMode): string {
  const value = mode === "ROUNDED" && n >= 10 ? Math.floor(n / 10) * 10 : n;
  const digits = String(value);
  return `(${[...atLeastForWidth(digits), "\\d" + ".".repeat(digits.length)].join("|")})`;
}

function digitRange(low: number, high: number): string {
  return low === high ? String(low) : `[${low}-${high}]`;
}

/** Числа той же длины, что `digits`, не меньше его. */
function atLeastForWidth(digits: string): string[] {
  if (digits.length === 1) return [digitRange(Number(digits), 9)];
  const head = Number(digits[0]);
  const tail = digits.slice(1);
  if (/^0+$/.test(tail)) return [digitRange(head, 9) + ".".repeat(tail.length)];
  const out = atLeastForWidth(tail).map((part) => head + part);
  if (head < 9) out.push(digitRange(head + 1, 9) + ".".repeat(tail.length));
  return out;
}

/**
 * Строка игры → регулярка, если короткой строки нет: нижний регистр, служебные символы
 * экранированы, диапазоны `(30-70)` и `#` — любое число. Русский поиск игры не различает «й»
 * и «и»; «ё» заменяется любым символом (токены бэкенда её не содержат).
 */
export function linePattern(line: string, lang: GameLang): string {
  let text = line.toLowerCase().replace(/"/g, "");
  if (lang === "RU") text = text.replace(/й/g, "и");
  return text
    .split(/\(-?\d+(?:\.\d+)?[-–]-?\d+(?:\.\d+)?\)|#/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ё/g, "."))
    .join("[\\d.]+");
}

function searchOf(search: LocalizedSearchToken, lang: GameLang) {
  return lang === "RU" ? search.ru : search.en;
}

function linesOf(lines: LocalizedLines, lang: GameLang): string[] | null {
  return lang === "RU" ? lines.ru : lines.en;
}

/**
 * Токен записи на языке игры или запасной вариант — первая строка целиком (у свойства-числа —
 * часть строки до числа, потому что за токеном следует `.*<число>%`). `null` — нет и строки.
 */
function entryToken(entry: { lines: LocalizedLines; search: LocalizedSearchToken }, lang: GameLang, beforeNumber: boolean): { value: string; wholeLine: boolean } | null {
  const token = searchOf(entry.search, lang)?.token;
  if (token) return { value: token, wholeLine: false };
  const line = linesOf(entry.lines, lang)?.[0];
  if (!line) return null;
  return { value: linePattern(beforeNumber ? (line.split("#")[0] ?? line) : line, lang), wholeLine: true };
}

function group(index: MapSearchIndex, name: MapProperty["group"]): MapProperty[] {
  return index.properties.filter((property) => property.group === name && property.kind === "FLAG");
}
