/**
 * Учёт Ancient Orb (MVP, shared/docs/ancient-orb-tracker.md, раздел 2): трекеры и журнал событий.
 * Попытки и итоги не хранятся — они вычисляются из журнала, поэтому удаление находки
 * не теряет потраченные сферы: они просто становятся частью следующей попытки.
 */

export const MAX_AMOUNT = 100_000_000;
export const MAX_TARGETS = 8;
export const MAX_NAME = 40;

export type Target = { id: string; name: string };

export type Tracker = {
  id: string;
  /** «Пояса». */
  title: string;
  /** Что считаем находкой. Свободный текст, без связи со справочником. */
  targets: Target[];
  /** Ожидаемое среднее сфер на находку: шкала полосы попытки. `null` — без полосы. */
  expected: number | null;
  /** Текущая лига трекера — метка, в которую идут новые события. */
  season: string;
  createdAt: number;
};

type EventBase = {
  id: string;
  trackerId: string;
  season: string;
  /** epoch ms */
  at: number;
  source: "manual" | "import";
};

export type SpendEvent = EventBase & { kind: "spend"; amount: number };
/** Копия имени цели: переименование или удаление цели не ломает историю. */
export type HitEvent = EventBase & { kind: "hit"; targetId: string; targetName: string };
export type OrbEvent = SpendEvent | HitEvent;

export type AncientData = {
  activeTrackerId: string;
  trackers: Tracker[];
  events: OrbEvent[];
};

export const DEFAULT_SEASON = "Текущая лига";

export function newId(): string {
  return crypto.randomUUID();
}

export function defaultTracker(): Tracker {
  return {
    id: newId(),
    title: "Пояса",
    targets: [
      { id: newId(), name: "Headhunter" },
      { id: newId(), name: "Mageblood" },
    ],
    expected: 1200,
    season: DEFAULT_SEASON,
    createdAt: Date.now(),
  };
}

export function defaultData(): AncientData {
  const tracker = defaultTracker();
  return { activeTrackerId: tracker.id, trackers: [tracker], events: [] };
}

// ─── Ввод ───────────────────────────────────────────────────────────────

/** «1 200», «1,200», «1200» → 1200. Не целое, ноль, больше лимита — `null`. */
export function parseAmount(text: string): number | null {
  const digits = text.replace(/[\s\u00a0\u202f,.'_]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) && n >= 1 && n <= MAX_AMOUNT ? n : null;
}

export function cleanName(text: string): string {
  return text.trim().replace(/\s+/g, " ").slice(0, MAX_NAME);
}

/** Для сравнения имён целей: без регистра и лишних пробелов. */
export function nameKey(name: string): string {
  return cleanName(name).toLocaleLowerCase("ru-RU");
}

// ─── Расчёты ────────────────────────────────────────────────────────────

const byTime = (a: OrbEvent, b: OrbEvent) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function seasonEvents(events: OrbEvent[], trackerId: string, season: string): OrbEvent[] {
  return events.filter((e) => e.trackerId === trackerId && e.season === season).sort(byTime);
}

export type Hit = {
  event: HitEvent;
  /** Номер попытки в лиге, с 1. */
  attempt: number;
  /** Сколько сфер ушло на эту попытку. */
  cost: number;
};

export type Summary = {
  /** Траты текущей попытки, от старых к новым. */
  current: SpendEvent[];
  currentTotal: number;
  /** Находки от старых к новым. */
  hits: Hit[];
  /** Все сферы лиги, включая текущую попытку. */
  total: number;
  /** Среднее по закрытым попыткам; `null` — находок ещё нет. */
  average: number | null;
  best: number | null;
  worst: number | null;
};

/** События одной лиги одного трекера (уже отсортированы `seasonEvents`) → попытки и итоги. */
export function summarize(events: OrbEvent[]): Summary {
  const hits: Hit[] = [];
  let current: SpendEvent[] = [];
  let currentTotal = 0;
  let total = 0;

  for (const e of events) {
    if (e.kind === "spend") {
      current.push(e);
      currentTotal += e.amount;
      total += e.amount;
    } else {
      hits.push({ event: e, attempt: hits.length + 1, cost: currentTotal });
      current = [];
      currentTotal = 0;
    }
  }

  const costs = hits.map((h) => h.cost);
  return {
    current,
    currentTotal,
    hits,
    total,
    average: costs.length ? Math.round(costs.reduce((a, b) => a + b, 0) / costs.length) : null,
    best: costs.length ? Math.min(...costs) : null,
    worst: costs.length ? Math.max(...costs) : null,
  };
}

/** Лиги трекера: текущая первой, затем прошлые — от последней активности к ранней. */
export function trackerSeasons(tracker: Tracker, events: OrbEvent[]): string[] {
  const lastAt = new Map<string, number>();
  for (const e of events) {
    if (e.trackerId !== tracker.id || e.season === tracker.season) continue;
    lastAt.set(e.season, Math.max(lastAt.get(e.season) ?? 0, e.at));
  }
  const past = [...lastAt.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
  return [tracker.season, ...past];
}

// ─── Импорт с сайта ancient-orb-casino ─────────────────────────────────

/** Формат `localStorage['ancient-orb-tracker-v1']` сайта. */
type WebEntry = { id: string; amount: number; date: number };
type WebDrop = WebEntry & { type: string };
export type WebExport = { entries: WebEntry[]; drops: WebDrop[] };

const WEB_TARGET_NAMES: Record<string, string> = { headhunter: "Headhunter", mageblood: "Mageblood" };

function isWebEntry(v: unknown): v is WebEntry {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    /^[A-Za-z0-9_-]{1,100}$/.test(o.id) &&
    typeof o.amount === "number" &&
    Number.isSafeInteger(o.amount) &&
    o.amount >= 1 &&
    o.amount <= MAX_AMOUNT &&
    typeof o.date === "number" &&
    Number.isFinite(o.date)
  );
}

/** Разбор вставленного JSON. Ошибка — текст для пользователя. */
export function parseWebExport(text: string): WebExport | string {
  let raw: unknown;
  try {
    raw = JSON.parse(text.trim());
  } catch {
    return "Это не JSON. Скопируйте данные командой из подсказки.";
  }
  if (!raw || typeof raw !== "object") return "Не похоже на данные сайта.";
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.entries) || !Array.isArray(o.drops)) return "Не похоже на данные сайта: нет entries и drops.";
  if (!o.entries.every(isWebEntry)) return "В entries есть неверная запись.";
  if (!o.drops.every((d) => isWebEntry(d) && typeof (d as Record<string, unknown>).type === "string"))
    return "В drops есть неверная запись.";
  return { entries: o.entries, drops: o.drops as WebDrop[] };
}

export type ImportResult = {
  tracker: Tracker;
  events: OrbEvent[];
  added: number;
  skipped: number;
};

/**
 * Данные сайта → события трекера в выбранной лиге. Каждая находка сайта — одна трата на её сумму
 * (журнал закрытых попыток сайт не хранил) и событие находки. Id от id сайта: повторный импорт
 * пропускает то, что уже есть. Цели, которых нет в трекере, добавляются.
 */
export function importWeb(data: WebExport, tracker: Tracker, season: string, existing: OrbEvent[]): ImportResult {
  const known = new Set(existing.map((e) => e.id));
  const targets = [...tracker.targets];
  const targetFor = (type: string): Target => {
    const name = WEB_TARGET_NAMES[type] ?? cleanName(type);
    const found = targets.find((t) => nameKey(t.name) === nameKey(name));
    if (found) return found;
    const created = { id: newId(), name };
    targets.push(created);
    return created;
  };

  const base = { trackerId: tracker.id, season, source: "import" as const };
  const candidates: OrbEvent[] = [];
  for (const d of data.drops) {
    const target = targetFor(d.type);
    candidates.push({ ...base, id: `imp-${d.id}`, at: d.date, kind: "spend", amount: d.amount });
    // +1 мс: находка идёт сразу после своей траты.
    candidates.push({ ...base, id: `imp-${d.id}-hit`, at: d.date + 1, kind: "hit", targetId: target.id, targetName: target.name });
  }
  for (const e of data.entries) {
    candidates.push({ ...base, id: `imp-${e.id}`, at: e.date, kind: "spend", amount: e.amount });
  }

  const events = candidates.filter((e) => !known.has(e.id));
  return {
    tracker: { ...tracker, targets },
    events,
    added: events.length,
    skipped: candidates.length - events.length,
  };
}

// ─── Резервная копия ────────────────────────────────────────────────────

const BACKUP_FORMAT = "poe-manager.ancient-orb";

export function toBackup(data: AncientData): string {
  return JSON.stringify({ format: BACKUP_FORMAT, version: 1, ...data }, null, 2);
}

function isTracker(v: unknown): v is Tracker {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.title === "string" &&
    typeof o.season === "string" &&
    typeof o.createdAt === "number" &&
    (o.expected === null || (typeof o.expected === "number" && Number.isSafeInteger(o.expected) && o.expected >= 1)) &&
    Array.isArray(o.targets) &&
    o.targets.length >= 1 &&
    o.targets.every((t) => t && typeof t === "object" && typeof t.id === "string" && typeof t.name === "string")
  );
}

function isEvent(v: unknown): v is OrbEvent {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  const base =
    typeof o.id === "string" &&
    typeof o.trackerId === "string" &&
    typeof o.season === "string" &&
    typeof o.at === "number" &&
    (o.source === "manual" || o.source === "import");
  if (!base) return false;
  if (o.kind === "spend") return typeof o.amount === "number" && Number.isSafeInteger(o.amount) && o.amount >= 1 && o.amount <= MAX_AMOUNT;
  return o.kind === "hit" && typeof o.targetId === "string" && typeof o.targetName === "string";
}

/** Проверка данных: из резервной копии и из сохранённого состояния. `null` — данные негодны. */
export function validData(v: unknown): AncientData | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.trackers) || !Array.isArray(o.events) || typeof o.activeTrackerId !== "string") return null;
  if (o.trackers.length === 0 || !o.trackers.every(isTracker) || !o.events.every(isEvent)) return null;
  const trackers = o.trackers as Tracker[];
  const ids = new Set(trackers.map((t) => t.id));
  return {
    activeTrackerId: ids.has(o.activeTrackerId) ? o.activeTrackerId : trackers[0].id,
    trackers,
    // События удалённых трекеров не тащим.
    events: (o.events as OrbEvent[]).filter((e) => ids.has(e.trackerId)),
  };
}

export function parseBackup(text: string): AncientData | string {
  let raw: unknown;
  try {
    raw = JSON.parse(text.trim());
  } catch {
    return "Это не JSON.";
  }
  if (!raw || typeof raw !== "object" || (raw as Record<string, unknown>).format !== BACKUP_FORMAT)
    return "Это не резервная копия Ancient Orb.";
  return validData(raw) ?? "Резервная копия повреждена.";
}

// ─── Показ ──────────────────────────────────────────────────────────────

const numberFormat = new Intl.NumberFormat("ru-RU");
/** Разделитель разрядов — обычный неразрывный пробел: узкого (U+202F) нет в JetBrains Mono, и он выходит широким. */
export const formatNumber = (n: number) => numberFormat.format(n).replace(/\u202f/g, "\u00a0");

const dateThisYear = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const dateOtherYear = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" });

export function formatDate(at: number): string {
  const d = new Date(at);
  return (d.getFullYear() === new Date().getFullYear() ? dateThisYear : dateOtherYear).format(d);
}
